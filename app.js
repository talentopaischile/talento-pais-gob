/* ═══════════════════════════════════════════════════════════════
   Talento País V2 — Informe Ejecutivo Regional
   Sin frameworks. Lee data/informe.json (pre-calculado semanalmente)
   y aplica un motor de REGLAS determinista (sin IA) para estado,
   resumen y recomendación. Las reglas están documentadas en el
   acordeón "Metodología" y en el README.
   ═══════════════════════════════════════════════════════════════ */

"use strict";

let DATA = null;

const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? "s/d" : Number(n).toLocaleString("es-CL"));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Orden fijo de sectores en el selector */
const ORDEN_SECTORES = [
  "construccion", "ia_tecnologia", "energias_renovables", "litio",
  "cobre_otros_minerales", "astronomia", "oceanografia", "asia_pacifico",
  "agroindustria", "vino",
];

/* ─── Motor de reglas: estado (semáforo) ─────────────────────────
   Entradas: nivel de brecha del sector (nacional, pipeline semanal),
   matrícula de la carrera en la región y promedio regional del país.
   Salidas: uno de 4 estados. Reglas documentadas en Metodología.   */
function calcularEstado(nivelSector, matRegional, promedio, sinDemanda) {
  const bajoPromedio = matRegional < promedio;
  let clave;
  if (sinDemanda) {
    clave = matRegional === 0 ? "alta" : bajoPromedio ? "moderada" : "suficiente";
  } else if (nivelSector === "ALTA") {
    clave = matRegional === 0 ? "critica" : bajoPromedio ? "alta" : "moderada";
  } else if (nivelSector === "MEDIA") {
    clave = matRegional === 0 ? "alta" : bajoPromedio ? "moderada" : "suficiente";
  } else { // BAJA o sin clasificar
    clave = matRegional === 0 ? "moderada" : "suficiente";
  }
  const DEF = {
    critica:    { emoji: "🔴", titulo: "Brecha crítica",   corto: "Crítica",
      frase: "La región no forma este perfil y el sector presenta alta demanda de talento a nivel nacional." },
    alta:       { emoji: "🟠", titulo: "Brecha alta",      corto: "Alta",
      frase: "La formación regional es insuficiente frente a las señales de demanda del sector a nivel nacional." },
    moderada:   { emoji: "🟡", titulo: "Brecha moderada",  corto: "Moderada",
      frase: "Existe oferta formativa, pero el sector mantiene demanda de talento sin cubrir a nivel nacional." },
    suficiente: { emoji: "🟢", titulo: "Oferta suficiente", corto: "Suficiente",
      frase: "La oferta formativa regional aparece alineada con las señales de demanda del sector a nivel nacional." },
  };
  if (sinDemanda) {
    DEF.alta.frase = "La región no registra formación en esta carrera (evaluación basada solo en oferta formativa).";
    DEF.moderada.frase = "La oferta formativa regional está bajo el promedio del país (evaluación basada solo en oferta formativa).";
    DEF.suficiente.frase = "La oferta formativa regional está sobre el promedio del país (evaluación basada solo en oferta formativa).";
  }
  return { clave, ...DEF[clave] };
}

/* ─── Registro de demanda del sector ─────────────────────────────
   ponytail: los registros del pipeline no se comparan entre sí;
   solo se usa el último valor disponible del sector. */
function ultimoRegistro(sectorId) {
  const serie = (DATA.historico || [])
    .map((h) => ({ fecha: h.fecha, v: h.demanda[sectorId] }))
    .filter((p) => p.v != null);
  return { ult: serie.length ? serie[serie.length - 1] : null };
}

