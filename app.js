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
      frase: "La región no forma este perfil y el sector presenta alta demanda de talento." },
    alta:       { emoji: "🟠", titulo: "Brecha alta",      corto: "Alta",
      frase: "La formación regional es insuficiente frente a las señales de demanda del sector." },
    moderada:   { emoji: "🟡", titulo: "Brecha moderada",  corto: "Moderada",
      frase: "Existe oferta formativa, pero el sector mantiene demanda de talento sin cubrir." },
    suficiente: { emoji: "🟢", titulo: "Oferta suficiente", corto: "Suficiente",
      frase: "La oferta formativa regional aparece alineada con las señales de demanda actuales." },
  };
  if (sinDemanda) {
    DEF.alta.frase = "La región no registra formación en esta carrera (evaluación basada solo en oferta formativa).";
    DEF.moderada.frase = "La oferta formativa regional está bajo el promedio del país (evaluación basada solo en oferta formativa).";
    DEF.suficiente.frase = "La oferta formativa regional está sobre el promedio del país (evaluación basada solo en oferta formativa).";
  }
  return { clave, ...DEF[clave] };
}

/* ─── Tendencia de demanda del sector (serie semanal) ──────────── */
function calcularTendencia(sectorId) {
  const serie = (DATA.historico || [])
    .map((h) => ({ fecha: h.fecha, v: h.demanda[sectorId] }))
    .filter((p) => p.v != null);
  if (serie.length < 2) {
    return { serie, flecha: "→", texto: "Estable", detalle: "serie semanal recién iniciada", pct: null };
  }
  const prev = serie[serie.length - 2].v, ult = serie[serie.length - 1].v;
  const pct = prev === 0 ? null : Math.round(((ult - prev) / prev) * 100);
  if (pct == null || Math.abs(pct) < 5) {
    return { serie, flecha: "→", texto: "Estable", detalle: "sin variación relevante esta semana", pct };
  }
  return pct > 0
    ? { serie, flecha: "↑", texto: `Creciente +${pct}%`, detalle: "respecto a la semana anterior", pct }
    : { serie, flecha: "↓", texto: `Decreciente ${pct}%`, detalle: "respecto a la semana anterior", pct };
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
    return `${s1sd} El registro semanal de demanda para el sector ${sector.label} aún no está disponible, por lo que esta evaluación se basa únicamente en la oferta formativa (Mineduc 2025). ${s3sd}`;
  }

  const s1 = {
    critica: `${region.nombre_largo} no registra matrícula en ${c.nombre}, mientras el sector ${sector.label} presenta brecha de talento a nivel nacional con ${fmt(sector.demanda)} vacantes y señales de demanda activas.`,
    alta: `La formación de ${c.nombre} en ${region.nombre_largo} (${fmt(matR)} matriculados) está por debajo del promedio regional del país (${fmt(prom)}), mientras el sector ${sector.label} mantiene una brecha de talento a nivel nacional.`,
    moderada: matR >= prom
      ? `${region.nombre_largo} concentra una matrícula de ${c.nombre} sobre el promedio regional del país (${fmt(matR)} vs ${fmt(prom)}), pero el sector ${sector.label} aún registra demanda de talento sin cubrir a nivel nacional.`
      : `La formación de ${c.nombre} en ${region.nombre_largo} (${fmt(matR)} matriculados) está bajo el promedio regional del país (${fmt(prom)}), aunque la presión de demanda del sector ${sector.label} es acotada.`,
    suficiente: `La oferta formativa de ${c.nombre} en ${region.nombre_largo} (${fmt(matR)} matriculados) aparece alineada con las señales de demanda actuales del sector ${sector.label}.`,
  }[estado.clave];

  const s2 = tend.pct != null && Math.abs(tend.pct) >= 5
    ? (tend.pct > 0
      ? `La demanda del sector creció ${tend.pct}% la última semana.`
      : `La demanda del sector se redujo ${Math.abs(tend.pct)}% la última semana.`)
    : `Las señales de demanda del sector se han mantenido estables en el registro semanal.`;

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
    moderada: `Se recomienda monitorear la evolución semanal de la demanda y fortalecer la vinculación entre las instituciones formadoras de la región y los empleadores del sector ${sector.label} (prácticas, titulación conjunta, formación dual).`,
    suficiente: `La oferta actual no requiere intervención inmediata. Se recomienda mantener los cupos vigentes y revisar este informe periódicamente para detectar cambios en la demanda.`,
  }[estado.clave];
  return base;
}

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
  const selC = $("sel-carrera");
  for (const sid of ORDEN_SECTORES) {
    const carreras = DATA.carreras.filter((c) => c.sector === sid);
    if (!carreras.length) continue;
    const g = document.createElement("optgroup");
    g.label = DATA.sectores[sid].label;
    for (const c of carreras) {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.nombre;
      g.appendChild(o);
    }
    selC.appendChild(g);
  }
}

