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
# demanda_de: sector de brechas.csv del que toma demanda/nivel (los datos de
# demanda del pipeline existen a nivel de sector, no de carrera).
SECTORES = {
    "ia_tecnologia":         {"label": "IA & Tecnología",        "demanda_de": "IA & Tecnología"},
    "energias_renovables":   {"label": "Energías Renovables",    "demanda_de": "Energías Renovables"},
    "litio":                 {"label": "Litio",                  "demanda_de": "Litio & Minería"},
    "cobre_otros_minerales": {"label": "Cobre & Otros Minerales","demanda_de": "Litio & Minería"},
    "astronomia":            {"label": "Astronomía",             "demanda_de": "Astronomía"},
    "oceanografia":          {"label": "Oceanografía",           "demanda_de": "Oceanografía"},
    "asia_pacifico":         {"label": "Asia-Pacífico",          "demanda_de": "Asia-Pacífico"},
    "agroindustria":         {"label": "Agroindustria",          "demanda_de": None},
    "vino":                  {"label": "Vitivinicultura",        "demanda_de": None},
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

MAX_CARRERAS_POR_SECTOR = 8
MAX_INSTITUCIONES_POR_REGION = 6

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
    "biobio": "biobío", "nuble": "ñuble",
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
    palabras = nombre.strip().lower().split()
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


def construir_sectores(brechas: list[dict]) -> dict:
    por_label = {b["sector_label"].strip(): b for b in brechas if b.get("sector_label")}
    out = {}
    for sid, cfg in SECTORES.items():
        b = por_label.get(cfg["demanda_de"]) if cfg["demanda_de"] else None
        out[sid] = {
            "label": cfg["label"],
            "demanda_sector": cfg["demanda_de"],   # de qué sector del pipeline viene la demanda
            "nivel_brecha": (b or {}).get("nivel_brecha") or None,
            "demanda": int(b["demanda_oportunidades"]) if b and b.get("demanda_oportunidades") else None,
            "matricula_nacional_sector": int(b["matricula_estimada"]) if b and b.get("matricula_estimada") else None,
            "diagnostico": (b or {}).get("recomendacion") or None,
            "accion": extraer_accion((b or {}).get("recomendacion")) or None,
        }
    return out


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
    meta = leer_fuente(base, "datos/procesados/data_meta.json", es_json=True) or {}

    if not carreras_src or not brechas_txt:
        print("✗ Faltan fuentes obligatorias (carreras_estrategicas.json / brechas.csv)")
        sys.exit(1)

    brechas = parse_csv(brechas_txt)
    historico_csv = parse_csv(historico_txt) if historico_txt else []

    sectores = construir_sectores(brechas)
    carreras = construir_carreras(carreras_src.get("detalle", []))
    historico = construir_historico(historico_csv, brechas, sectores)

    informe = {
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fuente_actualizada": meta.get("updated"),
        "fuente_matricula": carreras_src.get("fuente", "Mineduc — Matrícula Ed. Superior 2025"),
        "regiones": [
            {"id": rid, "nombre": nombre, "nombre_largo": largo}
            for rid, nombre, largo, _ in REGIONES
        ],
        "sectores": sectores,
        "carreras": sorted(carreras, key=lambda c: (c["sector"], -c["matricula_nacional"])),
        "historico": historico,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "informe.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(informe, f, ensure_ascii=False, separators=(",", ":"))

    kb = out_path.stat().st_size / 1024
    print(f"✓ {out_path} — {len(carreras)} carreras, {len(historico)} semanas de histórico, {kb:.0f} KB")


if __name__ == "__main__":
    main()