/* ─── Resumen ejecutivo por plantillas (sin IA) ────────────────── */
function generarResumen(c, region, sector, estado, matR, tend, sinDemanda) {
  const prom = c.promedio_regional;

  if (sinDemanda) {
    const s1sd = {
      alta: `${region.nombre_largo} no registra matrícula en ${c.nombre}, una carrera clave para el sector ${sector.label}.`,
      moderada: `La formación de ${c.nombre} en ${region.nombre_largo} (${fmt(matR)} matriculados) está bajo el promedio regional del país (${fmt(prom)}).`,
      suficiente: `${region.nombre_largo} concentra una matrícula de ${c.nombre} sobre el promedio regional del país (${fmt(matR)} vs ${fmt(prom)}).`,
    }[estado.clave];
    const s3sd = c.n_regiones_con_oferta > 0
      ? `A nivel nacional, ${c.n_regiones_con_oferta} de 16 regiones imparten esta carrera.`
      : `Esta carrera casi no registra oferta formativa en el país.`;
    return `${s1sd} El pipeline aún no registra señales de demanda para el sector ${sector.label}, por lo que esta evaluación se basa únicamente en la oferta formativa (Mineduc 2025). ${s3sd}`;
  }

  const s1 = {
    critica: `${region.nombre_largo} no registra matrícula en ${c.nombre}, mientras el sector ${sector.label} presenta brecha de talento a nivel nacional (${fmt(sector.demanda)} ${sector.demanda === 1 ? "señal de demanda detectada" : "vacantes y señales de demanda detectadas"} en la última actualización).`,
    alta: `La formación de ${c.nombre} en ${region.nombre_largo} (${fmt(matR)} matriculados) está por debajo del promedio regional del país (${fmt(prom)}), mientras el sector ${sector.label} mantiene una brecha de talento a nivel nacional.`,
    moderada: matR >= prom
      ? `${region.nombre_largo} concentra una matrícula de ${c.nombre} sobre el promedio regional del país (${fmt(matR)} vs ${fmt(prom)}), pero el sector ${sector.label} aún registra demanda de talento sin cubrir a nivel nacional.`
      : `La formación de ${c.nombre} en ${region.nombre_largo} (${fmt(matR)} matriculados) está bajo el promedio regional del país (${fmt(prom)}), aunque la presión de demanda del sector ${sector.label} es acotada.`,
    suficiente: `La oferta formativa de ${c.nombre} en ${region.nombre_largo} (${fmt(matR)} matriculados) aparece alineada con las señales de demanda actuales del sector ${sector.label}.`,
  }[estado.clave];

  /* Solo se reporta el último valor del pipeline; los registros
     no se comparan entre sí (la nota metodológica lo explica). */
  const s2 = tend.ult
    ? `El último registro disponible del sector a nivel nacional es de ${fmt(tend.ult.v)} vacantes y señales de demanda (${fechaCorta(tend.ult.fecha)}).`
    : `El pipeline aún no registra señales de demanda para el sector ${sector.label}.`;

  const s3 = c.n_regiones_con_oferta > 0
    ? `A nivel nacional, ${c.n_regiones_con_oferta} de 16 regiones imparten esta carrera.`
    : `Esta carrera casi no registra oferta formativa en el país.`;

  return `${s1} ${s2} ${s3}`;
}

/* ─── Recomendación por reglas (sin IA) ────────────────────────── */
function generarRecomendacion(c, region, sector, estado) {
  const base = {
    critica: `Se recomienda evaluar la apertura de programas de ${c.nombre} en la región —vía CFT, IP o convenios con universidades que ya la imparten en otras regiones— y, en el corto plazo, mecanismos de atracción de talento (becas de movilidad, incentivos de contratación SENCE/CORFO).`,
    alta: `Se recomienda evaluar el aumento de cupos de ${c.nombre} en las instituciones que ya la imparten en la región y fortalecer programas de capacitación y reconversión laboral vinculados al sector ${sector.label}.`,
    moderada: `Se recomienda monitorear la evolución de la demanda del sector y fortalecer la vinculación entre las instituciones formadoras de la región y los empleadores del sector ${sector.label} (prácticas, titulación conjunta, formación dual).`,
    suficiente: `La oferta actual no requiere intervención inmediata. Se recomienda mantener los cupos vigentes y revisar este informe periódicamente para detectar cambios en la demanda.`,
  }[estado.clave];
  return base;
}

/* ─── Mapa real de Chile (GeoJSON de regiones) ──────────────
   Se usa el mismo dataset público que el mapa de referencia
   (fcortes/Chile-GeoJSON). geoNameToKey() traduce el nombre
   de cada polígono al id de región que ya usa esta app. */
const GEO_URL = "https://raw.githubusercontent.com/fcortes/Chile-GeoJSON/master/Regional.geojson";

