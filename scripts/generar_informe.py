# -*- coding: utf-8 -*-
"""
generar_informe.py — Talento País V2 (panel para tomadores de decisión del Estado)

Lee los datos ya procesados del repo original (talento-pais-original) y genera
data/informe.json: un único archivo con todo lo que el frontend necesita.
El frontend NO hace cálculos de datos — solo aplica reglas de presentación.

Modos:
  python scripts/generar_informe.py --local "C:/ruta/a/talento-pais-original"
  python scripts/generar_informe.py --remote     (raw.githubusercontent, para GitHub Actions)

Fuentes leídas:
  datos/raw/carreras_estrategicas.json  → matrícula por carrera × institución × región (Mineduc 2025)
  datos/procesados/brechas.csv          → demanda semanal + nivel de brecha por sector
  datos/procesados/historico.csv        → serie semanal de demanda (para tendencia)
  datos/procesados/oportunidades.json   → registros individuales de demanda (para el desglose por tipo)
  datos/procesados/data_meta.json       → fecha de última actualización del pipeline
"""

import argparse
import csv
import io
import json
import re
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

RAW_BASE = "https://raw.githubusercontent.com/talentopaischile/talento-pais-original/main"

OUT_DIR = Path(__file__).parent.parent / "data"

# ─── Regiones (orden norte → sur) ────────────────────────────────────────────
# id, nombre corto, nombre oficial largo, nombre usado en carreras_estrategicas.json
REGIONES = [
    ("arica",        "Arica y Parinacota",  "Región de Arica y Parinacota",   "Arica y Parinacota"),
    ("tarapaca",     "Tarapacá",            "Región de Tarapacá",             "Tarapacá"),
    ("antofagasta",  "Antofagasta",         "Región de Antofagasta",          "Antofagasta"),
    ("atacama",      "Atacama",             "Región de Atacama",              "Atacama"),
    ("coquimbo",     "Coquimbo",            "Región de Coquimbo",             "Coquimbo"),
    ("valparaiso",   "Valparaíso",          "Región de Valparaíso",           "Valparaíso"),
    ("metropolitana","Metropolitana",       "Región Metropolitana",           "Metropolitana"),
    ("ohiggins",     "O'Higgins",           "Región de O'Higgins",            "Lib. Gral. B. O'Higgins"),
    ("maule",        "Maule",               "Región del Maule",               "Maule"),
    ("nuble",        "Ñuble",               "Región de Ñuble",                "Ñuble"),
    ("biobio",       "Biobío",              "Región del Biobío",              "Biobío"),
    ("araucania",    "La Araucanía",        "Región de La Araucanía",         "La Araucanía"),
    ("losrios",      "Los Ríos",            "Región de Los Ríos",             "Los Ríos"),
    ("loslagos",     "Los Lagos",           "Región de Los Lagos",            "Los Lagos"),
    ("aysen",        "Aysén",               "Región de Aysén",                "Aysén"),
    ("magallanes",   "Magallanes",          "Región de Magallanes",           "Magallanes"),
]
REGION_POR_SEDE = {sede: rid for rid, _, _, sede in REGIONES}
N_REGIONES = len(REGIONES)

# ─── Sectores estratégicos ───────────────────────────────────────────────────
# demanda_de: sectores de brechas.csv de los que puede tomar demanda/nivel,
# en orden de preferencia (el pipeline entrega demanda por sector, no por
# carrera). El fallback cubre semanas en que un sector nuevo aún no tiene fila.
SECTORES = {
    "ia_tecnologia":         {"label": "IA & Tecnología",        "demanda_de": ["IA & Tecnología"]},
    "energias_renovables":   {"label": "Energías Renovables",    "demanda_de": ["Energías Renovables"]},
    "construccion":          {"label": "Construcción",           "demanda_de": ["Construcción"]},
    "litio":                 {"label": "Litio",                  "demanda_de": ["Litio & Minería"]},
    "cobre_otros_minerales": {"label": "Cobre & Otros Minerales","demanda_de": ["Cobre & Otros Minerales", "Litio & Minería"]},
    "astronomia":            {"label": "Astronomía",             "demanda_de": ["Astronomía"]},
    "oceanografia":          {"label": "Oceanografía",           "demanda_de": ["Oceanografía"]},
    "asia_pacifico":         {"label": "Asia-Pacífico",          "demanda_de": ["Asia-Pacífico"]},
    "agroindustria":         {"label": "Agroindustria",          "demanda_de": ["Agroindustria"]},
    "vino":                  {"label": "Vitivinicultura",        "demanda_de": ["Vitivinicultura"]},
}