function diasDesde(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000));
}

function textoActualizado() {
  const d = diasDesde(DATA.fuente_actualizada);
  if (d == null) return "Actualización semanal";
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
    ? "La información se actualiza automáticamente cada semana."
    : `La información se actualiza automáticamente cada semana · ${textoActualizado()}.`;
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
  const tend = calcularTendencia(c.sector);

  document.title = `${c.nombre} · ${region.nombre} — Talento País`;

  /* 1 · Encabezado */
  $("inf-sector").textContent = sector.label;
  $("inf-carrera").textContent = c.nombre;
  $("inf-region").textContent = region.nombre_largo;
  $("inf-actualizado").textContent = textoActualizado();

  /* 2 · KPIs */
  $("kpi-vacantes").textContent = sinDemanda ? "s/d" : fmt(sector.demanda);
  $("kpi-vacantes-sub").textContent = sinDemanda
    ? "sin registro de demanda esta semana"
    : `sector ${sector.demanda_sector} · nivel nacional`;
  $("kpi-matricula").textContent = fmt(matR);
  $("kpi-matricula-sub").textContent = `matriculados en la región (Mineduc 2025)`;
  $("kpi-brecha").textContent = `${estado.emoji} ${estado.corto}`;
  $("kpi-brecha-sub").textContent = "en esta región";
  if (sinDemanda) {
    $("kpi-tendencia").textContent = "s/d";
    $("kpi-tendencia-sub").textContent = "sin registro de demanda del sector";
  } else {
    $("kpi-tendencia").textContent = `${tend.flecha} ${tend.texto}`;
    $("kpi-tendencia-sub").textContent = tend.detalle;
  }

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

  /* 7 · Tendencia */
  renderTendencia(tend, sector);

  /* 8 · Acordeones */
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
  const items = [
    {
      dt: "Matrícula de la carrera",
      dd: `${region.nombre}: <strong>${fmt(matR)}</strong><span class="vs">Promedio regional del país: ${fmt(c.promedio_regional)}</span>`,
    },
    {
      dt: "Nivel de brecha",
      dd: `${region.nombre}: <strong>${esc(estado.corto)}</strong><span class="vs">Sector a nivel nacional: ${esc(nivelATexto(sector.nivel_brecha))}</span>`,
    },
    {
      dt: "Cobertura territorial",
      dd: `<strong>${c.n_regiones_con_oferta} de 16</strong> regiones<span class="vs">imparten esta carrera</span>`,
    },
    {
      dt: "Matrícula nacional",
      dd: `<strong>${fmt(c.matricula_nacional)}</strong><span class="vs">estudiantes en todo Chile</span>`,
    },
  ];
  $("contexto-lista").innerHTML = items
    .map((i) => `<div class="contexto-item"><dt>${i.dt}</dt><dd>${i.dd}</dd></div>`)
    .join("");
}

function nivelATexto(n) {
  return n === "ALTA" ? "Alta" : n === "MEDIA" ? "Media" : n === "BAJA" ? "Baja" : "Sin datos";
}