const GEO_REGION_MAP = {
  "arica":         "arica",
  "parinacota":    "arica",
  "tarapaca":      "tarapaca",
  "antofagasta":   "antofagasta",
  "atacama":       "atacama",
  "coquimbo":      "coquimbo",
  "valparaiso":    "valparaiso",
  "o'higgins":     "ohiggins",
  "ohiggins":      "ohiggins",
  "libertador":    "ohiggins",
  "maule":         "maule",
  "nuble":         "nuble",
  "biobio":        "biobio",
  "araucania":     "araucania",
  "los rios":      "losrios",
  "los lagos":     "loslagos",
  "aysen":         "aysen",
  "magallanes":    "magallanes",
  "metropolitana": "metropolitana",
  "santiago":      "metropolitana",
};

function geoNameToKey(name) {
  if (!name) return null;
  const n = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const [kw, key] of Object.entries(GEO_REGION_MAP)) {
    const kn = kw.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (n.includes(kn)) return key;
  }
  return null;
}

const ESTADO_COLOR = {
  suficiente: "#10B981",
  moderada:   "#EAB308",
  alta:       "#F97316",
  critica:    "#EF4444",
};

const MAPA_BOUNDS = [[-56, -76], [-17, -66]];
let _mapaGeoJSON = null;   // cache del GeoJSON (se descarga una sola vez)
let _mapaLeafletMap = null;

/* ═══════════════ CARGA E INICIALIZACIÓN ═══════════════ */

async function init() {
  try {
    const r = await fetch("data/informe.json");
    if (!r.ok) throw new Error(r.status);
    DATA = await r.json();
  } catch (e) {
    $("error-carga").hidden = false;
    $("vista-inicio").hidden = true;
    document.body.classList.remove("modo-hero");
    return;
  }

  poblarSelectores();
  mostrarFrescura();

  $("form-consulta").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const region = $("sel-region").value, carrera = $("sel-carrera").value;
    if (!region || !carrera) return;
    const url = `?region=${region}&carrera=${carrera}`;
    history.pushState({ region, carrera }, "", url);
    renderInforme(region, carrera);
  });

  $("btn-volver").addEventListener("click", (ev) => {
    ev.preventDefault();
    history.pushState({}, "", location.pathname);
    mostrarInicio();
  });
  $("brand-link").addEventListener("click", (ev) => {
    ev.preventDefault();
    history.pushState({}, "", location.pathname);
    mostrarInicio();
  });

  $("btn-imprimir").addEventListener("click", () => window.print());
  $("btn-copiar").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      $("btn-copiar").textContent = "✓ Enlace copiado";
      setTimeout(() => ($("btn-copiar").textContent = "Copiar enlace"), 2000);
    } catch (e) { /* clipboard no disponible */ }
  });

  const accRegionesDetails = $("acc-regiones").closest("details");
  if (accRegionesDetails) {
    accRegionesDetails.addEventListener("toggle", () => {
      if (accRegionesDetails.open && _mapaLeafletMap) {
        setTimeout(() => {
          _mapaLeafletMap.invalidateSize();
          _mapaLeafletMap.fitBounds(MAPA_BOUNDS, { padding: [8, 8] });
        }, 50);
      }
    });
  }

  window.addEventListener("popstate", aplicarURL);

  /* Al imprimir, abrir los acordeones para que el PDF esté completo */
  const abiertos = [];
  window.addEventListener("beforeprint", () => {
    document.querySelectorAll(".acordeon").forEach((d) => {
      abiertos.push(d.open);
      d.open = true;
    });
  });
  window.addEventListener("afterprint", () => {
    document.querySelectorAll(".acordeon").forEach((d, i) => (d.open = abiertos[i]));
    abiertos.length = 0;
  });

  aplicarURL();
}

function aplicarURL() {
  const p = new URLSearchParams(location.search);
  const region = p.get("region"), carrera = p.get("carrera");
  if (region && carrera &&
      DATA.regiones.some((r) => r.id === region) &&
      DATA.carreras.some((c) => c.id === carrera)) {
    $("sel-region").value = region;
    $("sel-carrera").value = carrera;
    const cData = DATA.carreras.find(x => x.id === carrera);
    if (cData) $("buscar-carrera").value = cData.nombre;
    renderInforme(region, carrera);
  } else {
    mostrarInicio();
  }
}