# ─── Curación de carreras por sector ─────────────────────────────────────────
# El etiquetado original usa coincidencia de texto y produce falsos positivos
# (ej: GASTRONOMIA quedó en "astronomia" por contener la subcadena ASTRONOMIA).
# incluir: si se define, la carrera DEBE calzar con alguno de estos patrones.
# excluir: la carrera se descarta si calza con alguno de estos patrones.
CURACION = {
    "astronomia": {
        "incluir": [r"ASTRONOM", r"ASTROFIS", r"^LICENCIATURA EN FISICA$",
                    r"^MAGISTER EN (CIENCIAS FISICAS|FISICA)", r"^DOCTORADO EN (CIENCIAS FISICAS|FISICA|ASTROFISICA)"],
        "excluir": [r"GASTRONOM", r"EDUCACION FISICA", r"PREPARAD", r"DEPORT",
                    r"PERSONAL TRAINER", r"PREPARACION FISICA", r"ACTIVIDAD FISICA"],
    },
    "oceanografia": {
        "excluir": [r"GASTRONOM"],
    },
}

MAX_CARRERAS_POR_SECTOR = 12
MAX_INSTITUCIONES_POR_REGION = 6
MAX_SIN_CLASIFICAR = 60

MINUSCULAS = {"de", "del", "en", "la", "las", "los", "y", "e", "a", "el", "con", "para", "su", "o", "u"}

# La fuente Mineduc viene en MAYÚSCULAS sin tildes; restauramos las palabras
# frecuentes para presentación institucional.
ACENTOS = {
    "fisica": "física", "astronomia": "astronomía", "astrofisica": "astrofísica",
    "geofisica": "geofísica", "mencion": "mención", "ingenieria": "ingeniería",
    "tecnico": "técnico", "tecnica": "técnica", "geologia": "geología",
    "electrica": "eléctrica", "electrico": "eléctrico", "electronica": "electrónica",
    "informatica": "informática", "quimica": "química", "quimico": "químico",
    "pedagogia": "pedagogía", "ingles": "inglés", "traduccion": "traducción",
    "interpretacion": "interpretación", "biologia": "biología", "acuicola": "acuícola",
    "acuicolas": "acuícolas", "agronomica": "agronómica", "mecanica": "mecánica",
    "automatizacion": "automatización", "produccion": "producción",
    "administracion": "administración", "operacion": "operación", "mineria": "minería",
    "enologia": "enología", "computacion": "computación", "tecnologia": "tecnología",
    "cientifica": "científica", "atmosfericas": "atmosféricas", "gastronomia": "gastronomía",
    "basica": "básica", "codigo": "código", "extraccion": "extracción",
    "baterias": "baterías", "metalurgica": "metalúrgica", "diplomas": "diplomas",
    "viticultura": "viticultura", "oceanografia": "oceanografía", "logistica": "logística",
    "telematica": "telemática", "analitica": "analítica", "energia": "energía",
    "energias": "energías", "hidrogeno": "hidrógeno", "agronomia": "agronomía",
    "agricola": "agrícola", "ejecucion": "ejecución", "catolica": "católica",
    "concepcion": "concepción", "valparaiso": "valparaíso", "maria": "maría",
    "santisima": "santísima", "aysen": "aysén", "tarapaca": "tarapacá",
    "biobio": "biobío", "nuble": "ñuble", "construccion": "construcción",
    "prevencion": "prevención", "topografia": "topografía", "geomensura": "geomensura",
    "vinificacion": "vinificación", "gestion": "gestión", "nutricion": "nutrición",
    "innovacion": "innovación", "comunicacion": "comunicación",
}

# Siglas institucionales que deben permanecer en mayúsculas
SIGLAS = {"IP", "CFT", "UC", "UCN", "UACH", "USACH", "UTEM", "UTFSM", "UDLA",
          "UDP", "PUCV", "UOH", "ULS", "UFRO", "UTA", "UNAP", "UDA", "UCM",
          "UCSC", "UBB", "UMAG", "UNAB", "INACAP", "AIEP", "DUOC", "UST",
          "UDEC", "UAI", "UAB", "IPP", "IACC", "UCINF", "UMCE", "UPLA", "UV"}