function renderTendencia(tend, sector) {
  const cont = $("tendencia-chart");
  const nota = $("tendencia-nota");
  const serie = tend.serie;

  if (!serie.length) {
    cont.innerHTML = `<p class="sin-datos">Sin datos de demanda para este sector.</p>`;
    nota.textContent = "";
    return;
  }
  if (serie.length === 1) {
    cont.innerHTML = `<p class="sin-datos" style="padding:18px 0;">Registro actual: <strong>${fmt(serie[0].v)}</strong> vacantes y señales de demanda (${fechaCorta(serie[0].fecha)}).</p>`;
    nota.textContent = "La serie semanal comenzó a registrarse recientemente; el gráfico se construirá de forma automática con cada actualización.";
    return;
  }

  /* Línea SVG minimalista */
  const W = 400, H = 150, PAD = { t: 16, r: 14, b: 26, l: 38 };
  const vals = serie.map((p) => p.v);
  const vMin = Math.min(...vals), vMax = Math.max(...vals);
  const span = vMax - vMin || 1;
  const x = (i) => PAD.l + (i * (W - PAD.l - PAD.r)) / (serie.length - 1);
  const y = (v) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - vMin) / span);
  const pts = serie.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const ult = serie[serie.length - 1];

  cont.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución semanal de la demanda del sector">
      <line x1="${PAD.l}" y1="${y(vMin)}" x2="${W - PAD.r}" y2="${y(vMin)}" stroke="#E2E8F0" stroke-width="1"/>
      <line x1="${PAD.l}" y1="${y(vMax)}" x2="${W - PAD.r}" y2="${y(vMax)}" stroke="#E2E8F0" stroke-width="1"/>
      <text x="${PAD.l - 6}" y="${y(vMax) + 4}" text-anchor="end" font-size="11" fill="#64748b">${vMax}</text>
      <text x="${PAD.l - 6}" y="${y(vMin) + 4}" text-anchor="end" font-size="11" fill="#64748b">${vMin}</text>
      <polyline points="${pts}" fill="none" stroke="#0891B2" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${serie.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="3" fill="#0891B2"/>`).join("")}
      <circle cx="${x(serie.length - 1)}" cy="${y(ult.v)}" r="5" fill="#0B3D8A"/>
      <text x="${PAD.l}" y="${H - 6}" font-size="11" fill="#64748b">${fechaCorta(serie[0].fecha)}</text>
      <text x="${W - PAD.r}" y="${H - 6}" text-anchor="end" font-size="11" fill="#64748b">${fechaCorta(ult.fecha)}</text>
    </svg>`;
  nota.textContent = `Vacantes y señales de demanda del sector ${sector.label} registradas semana a semana (nivel nacional).`;
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

  /* Comparación entre regiones (top 6 + la consultada) */
  const ranking = DATA.regiones
    .map((r) => ({ r, m: c.regiones[r.id] ? c.regiones[r.id].matricula : 0 }))
    .sort((a, b) => b.m - a.m);
  const top = ranking.slice(0, 6);
  if (!top.some((t) => t.r.id === region.id)) {
    top.push(ranking.find((t) => t.r.id === region.id));
  }
  $("acc-regiones").innerHTML = `
    <table class="tabla-simple">
      <thead><tr><th>Región</th><th class="num">Matriculados</th></tr></thead>
      <tbody>${top
        .map((t) => `<tr class="${t.r.id === region.id ? "destacada" : ""}"><td>${esc(t.r.nombre_largo)}</td><td class="num">${fmt(t.m)}</td></tr>`)
        .join("")}</tbody>
    </table>
    <p style="margin-top:10px;" class="sin-datos">Promedio regional del país: ${fmt(c.promedio_regional)} matriculados.</p>`;

  /* Diagnóstico del sector */
  const demandaPrestada = sector.demanda_sector && sector.demanda_sector !== sector.label;
  $("acc-sector").innerHTML = sector.diagnostico
    ? `${demandaPrestada ? `<p class="sin-datos">Las señales de demanda de este informe provienen del análisis nacional del sector «${esc(sector.demanda_sector)}», que agrupa a ${esc(sector.label)}.</p>` : ""}
       <p>${esc(sector.diagnostico)}</p>
       <p class="sin-datos">Demanda registrada esta semana: ${fmt(sector.demanda)} vacantes y señales de demanda a nivel nacional.</p>`
    : `<p class="sin-datos">El pipeline semanal aún no registra señales de demanda específicas para ${esc(sector.label)}. La evaluación de este informe se basa únicamente en la oferta formativa (Mineduc 2025).</p>`;

  /* Metodología */
  $("acc-metodo").innerHTML = `
    <p><strong>Fuentes.</strong> Matrícula: Mineduc — Matrícula en Educación Superior 2025 (dato oficial, por carrera, institución y región). Demanda: pipeline semanal automatizado que recopila ofertas laborales, licitaciones de Mercado Público y concursos ANID asociados a cada sector estratégico.</p>
    <p><strong>Qué significa "vacantes y señales de demanda".</strong> Es el número de oportunidades activas detectadas para el sector a nivel <em>nacional</em>. Hoy la demanda no está desagregada por carrera ni por región; por eso se presenta como señal sectorial y así debe interpretarse.</p>
    <p><strong>Cómo se calcula el estado.</strong> Reglas fijas y auditables (sin IA): se combina el nivel de brecha nacional del sector con la matrícula de la carrera en la región comparada contra el promedio regional del país. Ejemplo: sector con brecha alta + región sin matrícula = brecha crítica.</p>
    <p><strong>Limitaciones.</strong> Los datos de demanda son señales, no un censo de vacantes; la matrícula corresponde al año 2025 y se actualiza anualmente; las recomendaciones son orientativas y no reemplazan estudios sectoriales en profundidad.</p>
    <p class="sin-datos">Última actualización del pipeline: ${DATA.fuente_actualizada ? esc(fechaCorta(DATA.fuente_actualizada.slice(0, 10))) : "s/d"} · Informe generado automáticamente.</p>`;
}

init();