function poblarSelectores() {
  const selR = $("sel-region");
  for (const r of DATA.regiones) {
    const o = document.createElement("option");
    o.value = r.id;
    o.textContent = r.nombre_largo;
    selR.appendChild(o);
  }
  initBuscador();
}

/* ─── Buscador de carreras con teclado ─────────────────────── */
function initBuscador() {
  const input = $("buscar-carrera");
  const lista = $("buscar-lista");
  const hidden = $("sel-carrera");
  let idx = -1;

  /* Índice plano de todas las carreras con su sector */
  const items = [];
  for (const sid of ORDEN_SECTORES) {
    for (const c of DATA.carreras.filter(x => x.sector === sid)) {
      items.push({ id: c.id, nombre: c.nombre, sector: DATA.sectores[sid].label });
    }
  }
  /* Agregar carreras de sectores no listados en ORDEN_SECTORES (futuro) */
  for (const c of DATA.carreras) {
    if (!items.some(i => i.id === c.id)) {
      items.push({ id: c.id, nombre: c.nombre, sector: DATA.sectores[c.sector]?.label || c.sector });
    }
  }

  function filtrar(q) {
    if (!q.trim()) return items;
    const t = q.trim().toLowerCase();
    return items.filter(i => i.nombre.toLowerCase().includes(t) || i.sector.toLowerCase().includes(t));
  }

  function resaltarActivo() {
    lista.querySelectorAll("li").forEach((li, i) => li.classList.toggle("activo", i === idx));
  }

  function mostrarLista(q) {
    const matches = filtrar(q).slice(0, 80);
    idx = -1;
    if (!matches.length) { lista.hidden = true; return; }
    lista.innerHTML = matches.map((m, i) =>
      `<li role="option" data-id="${esc(m.id)}" data-i="${i}">
         <span class="bl-nombre">${esc(m.nombre)}</span>
         <span class="bl-sector">${esc(m.sector)}</span>
       </li>`
    ).join("");
    lista.hidden = false;
  }

  function seleccionar(id, nombre) {
    hidden.value = id;
    input.value = nombre;
    lista.hidden = true;
    idx = -1;
  }

  input.addEventListener("input", () => {
    hidden.value = ""; // invalidate selection while typing
    mostrarLista(input.value);
  });

  input.addEventListener("focus", () => {
    if (!hidden.value) mostrarLista(input.value);
  });

  input.addEventListener("keydown", (e) => {
    const lis = [...lista.querySelectorAll("li")];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      idx = Math.min(idx + 1, lis.length - 1);
      resaltarActivo();
      lis[idx]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      idx = Math.max(idx - 1, 0);
      resaltarActivo();
      lis[idx]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      if (idx >= 0 && lis[idx]) {
        e.preventDefault();
        const li = lis[idx];
        seleccionar(li.dataset.id, li.querySelector(".bl-nombre").textContent);
      }
    } else if (e.key === "Escape") {
      lista.hidden = true;
    }
  });

  lista.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    e.preventDefault(); // evita blur antes del click
    seleccionar(li.dataset.id, li.querySelector(".bl-nombre").textContent);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".buscar-wrap")) lista.hidden = true;
  });
}

function diasDesde(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000));
}

function textoActualizado() {
  const d = diasDesde(DATA.fuente_actualizada);
  if (d == null) return "Actualización periódica";
  if (d === 0) return "Actualizado hoy";
  if (d === 1) return "Actualizado ayer";
  return `Actualizado hace ${d} días`;
}

function mostrarFrescura() {
  const b = $("badge-actualizado");
  b.textContent = textoActualizado();
  b.hidden = false;
  const d = diasDesde(DATA.fuente_actualizada);
  $("inicio-nota").textContent = d == null
    ? "La información se actualiza automáticamente de forma periódica."
    : `La información se actualiza automáticamente de forma periódica · ${textoActualizado()}.`;
}