def titulo_inst(nombre: str) -> str:
    """Nombre de institución: título en español preservando siglas."""
    palabras = nombre.strip().split()
    out = []
    for i, p in enumerate(palabras):
        if p.upper() in SIGLAS:
            out.append(p.upper())
            continue
        low = ACENTOS.get(p.lower(), p.lower())
        if i > 0 and low in MINUSCULAS:
            out.append(low)
        else:
            out.append(low.capitalize())
    return " ".join(out)


def titulo_es(nombre: str) -> str:
    """ALL CAPS → Título en español (conectores en minúscula, tildes restauradas)."""
    nombre = re.sub(r"-PE$", " PLAN ESPECIAL", nombre.strip(), flags=re.I)
    palabras = nombre.lower().split()
    out = []
    for i, p in enumerate(palabras):
        p = ACENTOS.get(p, p)
        if i > 0 and p in MINUSCULAS:
            out.append(p)
        else:
            out.append(p.capitalize())
    return " ".join(out)


def slug(texto: str) -> str:
    t = unicodedata.normalize("NFKD", texto.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


# ─── Carga de fuentes (local o remota) ───────────────────────────────────────

def leer_fuente(base, rel_path: str, es_json: bool):
    if isinstance(base, Path):
        path = base / rel_path
        if not path.exists():
            return None
        texto = path.read_text(encoding="utf-8")
    else:
        url = f"{RAW_BASE}/{rel_path.replace(chr(92), '/')}"
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                texto = r.read().decode("utf-8")
        except Exception as e:
            print(f"  ⚠ No se pudo leer {url}: {e}")
            return None
    if not texto.strip():
        return None
    return json.loads(texto) if es_json else texto


def parse_csv(texto: str) -> list[dict]:
    return [r for r in csv.DictReader(io.StringIO(texto)) if any(v.strip() for v in r.values() if v)]


# ─── Construcción del informe ────────────────────────────────────────────────

def curar(sector: str, nombre: str) -> bool:
    reglas = CURACION.get(sector)
    if not reglas:
        return True
    for pat in reglas.get("excluir", []):
        if re.search(pat, nombre):
            return False
    incluir = reglas.get("incluir")
    if incluir:
        return any(re.search(pat, nombre) for pat in incluir)
    return True


def construir_carreras(detalle: list[dict]) -> list[dict]:
    # Agrupar: sector → carrera → región → {matrícula, instituciones}
    por_sector: dict[str, dict[str, dict]] = {}
    for fila in detalle:
        nombre = fila.get("nomb_carrera", "").strip()
        rid = REGION_POR_SEDE.get(fila.get("region_sede", ""))
        mat = int(fila.get("matriculados") or 0)
        if not nombre or rid is None:
            continue
        for sector in fila.get("sectores", []):
            if sector not in SECTORES or not curar(sector, nombre):
                continue
            c = por_sector.setdefault(sector, {}).setdefault(nombre, {"total": 0, "regiones": {}})
            c["total"] += mat
            reg = c["regiones"].setdefault(rid, {"matricula": 0, "instituciones": {}})
            reg["matricula"] += mat
            inst = fila.get("nomb_inst", "").strip()
            if inst:
                reg["instituciones"][inst] = reg["instituciones"].get(inst, 0) + mat

    carreras = []
    for sector, por_carrera in por_sector.items():
        top = sorted(por_carrera.items(), key=lambda kv: kv[1]["total"], reverse=True)
        top = [kv for kv in top if kv[1]["total"] > 0][:MAX_CARRERAS_POR_SECTOR]
        for nombre, datos in top:
            regiones_out = {}
            for rid, reg in datos["regiones"].items():
                insts = sorted(reg["instituciones"].items(), key=lambda kv: kv[1], reverse=True)
                regiones_out[rid] = {
                    "matricula": reg["matricula"],
                    "instituciones": [[titulo_inst(i), m] for i, m in insts[:MAX_INSTITUCIONES_POR_REGION]],
                }
            carreras.append({
                "id": slug(nombre),
                "nombre": titulo_es(nombre),
                "sector": sector,
                "matricula_nacional": datos["total"],
                "promedio_regional": round(datos["total"] / N_REGIONES),
                "n_regiones_con_oferta": sum(1 for r in regiones_out.values() if r["matricula"] > 0),
                "regiones": regiones_out,
            })
    # ids únicos globales (una carrera puede estar en 2 sectores, ej: eléctricas)
    vistos: set[str] = set()
    for c in carreras:
        if c["id"] in vistos:
            c["id"] = f"{c['id']}-{slug(c['sector'])}"
        vistos.add(c["id"])
    return carreras


def extraer_accion(recomendacion: str) -> str:
    """La recomendación sectorial del pipeline trae 'Acción: ...' al final."""
    m = re.search(r"Acci[oó]n:\s*(.+)$", recomendacion or "")
    return (m.group(1).strip() if m else "").rstrip(".")


# ─── Detección conservadora de región en los registros de demanda ───────────
# El campo `region` del scraper es genérico ("Chile", "No especificada"), pero
# muchos títulos mencionan la región de forma explícita. Solo se etiqueta un
# registro cuando su propio texto nombra una región chilena; nunca se infiere.
REGION_PATRONES = [
    ("arica",         r"arica"),
    ("tarapaca",      r"tarapaca|iquique"),
    ("antofagasta",   r"antofagasta|calama"),
    ("atacama",       r"\batacama\b|copiapo"),
    ("coquimbo",      r"coquimbo|la serena"),
    ("valparaiso",    r"valparaiso|vina del mar"),
    ("metropolitana", r"metropolitana|\bsantiago\b"),
    ("ohiggins",      r"o'?higgins|rancagua"),
    ("maule",         r"\bmaule\b|\btalca\b"),
    ("nuble",         r"\bnuble\b|chillan"),
    ("biobio",        r"biobio|bio-bio|concepcion"),
    ("araucania",     r"araucania|temuco"),
    ("losrios",       r"los rios|valdivia"),
    ("loslagos",      r"los lagos|puerto montt|osorno"),
    ("aysen",         r"aysen|coyhaique"),
    ("magallanes",    r"magallanes|punta arenas"),
]

MAX_REGISTROS_POR_TIPO = 10


def _sin_tildes(t: str) -> str:
    return unicodedata.normalize("NFKD", t.lower()).encode("ascii", "ignore").decode()


def detectar_regiones(texto: str) -> list[str]:
    """Regiones chilenas nombradas explícitamente en el texto del registro."""
    t = _sin_tildes(texto or "")
    return [rid for rid, pat in REGION_PATRONES if re.search(pat, t)]


def desglosar_oportunidades(oportunidades: list[dict]) -> tuple[dict, list[str]]:
    """Cuenta los registros de demanda por sector × tipo, guarda una muestra de
    registros por tipo (para el detalle auditable del frontend) y agrega la
    ubicación mencionada en los textos. Usa la misma regla de conteo que el
    pipeline (pertenencia al array `sectores`), de modo que la suma del
    desglose coincide con demanda_oportunidades de brechas.csv."""
    por_sector: dict[str, dict] = {}
    fuentes_globales: set[str] = set()
    for op in oportunidades or []:
        tipo = (op.get("tipo") or "otro").strip()
        fuente = (op.get("fuente") or "").strip()
        if fuente:
            fuentes_globales.add(fuente)
        titulo = (op.get("titulo") or "").strip()
        org = (op.get("organizacion") or "").strip()
        regiones_txt = detectar_regiones(f"{titulo} {op.get('descripcion') or ''}")
        score = op.get("relevancia_score") or 0
        for sid in op.get("sectores", []):
            if sid not in SECTORES:
                continue
            s = por_sector.setdefault(sid, {"tipos": {}, "fuentes": set(),
                                            "registros": {}, "ubicacion": {}, "sin_ubicacion": 0})
            s["tipos"][tipo] = s["tipos"].get(tipo, 0) + 1
            if fuente:
                s["fuentes"].add(fuente)
            if regiones_txt:
                for rid in regiones_txt:
                    s["ubicacion"][rid] = s["ubicacion"].get(rid, 0) + 1
            else:
                s["sin_ubicacion"] += 1
            s["registros"].setdefault(tipo, []).append({
                "titulo": titulo or "(sin título)",
                "fuente": fuente or None,
                "org": org if org and _sin_tildes(org) != "no especificada" else None,
                "url": (op.get("url") or "").strip() or None,
                "regiones": regiones_txt or None,
                "monto": op.get("monto_fmt") or None,
                "_score": score,
            })
    out = {}
    for sid, s in por_sector.items():
        muestra = {}
        for tipo, regs in s["registros"].items():
            regs.sort(key=lambda r: r["_score"], reverse=True)
            muestra[tipo] = [{k: v for k, v in r.items() if k != "_score" and v is not None}
                             for r in regs[:MAX_REGISTROS_POR_TIPO]]
        out[sid] = {
            "desglose": [{"tipo": t, "n": n} for t, n in
                         sorted(s["tipos"].items(), key=lambda kv: kv[1], reverse=True)],
            "fuentes": sorted(s["fuentes"]),
            "registros": muestra,
            "ubicacion": {
                "regiones": dict(sorted(s["ubicacion"].items(), key=lambda kv: kv[1], reverse=True)),
                "sin_ubicacion": s["sin_ubicacion"],
            },
        }
    return out, sorted(fuentes_globales)


def construir_sectores(brechas: list[dict], oportunidades: list[dict]) -> tuple[dict, list[str]]:
    por_label = {b["sector_label"].strip(): b for b in brechas if b.get("sector_label")}
    registros, fuentes_pipeline = desglosar_oportunidades(oportunidades)
    out = {}
    for sid, cfg in SECTORES.items():
        b, label_usado = None, None
        for label in cfg["demanda_de"]:
            if label in por_label:
                b, label_usado = por_label[label], label
                break
        reg = registros.get(sid, {})
        demanda = int(b["demanda_oportunidades"]) if b and b.get("demanda_oportunidades") else None
        desglose = reg.get("desglose") or None
        # El desglose solo se publica si cuadra con la cifra oficial de brechas.csv;
        # así el frontend nunca muestra una descomposición que no suma el total.
        if desglose is not None and demanda is not None and sum(d["n"] for d in desglose) != demanda:
            print(f"  ⚠ {sid}: desglose ({sum(d['n'] for d in desglose)}) ≠ demanda ({demanda}); se omite el desglose")
            desglose = None
        out[sid] = {
            "label": cfg["label"],
            "demanda_sector": label_usado,   # de qué sector del pipeline viene la demanda
            "nivel_brecha": (b or {}).get("nivel_brecha") or None,
            "demanda": demanda,
            "demanda_desglose": desglose,
            "demanda_registros": reg.get("registros") or None,
            "demanda_ubicacion": reg.get("ubicacion") or None,
            "fuentes_demanda": reg.get("fuentes") or None,
            "matricula_nacional_sector": int(b["matricula_estimada"]) if b and b.get("matricula_estimada") else None,
            "diagnostico": (b or {}).get("recomendacion") or None,
            "accion": extraer_accion((b or {}).get("recomendacion")) or None,
        }
    return out, fuentes_pipeline


def construir_historico(historico_csv: list[dict], brechas: list[dict], sectores: dict) -> list[dict]:
    """Serie semanal de demanda por sector (para la tendencia).
    Si historico.csv aún no existe en el repo original, arranca con el punto actual."""
    label_a_sid = {}
    for sid, s in sectores.items():
        if s["demanda_sector"]:
            label_a_sid.setdefault(s["demanda_sector"], []).append(sid)

    por_fecha: dict[str, dict] = {}
    for fila in historico_csv:
        fecha, label = fila.get("fecha", "").strip(), fila.get("sector_label", "").strip()
        try:
            demanda = int(float(fila.get("demanda_oportunidades") or 0))
        except ValueError:
            continue
        if fecha and label in label_a_sid:
            for sid in label_a_sid[label]:
                por_fecha.setdefault(fecha, {})[sid] = demanda

    if not por_fecha and brechas:
        hoy = datetime.now().strftime("%Y-%m-%d")
        for b in brechas:
            label = b.get("sector_label", "").strip()
            if label in label_a_sid and b.get("demanda_oportunidades"):
                for sid in label_a_sid[label]:
                    por_fecha.setdefault(hoy, {})[sid] = int(b["demanda_oportunidades"])

    return [{"fecha": f, "demanda": d} for f, d in sorted(por_fecha.items())]


def construir_demanda_global(oportunidades: list[dict]) -> dict:
    """Vista global de toda la demanda scraped: totales por región, tipo y sector.
    Incluye los registros sin_clasificar (carreras fuera de los 10 sectores
    estratégicos) como señal de demanda laboral general."""
    por_region: dict[str, int] = {}
    por_tipo: dict[str, int] = {}
    por_sector: dict[str, int] = {}
    sin_clasificar_regs: list[dict] = []

    for op in oportunidades or []:
        tipo = (op.get("tipo") or "otro").strip()
        por_tipo[tipo] = por_tipo.get(tipo, 0) + 1

        titulo = op.get("titulo", "")
        desc = op.get("descripcion", "")
        regiones_txt = detectar_regiones(f"{titulo} {desc}")
        for rid in regiones_txt:
            por_region[rid] = por_region.get(rid, 0) + 1

        sectores = op.get("sectores", [])
        es_sin_clasificar = not sectores or sectores == ["sin_clasificar"]
        for s in sectores:
            if s and s != "sin_clasificar":
                por_sector[s] = por_sector.get(s, 0) + 1

        if es_sin_clasificar:
            fuente = (op.get("fuente") or "").strip()
            org = (op.get("organizacion") or "").strip()
            url = (op.get("url") or "").strip()
            rec = {
                "titulo": titulo or "(sin título)",
                "tipo": tipo,
                "fuente": fuente or None,
                "org": org if org and _sin_tildes(org) != "no especificada" else None,
                "url": url or None,
                "regiones": regiones_txt or None,
            }
            sin_clasificar_regs.append({k: v for k, v in rec.items() if v is not None})

    return {
        "total_registros": len(oportunidades),
        "por_region": dict(sorted(por_region.items(), key=lambda kv: kv[1], reverse=True)),
        "por_tipo": dict(sorted(por_tipo.items(), key=lambda kv: kv[1], reverse=True)),
        "por_sector": dict(sorted(por_sector.items(), key=lambda kv: kv[1], reverse=True)),
        "sin_clasificar": {
            "total": len(sin_clasificar_regs),
            "registros": sin_clasificar_regs[:MAX_SIN_CLASIFICAR],
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", help="Ruta local al repo talento-pais-original")
    ap.add_argument("--remote", action="store_true", help="Leer desde raw.githubusercontent.com")
    args = ap.parse_args()
    if not args.local and not args.remote:
        ap.error("Indica --local <ruta> o --remote")
    base = Path(args.local) if args.local else "remote"

    print("Leyendo fuentes…")
    carreras_src = leer_fuente(base, "datos/raw/carreras_estrategicas.json", es_json=True)
    brechas_txt = leer_fuente(base, "datos/procesados/brechas.csv", es_json=False)
    historico_txt = leer_fuente(base, "datos/procesados/historico.csv", es_json=False)
    oportunidades = leer_fuente(base, "datos/procesados/oportunidades.json", es_json=True) or []
    meta = leer_fuente(base, "datos/procesados/data_meta.json", es_json=True) or {}

    if not carreras_src or not brechas_txt:
        print("✗ Faltan fuentes obligatorias (carreras_estrategicas.json / brechas.csv)")
        sys.exit(1)

    brechas = parse_csv(brechas_txt)
    historico_csv = parse_csv(historico_txt) if historico_txt else []

    sectores, fuentes_pipeline = construir_sectores(brechas, oportunidades)
    carreras = construir_carreras(carreras_src.get("detalle", []))
    historico = construir_historico(historico_csv, brechas, sectores)
    demanda_global = construir_demanda_global(oportunidades)

    informe = {
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fuente_actualizada": meta.get("updated"),
        "fuente_matricula": carreras_src.get("fuente", "Mineduc — Matrícula Ed. Superior 2025"),
        "fuentes_pipeline": fuentes_pipeline,
        "regiones": [
            {"id": rid, "nombre": nombre, "nombre_largo": largo}
            for rid, nombre, largo, _ in REGIONES
        ],
        "sectores": sectores,
        "carreras": sorted(carreras, key=lambda c: (c["sector"], -c["matricula_nacional"])),
        "historico": historico,
        "demanda_global": demanda_global,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "informe.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(informe, f, ensure_ascii=False, separators=(",", ":"))

    kb = out_path.stat().st_size / 1024
    n_sin_clasificar = demanda_global['sin_clasificar']['total']
    print(f"OK {out_path} — {len(carreras)} carreras estrategicas, {len(historico)} semanas, "
          f"{demanda_global['total_registros']} registros demanda ({n_sin_clasificar} sin clasificar), {kb:.0f} KB")


if __name__ == "__main__":
    main()