function mostrarInicio() {
  $("vista-informe").hidden = true;
  $("vista-inicio").hidden = false;
  document.body.classList.add("modo-hero");
  const v = $("hero-video");
  if (v && v.paused) v.play().catch(() => {});
  document.title = "Talento País — Informe Ejecutivo Regional";
  window.scrollTo(0, 0);
}

/* ═══════════════ RENDER DEL INFORME ═══════════════ */

function renderInforme(regionId, carreraId) {
  const region = DATA.regiones.find((r) => r.id === regionId);
  const c = DATA.carreras.find((x) => x.id === carreraId);
  const sector = DATA.sectores[c.sector];
  const regData = c.regiones[regionId];
  const matR = regData ? regData.matricula : 0;
  const sinDemanda = sector.demanda == null;
  const estado = calcularEstado(sector.nivel_brecha, matR, c.promedio_regional, sinDemanda);
  const tend = ultimoRegistro(c.sector);

  document.title = `${c.nombre} · ${region.nombre} — Talento País`;

  /* 1 · Encabezado */
  $("inf-sector").textContent = sector.label;
  $("inf-carrera").textContent = c.nombre;
  $("inf-region").textContent = region.nombre_largo;
  $("inf-actualizado").textContent = textoActualizado();

  /* 2 · KPIs */
  $("kpi-vacantes").textContent = sinDemanda ? "s/d" : fmt(sector.demanda);
  $("kpi-vacantes-sub").textContent = sinDemanda
    ? "sin registro de demanda en la última actualización"
    : `sector ${sector.demanda_sector} · nivel nacional`;
  $("kpi-matricula").textContent = fmt(matR);
  $("kpi-matricula-sub").textContent = `matriculados en la región (Mineduc 2025)`;
  $("kpi-brecha").textContent = estado.corto;
  $("kpi-brecha").dataset.estado = estado.clave;
  $("kpi-brecha-sub").textContent = "en esta región";
  /* 3 · Estado */
  const banner = $("estado-banner");
  banner.className = `estado-banner e-${estado.clave}`;
  $("estado-titulo").textContent = estado.titulo;
  $("estado-frase").textContent = estado.frase;

  /* 4 y 5 · Resumen y recomendación */
  $("resumen-texto").textContent = generarResumen(c, region, sector, estado, matR, tend, sinDemanda);
  $("reco-texto").textContent = generarRecomendacion(c, region, sector, estado);
  const accion = $("reco-accion");
  if (sector.accion) {
    accion.textContent = `Acción sugerida por el análisis sectorial: ${sector.accion}.`;
    accion.hidden = false;
  } else {
    accion.hidden = true;
  }

  /* 6 · Contexto nacional */
  renderContexto(c, region, sector, estado, matR);

  /* 7 · Acordeones */
  renderAcordeones(c, region, sector, regData, sinDemanda);

  document.querySelectorAll(".acordeon").forEach((d) => (d.open = false));
  $("vista-inicio").hidden = true;
  $("vista-informe").hidden = false;
  document.body.classList.remove("modo-hero");
  const v = $("hero-video");
  if (v && !v.paused) v.pause();
  window.scrollTo(0, 0);
}

function renderContexto(c, region, sector, estado, matR) {
  const escala = Math.max(matR, c.promedio_regional) * 1.3 || 1;
  const pctMat = Math.round(Math.min(100, (matR / escala) * 100));
  const pctCob = Math.round((c.n_regiones_con_oferta / 16) * 100);
  $("contexto-lista").innerHTML = `
    <div class="ctx-bloque">
      <p class="ctx-label">Matrícula en la región</p>
      <p class="ctx-valor">${fmt(matR)}</p>
      <div class="ctx-barra"><div class="ctx-barra-fill" style="width:${pctMat}%"></div></div>
      <p class="ctx-compare">Promedio regional del país: ${fmt(c.promedio_regional)}</p>
    </div>
    <div class="ctx-bloque">
      <p class="ctx-label">Cobertura territorial</p>
      <p class="ctx-valor">${c.n_regiones_con_oferta} <span class="ctx-de">de 16</span></p>
      <div class="ctx-barra"><div class="ctx-barra-fill" style="width:${pctCob}%"></div></div>
      <p class="ctx-compare">regiones imparten esta carrera</p>
    </div>
    <div class="ctx-bloque">
      <p class="ctx-label">Brecha en la región</p>
      <span class="ctx-badge e-${esc(estado.clave)}">${esc(estado.corto)}</span>
      <p class="ctx-compare">Sector a nivel nacional: ${esc(nivelATexto(sector.nivel_brecha))}</p>
    </div>
    <div class="ctx-bloque">
      <p class="ctx-label">Matrícula nacional</p>
      <p class="ctx-valor">${fmt(c.matricula_nacional)}</p>
      <p class="ctx-compare">estudiantes en todo Chile</p>
    </div>`;
}

function nivelATexto(n) {
  return n === "ALTA" ? "Alta" : n === "MEDIA" ? "Media" : n === "BAJA" ? "Baja" : "Sin datos";
}

function fechaCorta(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${d} ${MES[m - 1]} ${a}`;
}

function renderAcordeones(c, region, sector, regData, sinDemanda) {
  /* Oferta formativa en la región */
  if (regData && regData.instituciones.length) {
    $("acc-oferta").innerHTML = `
      <table class="tabla-simple">
        <thead><tr><th>Institución</th><th class="num">Matriculados</th></tr></thead>
        <tbody>${regData.instituciones
          .map(([n, m]) => `<tr><td>${esc(n)}</td><td class="num">${fmt(m)}</td></tr>`)
          .join("")}</tbody>
      </table>`;
  } else {
    $("acc-oferta").innerHTML = `<p class="sin-datos">Ninguna institución de ${esc(region.nombre_largo)} registra matrícula en ${esc(c.nombre)} (Mineduc 2025). Las regiones que sí la imparten aparecen en «Comparación entre regiones».</p>`;
  }

  renderMapaRegiones(c, region.id);

  /* Diagnóstico del sector */
  const demandaPrestada = sector.demanda_sector && sector.demanda_sector !== sector.label;
  $("acc-sector").innerHTML = sector.diagnostico
    ? `${demandaPrestada ? `<p class="sin-datos">Las señales de demanda de este informe provienen del análisis nacional del sector «${esc(sector.demanda_sector)}», que agrupa a ${esc(sector.label)}.</p>` : ""}
       <p>${esc(sector.diagnostico)}</p>
       <p class="sin-datos">Demanda registrada en la última actualización: ${fmt(sector.demanda)} vacantes y señales de demanda a nivel nacional.</p>`
    : `<p class="sin-datos">El pipeline aún no registra señales de demanda específicas para ${esc(sector.label)}. La evaluación de este informe se basa únicamente en la oferta formativa (Mineduc 2025).</p>`;

  /* Metodología */
  $("acc-metodo").innerHTML = `
    <p><strong>Fuentes.</strong> Matrícula: Mineduc — Matrícula en Educación Superior 2025 (dato oficial, por carrera, institución y región). Demanda: pipeline automatizado que recopila ofertas laborales, licitaciones de Mercado Público y concursos ANID asociados a cada sector estratégico.</p>
    <p><strong>Qué significa "vacantes y señales de demanda".</strong> Es el número de oportunidades activas detectadas para el sector a nivel <em>nacional</em>. Hoy la demanda no está desagregada por carrera ni por región; por eso se presenta como señal sectorial y así debe interpretarse.</p>
    <p><strong>Cómo se calcula el estado.</strong> Reglas fijas y auditables (sin IA): se combina el nivel de brecha nacional del sector con la matrícula de la carrera en la región comparada contra el promedio regional del país. Ejemplo: sector con brecha alta + región sin matrícula = brecha crítica.</p>
    <p><strong>Limitaciones.</strong> Los datos de demanda son señales, no un censo de vacantes; la serie histórica de demanda está en fase inicial y sus variaciones deben interpretarse con cautela; la matrícula corresponde al año 2025 y se actualiza anualmente; las recomendaciones son orientativas y no reemplazan estudios sectoriales en profundidad.</p>
    <p class="sin-datos">Última actualización del pipeline: ${DATA.fuente_actualizada ? esc(fechaCorta(DATA.fuente_actualizada.slice(0, 10))) : "s/d"} · Informe generado automáticamente.</p>`;
}

/* ─── Estado de brecha para una región y carrera dadas ─────── */
function estadoParaRegion(c, regionId) {
  const regData = c.regiones[regionId];
  const matR = regData ? regData.matricula : 0;
  const sector = DATA.sectores[c.sector];
  const sinDemanda = sector.demanda == null;
  return calcularEstado(sector.nivel_brecha, matR, c.promedio_regional, sinDemanda);
}

/* ─── Mapa interactivo de Chile por brecha (mapa real, Leaflet) ─ */
async function renderMapaRegiones(c, currentRegionId) {
  const cont = $("acc-regiones");

  const leyendaItems = [
    ["critica",    "Brecha crítica"],
    ["alta",       "Brecha alta"],
    ["moderada",   "Brecha moderada"],
    ["suficiente", "Oferta suficiente"],
  ].map(([cl, label]) =>
    `<span class="ley-item"><span class="ley-punto e-${cl}"></span>${label}</span>`
  ).join("");

  cont.innerHTML = `
    <div class="mapa-contenedor">
      <div class="mapa-leaflet" id="mapa-leaflet" role="img" aria-label="Mapa de Chile · ${esc(c.nombre)}"></div>
      <div class="mapa-leyenda">${leyendaItems}</div>
      <p class="mapa-nota">Haz clic en una región para cargar su informe. También puedes usar el selector de región de arriba. La región actual aparece resaltada.</p>
    </div>`;

  if (!window.L) return;

  if (_mapaLeafletMap) { _mapaLeafletMap.remove(); _mapaLeafletMap = null; }

  const mapEl = document.getElementById("mapa-leaflet");
  _mapaLeafletMap = L.map(mapEl, {
    zoomControl: false,
    scrollWheelZoom: false,
    dragging: false,
    doubleClickZoom: false,
    attributionControl: false,
  });

  try {
    if (!_mapaGeoJSON) {
      const resp = await fetch(GEO_URL);
      _mapaGeoJSON = await resp.json();
    }

    L.geoJSON(_mapaGeoJSON, {
      style: feature => {
        const shapeName = feature.properties.Region || feature.properties.shapeName || feature.properties.NAME_1 || "";
        const key = geoNameToKey(shapeName);
        const e = key ? estadoParaRegion(c, key) : null;
        const actual = key === currentRegionId;
        return {
          fillColor: e ? ESTADO_COLOR[e.clave] : "#94a3b8",
          fillOpacity: actual ? 0.9 : 0.65,
          color: actual ? "#06214D" : "rgba(255,255,255,0.8)",
          weight: actual ? 3 : 1,
        };
      },
      onEachFeature(feature, layer) {
        const shapeName = feature.properties.Region || feature.properties.shapeName || feature.properties.NAME_1 || "";
        const key = geoNameToKey(shapeName);
        const r = key && DATA.regiones.find(x => x.id === key);
        if (!r) return;
        const regData = c.regiones[key];
        const matTxt = regData ? fmt(regData.matricula) + " matriculados" : "Sin oferta formativa";
        const e = estadoParaRegion(c, key);

        layer.bindTooltip(
          `<strong>${esc(r.nombre_largo)}</strong><br>${esc(matTxt)}<br>Brecha: <strong>${esc(e.corto)}</strong>`,
          { className: "mapa-tooltip-leaflet", sticky: true }
        );

        layer.on("click", () => {
          $("sel-region").value = key;
          const url = `?region=${key}&carrera=${c.id}`;
          history.pushState({ region: key, carrera: c.id }, "", url);
          renderInforme(key, c.id);
        });
        layer.on("mouseover", function () { this.setStyle({ fillOpacity: 0.9 }); });
        layer.on("mouseout",  function () { this.setStyle({ fillOpacity: key === currentRegionId ? 0.9 : 0.65 }); });
      },
    }).addTo(_mapaLeafletMap);

    _mapaLeafletMap.fitBounds(MAPA_BOUNDS, { padding: [8, 8] });
  } catch (e) {
    mapEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#8B9EB5;font-size:13px;">No se pudo cargar el mapa. Verifica tu conexión.</div>';
  }

  setTimeout(() => { if (_mapaLeafletMap) _mapaLeafletMap.invalidateSize(); }, 200);
}

init();
