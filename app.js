/* ═══════════════════════════════════════════════════════════════
   Talento País V2 — Informe Ejecutivo Regional
   Sin frameworks. Lee data/informe.json (pre-calculado semanalmente)
   y aplica un motor de REGLAS determinista (sin IA) para estado,
   resumen, hallazgos e interpretación. Ningún dato se estima ni se
   inventa: todo proviene del pipeline semanal y de Mineduc 2025.
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

/* ─── Etiquetas de los tipos de registro del pipeline ────────────
   [singular, plural]. Los tipos vienen de oportunidades.json;
   un tipo desconocido se humaniza (guiones bajos → espacios). */
const TIPO_DEMANDA = {
  oferta_laboral:           ["oferta laboral", "ofertas laborales"],
  licitacion:               ["licitación pública", "licitaciones públicas"],
  licitacion_publica:       ["licitación pública", "licitaciones públicas"],
  proyecto_noticia:         ["proyecto o anuncio sectorial", "proyectos y anuncios sectoriales"],
  beca_cooperacion:         ["beca de cooperación internacional", "becas de cooperación internacional"],
  beca_investigacion:       ["beca de investigación", "becas de investigación"],
  beca_convocatoria:        ["convocatoria de becas", "convocatorias de becas"],
  beca_concurso_id:         ["concurso ANID de I+D", "concursos ANID de I+D"],
  oportunidad_exportacion:  ["oportunidad de exportación", "oportunidades de exportación"],
  estadistica_mineria:      ["estadística sectorial (COCHILCO)", "estadísticas sectoriales (COCHILCO)"],
  estadistica_empleo:       ["estadística de empleo (INE)", "estadísticas de empleo (INE)"],
  analisis_cooperacion:     ["análisis de cooperación internacional", "análisis de cooperación internacional"],
  cooperacion_internacional:["instrumento de cooperación internacional", "instrumentos de cooperación internacional"],
  noticia_convocatoria:     ["convocatoria pública", "convocatorias públicas"],
  capacitacion_laboral:     ["programa de capacitación (SENCE)", "programas de capacitación (SENCE)"],
  programa_estado:          ["programa del Estado", "programas del Estado"],
  programa_convocatoria:    ["convocatoria de programa público", "convocatorias de programas públicos"],
};

function tipoLabel(tipo, n) {
  const par = TIPO_DEMANDA[tipo];
  if (par) return n === 1 ? par[0] : par[1];
  return tipo.replace(/_/g, " ");
}

/* ─── Origen de los registros: categorías para el detalle ────────
   Separa la demanda del mercado laboral (portales de empleo) de los
   instrumentos financiados por el Estado y de otras señales.      */
const CATEGORIA_TIPO = {
  oferta_laboral: "empleo",
  licitacion: "fondos", licitacion_publica: "fondos",
  beca_concurso_id: "fondos", beca_convocatoria: "fondos",
  noticia_convocatoria: "fondos", capacitacion_laboral: "fondos",
  programa_estado: "fondos", programa_convocatoria: "fondos",
  /* el resto cae en "otras" */
};
const CATEGORIAS = {
  empleo: {
    titulo: "Ofertas de empleo",
    desc: "Vacantes publicadas en portales laborales. Reflejan demanda de contratación efectiva; cuando el aviso menciona una región, se indica junto al registro.",
  },
  fondos: {
    titulo: "Instrumentos y fondos públicos",
    desc: "Licitaciones, concursos, becas y programas financiados por el Estado (Mercado Público, ANID, SENCE, entre otros). Suelen tener alcance nacional.",
  },
  otras: {
    titulo: "Otras señales sectoriales",
    desc: "Proyectos y anuncios del sector, estadísticas oficiales y cooperación internacional. Indican actividad y dinamismo, no vacantes directas.",
  },
};
const categoriaDeTipo = (tipo) => CATEGORIA_TIPO[tipo] || "otras";

/* "4 ofertas laborales, 2 licitaciones públicas y 1 concurso ANID" */
function fraseDesglose(desglose) {
  const partes = desglose.map((d) => `${fmt(d.n)} ${tipoLabel(d.tipo, d.n)}`);
  if (partes.length === 1) return partes[0];
  return partes.slice(0, -1).join(", ") + " y " + partes[partes.length - 1];
}

const SEVERIDAD = { suficiente: 1, moderada: 2, alta: 3, critica: 4 };

/* nivel de brecha sectorial → adjetivo para prosa */
function nivelPalabra(nivel) {
  return nivel === "ALTA" ? "alta" : nivel === "MEDIA" ? "moderada" : nivel === "BAJA" ? "acotada" : null;
}
function nivelATexto(n) {
  return n === "ALTA" ? "Alta" : n === "MEDIA" ? "Media" : n === "BAJA" ? "Baja" : "Sin datos";
}

/* ─── Motor de reglas: estado (semáforo) ─────────────────────────
   Entradas: nivel de brecha del sector (nacional, pipeline semanal),
   matrícula de la carrera en la región y promedio regional del país.
   Salidas: uno de 4 estados. Reglas documentadas en Preguntas
   frecuentes y en el README.                                       */
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
    critica:    { titulo: "Brecha crítica",   corto: "Crítica" },
    alta:       { titulo: "Brecha alta",      corto: "Alta" },
    moderada:   { titulo: "Brecha moderada",  corto: "Moderada" },
    suficiente: { titulo: "Oferta suficiente", corto: "Suficiente" },
  };
  return { clave, ...DEF[clave] };
}

/* Frase corta bajo el valor del estado (tarjeta del encabezado) */
function fraseEstado(matR, prom, nivel, sinDemanda) {
  const oferta = matR === 0
    ? "Sin oferta formativa en la región"
    : matR < prom ? "Oferta formativa inferior al promedio nacional"
    : "Oferta formativa sobre el promedio nacional";
  if (sinDemanda) return `${oferta}; sin registros de demanda sectorial en la última actualización.`;
  return `${oferta} y demanda sectorial ${nivelPalabra(nivel)}.`;
}

/* Interpretación institucional del estado (párrafo breve) */
function interpretacionEstado(estado, c, sector, matR, sinDemanda) {
  if (sinDemanda) {
    return "El pipeline aún no registra demanda para este sector, por lo que la evaluación se basa únicamente en la oferta formativa. El diagnóstico debe leerse como una señal de posición relativa de la región, no de escasez de talento.";
  }
  const demandaTxt = nivelPalabra(sector.nivel_brecha) || "moderada";
  const T = {
    critica: "La región no forma este perfil mientras el sector presenta señales intensas de demanda a nivel nacional. Es la combinación de mayor riesgo de la escala y amerita ser considerada en la planificación de la oferta formativa regional.",
    alta: "La capacidad formativa de la región es limitada frente al dinamismo que muestra el sector a nivel nacional. La situación amerita seguimiento cercano y evaluación de alternativas de formación.",
    moderada: matR === 0
      ? `La región presenta una oferta formativa inferior al promedio nacional para esta carrera. La presión de demanda del sector se mantiene ${demandaTxt}, por lo que actualmente no existen señales que justifiquen una expansión inmediata de la oferta, aunque se recomienda monitorear su evolución.`
      : `La oferta formativa regional existe pero es inferior al promedio nacional, en un contexto de demanda sectorial ${demandaTxt}. No se observan señales que exijan intervención inmediata; corresponde monitorear la evolución de la demanda.`,
    suficiente: "La oferta formativa regional aparece alineada con las señales de demanda del sector. No se observan señales que justifiquen modificar la oferta vigente; el monitoreo periódico de este sistema permite detectar cambios oportunamente.",
  };
  return T[estado.clave];
}


/* ─── Resumen ejecutivo por plantillas (sin IA) ──────────────────
   5 frases: situación regional → contexto nacional → demanda con
   desglose → implicancia. Lenguaje institucional, cifras trazables. */
function generarResumen(c, region, sector, estado, matR, sinDemanda) {
  const prom = c.promedio_regional;

  const s1 = matR === 0
    ? `${region.nombre_largo} no registra matrícula para ${c.nombre}.`
    : matR < prom
      ? `${c.nombre} registra ${fmt(matR)} estudiantes en ${region.nombre_largo}, cifra inferior al promedio regional del país (${fmt(prom)}).`
      : `${c.nombre} registra ${fmt(matR)} estudiantes en ${region.nombre_largo}, cifra superior al promedio regional del país (${fmt(prom)}).`;

  const s2 = c.n_regiones_con_oferta > 0
    ? `A nivel nacional, la carrera se imparte en ${c.n_regiones_con_oferta === 1 ? "una región" : `${c.n_regiones_con_oferta} regiones`} y registra una matrícula total de ${fmt(c.matricula_nacional)} estudiantes (Mineduc 2025).`
    : `A nivel nacional, la carrera casi no registra oferta formativa (Mineduc 2025).`;

  let s3;
  if (sinDemanda) {
    s3 = `El pipeline semanal aún no registra demanda para el sector ${sector.label}, por lo que este diagnóstico se basa únicamente en la oferta formativa.`;
  } else {
    const uno = sector.demanda === 1;
    const desg = sector.demanda_desglose
      ? `, ${uno ? "correspondiente" : "correspondientes"} a ${fraseDesglose(sector.demanda_desglose)}` : "";
    s3 = `La presión de demanda observada para el sector ${sector.label} es ${nivelPalabra(sector.nivel_brecha)}, con ${fmt(sector.demanda)} ${uno ? "registro detectado" : "registros detectados"} a nivel nacional durante la última actualización${desg}.`;
  }

  const s4 = {
    critica: `La ausencia de oferta local, combinada con la alta demanda del sector, sitúa a la región en el nivel más alto de la escala de brecha; el diagnóstico amerita ser considerado en la planificación de la oferta formativa regional.`,
    alta: `Se recomienda dar seguimiento cercano a la evolución del sector y evaluar alternativas de formación en conjunto con instituciones que ya imparten la carrera.`,
    moderada: matR === 0
      ? `Se recomienda mantener monitoreo periódico y evaluar alternativas de formación en conjunto con instituciones de regiones vecinas antes de crear nueva oferta permanente.`
      : `Se recomienda mantener monitoreo periódico de la demanda sectorial antes de introducir cambios en la oferta vigente.`,
    suficiente: `No se observan señales que justifiquen modificar la oferta vigente; el monitoreo periódico de este informe permite detectar cambios de tendencia de forma oportuna.`,
  }[estado.clave];

  return `${s1} ${s2} ${s3} ${s4}`;
}

/* ─── Hallazgos principales (3-4 bullets, por reglas) ──────────── */
function generarHallazgos(c, region, sector, estado, matR, regData, sinDemanda) {
  const out = [];

  if (matR === 0) out.push("No existe oferta regional para esta carrera.");
  else if (matR < c.promedio_regional) out.push(`La matrícula regional (${fmt(matR)}) está bajo el promedio nacional (${fmt(c.promedio_regional)}).`);
  else out.push(`La matrícula regional (${fmt(matR)}) supera el promedio nacional (${fmt(c.promedio_regional)}).`);

  const n = c.n_regiones_con_oferta;
  if (n <= 5)       out.push(`La carrera tiene baja cobertura territorial (${n} de 16 regiones).`);
  else if (n <= 10) out.push(`La carrera tiene cobertura territorial media (${n} de 16 regiones).`);
  else              out.push(`La carrera tiene amplia cobertura territorial (${n} de 16 regiones).`);

  if (sinDemanda) out.push(`El pipeline aún no registra demanda para el sector ${sector.label}.`);
  else out.push(`La demanda del sector ${sector.label} es ${nivelPalabra(sector.nivel_brecha)} a nivel nacional.`);

  if (matR === 0 && n > 0) out.push("La región depende de oferta formativa externa.");
  else if (regData && regData.instituciones.length) {
    const ni = regData.instituciones.length;
    out.push(ni === 1 ? "Una institución imparte la carrera en la región." : `${ni} instituciones imparten la carrera en la región.`);
  }

  return out.slice(0, 4);
}

/* ─── Interpretación: factores que explican el diagnóstico ──────
   Cualitativo a propósito: no repite cifras, explica el porqué.   */
function generarFactores(c, region, sector, estado, matR, sinDemanda) {
  const f = [];

  f.push({
    t: "Oferta formativa regional",
    d: matR === 0
      ? "La región no cuenta con instituciones que impartan esta carrera, por lo que la formación de este perfil depende de otras regiones."
      : matR < c.promedio_regional
        ? "Existe oferta local, pero su escala es menor a la que muestra el resto del país para esta carrera."
        : "La región concentra una oferta formativa comparativamente robusta para esta carrera.",
  });

  f.push({
    t: "Demanda del sector a nivel nacional",
    d: sinDemanda
      ? "El pipeline aún no registra demanda para este sector, por lo que el diagnóstico pondera únicamente la oferta formativa."
      : sector.nivel_brecha === "ALTA"
        ? "El sector muestra señales intensas de demanda de talento, lo que eleva el nivel de brecha de las regiones con poca formación."
        : sector.nivel_brecha === "MEDIA"
          ? "El sector muestra una presión de demanda moderada: existe actividad, pero sin señales de escasez aguda de talento."
          : "La presión de demanda observada para el sector es acotada; no se detectan señales de escasez de talento.",
  });

  f.push({
    t: "Cobertura territorial de la carrera",
    d: c.n_regiones_con_oferta <= 5
      ? "Pocas regiones imparten esta formación, lo que reduce las alternativas de articulación interregional y aumenta la dependencia de oferta externa."
      : c.n_regiones_con_oferta <= 10
        ? "La carrera se imparte en una parte del país, lo que abre alternativas de articulación con regiones que ya la ofrecen."
        : "La carrera está ampliamente distribuida en el país, lo que facilita convenios y movilidad formativa.",
  });

  const matDesc = matR === 0 ? "región sin matrícula" : matR < c.promedio_regional ? "matrícula regional bajo el promedio del país" : "matrícula regional sobre el promedio del país";
  f.push({
    t: "Regla de clasificación aplicada",
    d: sinDemanda
      ? `Sin registros de demanda + ${matDesc} → ${estado.titulo.toLowerCase()}. La regla es fija y auditable; el detalle está en Preguntas frecuentes.`
      : `Demanda sectorial ${nivelATexto(sector.nivel_brecha).toLowerCase()} + ${matDesc} → ${estado.titulo.toLowerCase()}. La regla es fija y auditable; el detalle está en Preguntas frecuentes.`,
  });

  return f;
}

/* ─── Instrumentos de política pública (opciones, no órdenes) ─── */
function generarInstrumentos(estado, sector) {
  const CATALOGO = {
    critica: [
      ["Convenios con instituciones formadoras de otras regiones", "para abrir programas o sedes en el territorio (CFT, IP o universidades que ya imparten la carrera)."],
      ["Becas regionales de movilidad", "para que estudiantes de la región cursen la carrera donde ya se imparte y retornen al territorio."],
      ["Formación dual y articulación con empresas del sector", "para acelerar la formación de perfiles con práctica temprana en la industria."],
      ["Programas SENCE de capacitación y reconversión", "orientados a trabajadores del territorio hacia los perfiles que el sector demanda."],
      ["Incentivos de atracción de talento", "mecanismos de contratación e instalación para profesionales formados fuera de la región."],
    ],
    alta: [
      ["Ampliación de cupos en instituciones existentes", "en las carreras y sedes que ya imparten esta formación en la región o en regiones vecinas."],
      ["Formación dual con empresas del sector", "para vincular la formación con demanda efectiva de la industria."],
      ["Programas SENCE de capacitación y reconversión laboral", "como respuesta de corto plazo mientras madura la oferta formal."],
      ["Becas regionales", "para reducir barreras de acceso a la formación en este perfil."],
      ["Articulación con empleadores", "prácticas profesionales, titulación conjunta y levantamiento de necesidades del sector."],
    ],
    moderada: [
      ["Monitoreo permanente de la demanda sectorial", "este informe se actualiza semanalmente y permite detectar cambios de tendencia."],
      ["Articulación entre instituciones formadoras y empresas", "prácticas, titulación conjunta y formación dual, sin expandir cupos todavía."],
      ["Evaluación conjunta con regiones vecinas", "antes de crear nueva oferta permanente, considerar convenios con instituciones que ya imparten la carrera."],
      ["Programas SENCE focalizados", "para necesidades puntuales del sector que no justifican oferta formal nueva."],
    ],
    suficiente: [
      ["Monitoreo permanente", "mantener la observación periódica que provee este sistema para detectar cambios en la demanda."],
      ["Mantención de vínculos con empleadores", "para sostener la pertinencia de la formación vigente."],
      ["Seguimiento de la inserción laboral de titulados", "cuando existan datos regionales disponibles, para validar la suficiencia de la oferta."],
    ],
  };
  const items = CATALOGO[estado.clave].slice();
  if (sector.accion) {
    items.push(["Línea señalada por el análisis sectorial nacional", `${sector.accion}.`]);
  }
  return items;
}

/* ─── Preguntas frecuentes ─────────────────────────────────────── */
function generarFAQ(sector) {
  const fuentes = (DATA.fuentes_pipeline || []).join(", ");
  return [
    ["¿Qué significa el nivel de brecha?",
     "Es una clasificación en cuatro niveles —oferta suficiente, brecha moderada, alta y crítica— que resume la relación entre la formación disponible en la región y las señales de demanda del sector. «Crítica» significa que la región no forma el perfil y el sector muestra alta demanda; «suficiente», que la oferta regional aparece alineada con las señales observadas."],
    ["¿Qué significa «demanda del sector»?",
     "Es el número de registros detectados por el pipeline para el sector durante la última actualización: ofertas laborales, licitaciones públicas, concursos, becas y otras señales públicas. Son señales de actividad, no un censo de vacantes, y así deben interpretarse."],
    ["¿Cómo se calcula el diagnóstico?",
     "Con reglas fijas y auditables, sin inteligencia artificial. Se combinan dos entradas: el nivel de demanda nacional del sector (alta, media o baja) y la matrícula de la carrera en la región comparada con el promedio regional del país. Por ejemplo: sector con demanda alta + región sin matrícula = brecha crítica. La misma entrada produce siempre el mismo resultado."],
    ["¿Por qué la demanda es nacional y no regional?",
     "Las fuentes públicas de las que se recopilan los registros (portales de empleo, licitaciones, concursos) no informan la ubicación de manera consistente, por lo que atribuirlos a una región sería poco confiable. El sistema prefiere presentar la demanda como señal sectorial nacional antes que estimar una desagregación regional sin sustento. Cuando un registro sí menciona una región en su propio texto, esa mención se muestra en el detalle de los registros (botón «Ver el detalle» en el indicador de demanda)."],
    ["¿De dónde provienen los registros de demanda?",
     "De tres orígenes que el detalle presenta por separado: ofertas de empleo publicadas en portales laborales (demanda de contratación), instrumentos y fondos públicos (licitaciones de Mercado Público, concursos ANID, becas y programas del Estado) y otras señales sectoriales (proyectos, estadísticas oficiales y cooperación internacional). Cada registro incluye su fuente y un enlace a la publicación original para su verificación."],
    ["¿Cada cuánto se actualizan los datos?",
     "La demanda sectorial se recopila automáticamente cada semana. La matrícula proviene del registro oficial Mineduc 2025 y se actualiza una vez al año, cuando el ministerio publica el nuevo registro."],
    ["¿Qué fuentes utiliza Talento País?",
     `Matrícula: Mineduc — Matrícula en Educación Superior 2025 (dato oficial por carrera, institución y región). Demanda: pipeline automatizado que monitorea ${DATA.fuentes_pipeline ? DATA.fuentes_pipeline.length : "múltiples"} fuentes públicas${fuentes ? `: ${fuentes}` : ""}.`],
  ];
}

/* ─── Mapa real de Chile (GeoJSON de regiones) ──────────────
   Mismo dataset público del mapa original de Talento País
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
      setTimeout(() => ($("btn-copiar").textContent = "Compartir"), 2000);
    } catch (e) { /* clipboard no disponible */ }
  });

  /* Alternador mirada regional / nacional (desplaza a la sección) */
  document.querySelectorAll(".vista-nav-btn").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".vista-nav-btn").forEach((x) => x.classList.toggle("activo", x === b));
      const destino = $(b.dataset.destino);
      if (destino) destino.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  /* Tabs mapa / ranking (visibles solo en pantallas angostas) */
  document.querySelectorAll(".comp-tab").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".comp-tab").forEach((x) => x.classList.toggle("activo", x === b));
      const grid = document.querySelector(".comparacion-grid");
      grid.dataset.panel = b.dataset.panel;
      if (b.dataset.panel === "panel-mapa" && _mapaLeafletMap) {
        setTimeout(() => {
          _mapaLeafletMap.invalidateSize();
          _mapaLeafletMap.fitBounds(MAPA_BOUNDS, { padding: [8, 8] });
        }, 50);
      }
    });
  });

  /* Modal de detalle de la demanda */
  $("dlg-cerrar").addEventListener("click", () => $("dlg-demanda").close());
  $("dlg-demanda").addEventListener("click", (e) => {
    if (e.target === $("dlg-demanda")) $("dlg-demanda").close();
  });

  /* Tooltips (?) — hover/focus vía CSS; click para pantallas táctiles */
  document.addEventListener("click", (e) => {
    const tip = e.target.closest(".tip");
    document.querySelectorAll(".tip.abierto").forEach((t) => { if (t !== tip) t.classList.remove("abierto"); });
    if (tip) tip.classList.toggle("abierto");
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

function textoRelativo() {
  const d = diasDesde(DATA.fuente_actualizada);
  if (d == null) return null;
  if (d === 0) return "hoy";
  if (d === 1) return "hace 1 día";
  return `hace ${d} días`;
}

function fechaCorta(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${d} ${MES[m - 1]} ${a}`;
}

function fechaLarga(iso) {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  const MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
               "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${d} de ${MES[m - 1]} de ${a}`;
}

function mostrarFrescura() {
  const b = $("badge-actualizado");
  const rel = textoRelativo();
  b.textContent = rel ? `Actualizado ${rel}` : "Actualización semanal";
  b.hidden = false;
  $("inicio-nota").textContent = rel
    ? `La información se actualiza automáticamente cada semana · Actualizado ${rel}.`
    : "La información se actualiza automáticamente cada semana.";
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

  document.title = `${c.nombre} · ${region.nombre} — Talento País`;

  /* 1 · Encabezado ejecutivo */
  $("inf-sector").textContent = sector.label;
  $("inf-carrera").textContent = c.nombre;
  $("inf-region").textContent = region.nombre_largo;
  const rel = textoRelativo();
  $("inf-actualizado").textContent = DATA.fuente_actualizada
    ? `Actualizado con datos del ${fechaLarga(DATA.fuente_actualizada)} (scraping semanal)${rel && rel !== "hoy" ? ` · ${rel}` : ""}`
    : "Actualización semanal automática";

  /* 2 · Estado general (tarjeta) */
  const card = $("estado-card");
  card.className = `estado-card e-${estado.clave}`;
  $("estado-valor").textContent = estado.corto;
  const sev = SEVERIDAD[estado.clave];
  $("estado-barras").innerHTML = [1, 2, 3, 4]
    .map((i) => `<span class="eb ${i <= sev ? "llena" : ""}" style="height:${8 + i * 5}px"></span>`)
    .join("");
  $("estado-frase").textContent = fraseEstado(matR, c.promedio_regional, sector.nivel_brecha, sinDemanda);
  $("estado-interpretacion").textContent = interpretacionEstado(estado, c, sector, matR, sinDemanda);

  /* 3 · Resumen ejecutivo + 6 · Hallazgos */
  $("resumen-texto").textContent = generarResumen(c, region, sector, estado, matR, sinDemanda);
  $("hallazgos-lista").innerHTML = generarHallazgos(c, region, sector, estado, matR, regData, sinDemanda)
    .map((h) => `<li>${esc(h)}</li>`).join("");

  /* 4 · Indicadores clave */
  renderKPIs(c, region, sector, estado, matR, regData, sinDemanda);

  /* 7 · Interpretación */
  $("factores-grid").innerHTML = generarFactores(c, region, sector, estado, matR, sinDemanda)
    .map((f) => `
      <div class="factor">
        <span class="factor-check" aria-hidden="true">✓</span>
        <div><p class="factor-titulo">${esc(f.t)}</p><p class="factor-texto">${esc(f.d)}</p></div>
      </div>`).join("");

  /* Oferta formativa en la región (solo si existe) */
  renderOferta(c, region, regData);

  /* 8 · Comparación regional: mapa + ranking */
  renderLeyenda();
  renderMapaRegiones(c, regionId);
  renderRanking(c, regionId);

  /* Contexto nacional del sector */
  renderSectorNacional(c, sector, sinDemanda);

  /* 10 · Evidencia considerada */
  renderEvidencia(sector, sinDemanda);

  /* 11 · Instrumentos */
  $("instrumentos-intro").textContent = `A partir del diagnóstico de ${estado.titulo.toLowerCase()}, estas son líneas de acción que suelen evaluarse en situaciones comparables:`;
  $("instrumentos-lista").innerHTML = generarInstrumentos(estado, sector)
    .map(([t, d]) => `<li><strong>${esc(t)}</strong> — ${esc(d)}</li>`).join("");

  /* 12 · Alcance y limitaciones */
  renderAlcance();

  /* 13 · Preguntas frecuentes */
  $("faq-lista").innerHTML = generarFAQ(sector)
    .map(([q, a]) => `
      <details class="acordeon">
        <summary>${esc(q)}</summary>
        <div class="acordeon-cuerpo"><p>${esc(a)}</p></div>
      </details>`).join("");

  /* Pie */
  const nFuentes = DATA.fuentes_pipeline ? DATA.fuentes_pipeline.length : null;
  $("pie-texto").textContent = `Talento País · Elaborado con datos públicos: Mineduc 2025${nFuentes ? ` y ${nFuentes} fuentes monitoreadas semanalmente` : ""} (ANID, Mercado Público, portales de empleo, entre otras). Documento de apoyo a la decisión; no reemplaza estudios sectoriales en profundidad.`;

  /* Reset de UI */
  document.querySelectorAll(".vista-nav-btn").forEach((b, i) => b.classList.toggle("activo", i === 0));
  $("vista-inicio").hidden = true;
  $("vista-informe").hidden = false;
  document.body.classList.remove("modo-hero");
  const v = $("hero-video");
  if (v && !v.paused) v.pause();
  window.scrollTo(0, 0);
}

/* ─── KPIs ejecutivos: cada indicador con su contexto y tooltip ── */
function renderKPIs(c, region, sector, estado, matR, regData, sinDemanda) {
  const nInst = regData ? regData.instituciones.length : 0;

  const cards = [];

  cards.push({
    label: "Matrícula regional 2025",
    tip: "Estudiantes matriculados en esta carrera en la región, según el registro oficial Mineduc — Matrícula en Educación Superior 2025. Es un dato oficial, no una estimación.",
    valor: fmt(matR), unidad: matR === 1 ? "estudiante" : "estudiantes",
    sub: matR === 0
      ? "Actualmente ninguna institución imparte esta carrera en la región."
      : nInst === 1
        ? "Una institución imparte esta carrera en la región."
        : `${nInst} instituciones imparten esta carrera en la región.`,
  });

  cards.push({
    label: "Promedio nacional por región",
    tip: "Matrícula nacional de la carrera dividida por las 16 regiones del país. Es el mismo promedio que usa la regla de clasificación de brecha, para que el diagnóstico sea trazable.",
    valor: fmt(c.promedio_regional), unidad: "estudiantes",
    sub: "Promedio de matrícula por región, considerando las 16 regiones del país.",
  });

  const n = c.n_regiones_con_oferta;
  cards.push({
    label: "Cobertura territorial",
    tip: "Número de regiones donde al menos una institución registra matrícula en esta carrera (Mineduc 2025). Una cobertura baja implica mayor dependencia de oferta formativa externa.",
    valor: `${n} <span class="kpi-de">de 16</span>`, unidad: "regiones", html: true,
    sub: n <= 5 ? "Carrera con baja cobertura territorial." : n <= 10 ? "Carrera con cobertura territorial media." : "Carrera con amplia cobertura territorial.",
  });

  let demandaSub;
  if (sinDemanda) {
    demandaSub = "Sin registros para este sector en la última actualización del pipeline.";
  } else if (sector.demanda_desglose) {
    demandaSub = `${sector.demanda === 1 ? "Compuesto" : "Compuestos"} por:<ul class="kpi-desglose">${sector.demanda_desglose
      .map((d) => `<li>${fmt(d.n)} ${esc(tipoLabel(d.tipo, d.n))}</li>`).join("")}</ul>`
      + (sector.demanda_registros
        ? `<button type="button" class="btn-detalle" id="btn-detalle-demanda">Ver el detalle de los registros →</button>`
        : "");
  } else {
    demandaSub = "Registros de actividad del sector detectados a nivel nacional.";
  }
  cards.push({
    label: "Demanda del sector (última actualización)",
    tip: "Registros detectados por el pipeline semanal para el sector: ofertas laborales, licitaciones públicas, concursos, becas y otras señales públicas. Son señales de actividad, no un censo de vacantes. La cifra es nacional; el detalle indica qué registros mencionan una región específica y enlaza a cada fuente original.",
    valor: sinDemanda ? "s/r" : fmt(sector.demanda),
    unidad: sinDemanda ? "sin registros" : (sector.demanda === 1 ? "registro detectado" : "registros detectados"),
    sub: demandaSub, subHTML: !sinDemanda && !!sector.demanda_desglose,
  });

  cards.push({
    label: "Matrícula nacional 2025",
    tip: "Total de estudiantes matriculados en esta carrera en todo el país (Mineduc 2025). Permite dimensionar la escala nacional de la formación de este perfil.",
    valor: fmt(c.matricula_nacional), unidad: "estudiantes",
    sub: "Estudiantes cursan esta carrera en todo Chile (Mineduc 2025).",
  });

  $("kpi-grid").innerHTML = cards.map((k) => `
    <div class="kpi" role="listitem">
      <p class="kpi-label">${esc(k.label)}
        <button type="button" class="tip" data-tip="${esc(k.tip)}" aria-label="Más información sobre ${esc(k.label)}">?</button>
      </p>
      <div class="kpi-valor-fila">
        <p class="kpi-valor">${k.html ? k.valor : esc(k.valor)}</p>
        ${k.badge ? `<span class="tend-badge t-${esc(k.badge.clave)}">${esc(k.badge.label)}</span>` : ""}
      </div>
      ${k.unidad ? `<p class="kpi-unidad">${esc(k.unidad)}</p>` : ""}
      <p class="kpi-sub">${k.subHTML ? k.sub : esc(k.sub)}</p>
    </div>`).join("");

  const btnDetalle = $("btn-detalle-demanda");
  if (btnDetalle) btnDetalle.addEventListener("click", () => abrirDetalleDemanda(sector));
}

/* ─── Detalle auditable de la demanda (modal) ────────────────────
   Muestra cada registro con su fuente, su enlace original y la
   región solo cuando el propio registro la menciona en su texto. */
function abrirDetalleDemanda(sector) {
  const dlg = $("dlg-demanda");
  $("dlg-titulo").textContent = `Sector ${sector.label}`;
  const fecha = DATA.fuente_actualizada ? ` · actualización del ${fechaLarga(DATA.fuente_actualizada)}` : "";
  $("dlg-meta").textContent = `${fmt(sector.demanda)} registros detectados a nivel nacional${fecha}`;

  const partes = [];

  /* Ubicación: cuántos registros mencionan una región en su texto */
  const u = sector.demanda_ubicacion;
  if (u) {
    const nCon = Math.max(0, (sector.demanda || 0) - u.sin_ubicacion);
    const chips = Object.entries(u.regiones || {}).map(([rid, n]) => {
      const r = DATA.regiones.find((x) => x.id === rid);
      return `<span class="dlg-chip-region">${esc(r ? r.nombre : rid)} · ${fmt(n)}</span>`;
    }).join("");
    partes.push(`
      <div class="dlg-ubicacion">
        <p class="dlg-sub-titulo">¿Dónde se necesita?</p>
        <p class="dlg-texto">${nCon === 0
          ? `Ninguno de los ${fmt(sector.demanda)} registros menciona una región específica en su texto: corresponden a señales de alcance nacional o sin ubicación informada. Los portales de empleo y los fondos estatales no siempre publican la región.`
          : `${fmt(nCon)} de ${fmt(sector.demanda)} registros mencionan explícitamente una región en su texto; el resto corresponde a señales de alcance nacional o sin ubicación informada (los portales de empleo y los fondos estatales no siempre publican la región).`}</p>
        ${chips ? `<div class="dlg-chips">${chips}</div>` : ""}
      </div>`);
  }

  /* Registros agrupados por origen (empleo / fondos públicos / otras) */
  const desglose = sector.demanda_desglose || [];
  for (const catId of ["empleo", "fondos", "otras"]) {
    const tiposCat = desglose.filter((d) => categoriaDeTipo(d.tipo) === catId);
    if (!tiposCat.length) continue;
    const cat = CATEGORIAS[catId];
    const nCat = tiposCat.reduce((a, d) => a + d.n, 0);

    const bloques = tiposCat.map((d) => {
      const regs = (sector.demanda_registros || {})[d.tipo] || [];
      const filas = regs.map((r) => {
        const chipsReg = (r.regiones || []).map((rid) => {
          const reg = DATA.regiones.find((x) => x.id === rid);
          return `<span class="dlg-chip-region">${esc(reg ? reg.nombre : rid)}</span>`;
        }).join("");
        const titulo = r.url
          ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.titulo)}</a>`
          : esc(r.titulo);
        return `<li class="dlg-registro">
          <p class="dlg-registro-titulo">${titulo}</p>
          <p class="dlg-registro-meta">
            ${r.fuente ? `<span class="dlg-chip-fuente">${esc(r.fuente)}</span>` : ""}
            ${r.org ? `<span class="dlg-registro-org">${esc(r.org)}</span>` : ""}
            ${chipsReg}
            ${r.monto ? `<span class="dlg-registro-monto">${esc(r.monto)}</span>` : ""}
          </p>
        </li>`;
      }).join("");
      const nota = regs.length < d.n
        ? `<p class="dlg-nota-muestra">Mostrando los ${regs.length} registros más relevantes de ${fmt(d.n)}.</p>` : "";
      return `<div class="dlg-tipo">
        <p class="dlg-tipo-titulo">${fmt(d.n)} ${esc(tipoLabel(d.tipo, d.n))}</p>
        <ul class="dlg-registros">${filas}</ul>${nota}
      </div>`;
    }).join("");

    partes.push(`
      <div class="dlg-categoria">
        <div class="dlg-cat-head">
          <p class="dlg-sub-titulo">${esc(cat.titulo)} <span class="dlg-cat-n">${fmt(nCat)}</span></p>
          <p class="dlg-texto">${esc(cat.desc)}</p>
        </div>
        ${bloques}
      </div>`);
  }

  partes.push(`<p class="dlg-pie">Registros recopilados automáticamente desde fuentes públicas durante la última actualización semanal. Son señales de actividad del sector —no un censo de vacantes— y pueden incluir avisos similares entre fuentes. Cada enlace lleva a la publicación original para su verificación.</p>`);

  $("dlg-cuerpo").innerHTML = partes.join("");
  $("dlg-cuerpo").scrollTop = 0;
  dlg.showModal();
}

/* ─── Oferta formativa en la región ─────────────────────────── */
function renderOferta(c, region, regData) {
  const sec = $("sec-oferta");
  if (!regData || !regData.instituciones.length) { sec.hidden = true; return; }
  sec.hidden = false;
  $("oferta-cuerpo").innerHTML = `
    <table class="tabla-simple">
      <thead><tr><th>Institución</th><th class="num">Matriculados 2025</th></tr></thead>
      <tbody>${regData.instituciones
        .map(([n, m]) => `<tr><td>${esc(n)}</td><td class="num">${fmt(m)}</td></tr>`)
        .join("")}</tbody>
    </table>
    <p class="tabla-fuente">Fuente: Mineduc — Matrícula en Educación Superior 2025.</p>`;
}

/* ─── Estado de brecha para una región y carrera dadas ─────── */
function estadoParaRegion(c, regionId) {
  const regData = c.regiones[regionId];
  const matR = regData ? regData.matricula : 0;
  const sector = DATA.sectores[c.sector];
  const sinDemanda = sector.demanda == null;
  return calcularEstado(sector.nivel_brecha, matR, c.promedio_regional, sinDemanda);
}

/* ─── Leyenda del mapa ──────────────────────────────────────── */
function renderLeyenda() {
  $("mapa-leyenda").innerHTML = [
    ["critica",    "Brecha crítica"],
    ["alta",       "Brecha alta"],
    ["moderada",   "Brecha moderada"],
    ["suficiente", "Oferta suficiente"],
  ].map(([cl, label]) =>
    `<span class="ley-item"><span class="ley-punto e-${cl}"></span>${label}</span>`
  ).join("");
}

/* ─── Ranking de regiones (según nivel de brecha) ───────────── */
function renderRanking(c, currentRegionId) {
  const filas = DATA.regiones.map((r) => {
    const e = estadoParaRegion(c, r.id);
    const regData = c.regiones[r.id];
    return {
      id: r.id, nombre: r.nombre,
      estado: e,
      mat: regData ? regData.matricula : 0,
      inst: regData ? regData.instituciones.length : 0,
    };
  }).sort((a, b) =>
    (SEVERIDAD[b.estado.clave] - SEVERIDAD[a.estado.clave]) || (b.mat - a.mat) || a.nombre.localeCompare(b.nombre));

  $("tabla-ranking").innerHTML = `
    <thead><tr><th></th><th>Región</th><th>Brecha</th><th class="num">Matrícula 2025</th><th class="num">Instituciones</th></tr></thead>
    <tbody>${filas.map((f, i) => `
      <tr class="${f.id === currentRegionId ? "destacada" : ""}" data-region="${esc(f.id)}" tabindex="0" role="button"
          aria-label="Abrir informe de ${esc(f.nombre)}">
        <td class="pos">${i + 1}</td>
        <td>${esc(f.nombre)}</td>
        <td><span class="ctx-badge e-${esc(f.estado.clave)}">${esc(f.estado.corto)}</span></td>
        <td class="num">${f.mat > 0 ? fmt(f.mat) : "0"}</td>
        <td class="num">${f.inst > 0 ? fmt(f.inst) : "—"}</td>
      </tr>`).join("")}</tbody>`;

  $("ranking-nota").textContent = "La demanda del sector se mide a nivel nacional y es común a todas las regiones; el ranking ordena por nivel de brecha y, dentro de cada nivel, por matrícula. Haga clic en una región para abrir su informe.";

  $("tabla-ranking").querySelectorAll("tr[data-region]").forEach((tr) => {
    const abrir = () => {
      const key = tr.dataset.region;
      $("sel-region").value = key;
      history.pushState({ region: key, carrera: c.id }, "", `?region=${key}&carrera=${c.id}`);
      renderInforme(key, c.id);
    };
    tr.addEventListener("click", abrir);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } });
  });
}

/* ─── Contexto nacional del sector ──────────────────────────── */
function renderSectorNacional(c, sector, sinDemanda) {
  const demandaPrestada = sector.demanda_sector && sector.demanda_sector !== sector.label;
  /* El diagnóstico del pipeline trae "Acción: …" al final; esa parte
     se presenta como opción en la sección de instrumentos, no aquí. */
  const diag = (sector.diagnostico || "").replace(/Acci[oó]n:.*$/s, "").trim();

  $("sector-cuerpo").innerHTML = `
    <div class="sector-stats">
      <div class="sector-stat">
        <p class="ctx-label">Nivel de demanda del sector</p>
        <p class="sector-stat-valor">${esc(nivelATexto(sector.nivel_brecha))}</p>
        <p class="ctx-compare">clasificación nacional del pipeline</p>
      </div>
      <div class="sector-stat">
        <p class="ctx-label">Registros de demanda</p>
        <p class="sector-stat-valor">${sinDemanda ? "s/r" : fmt(sector.demanda)}</p>
        <p class="ctx-compare">última actualización · nivel nacional</p>
      </div>
      <div class="sector-stat">
        <p class="ctx-label">Matrícula nacional del sector</p>
        <p class="sector-stat-valor">${fmt(sector.matricula_nacional_sector)}</p>
        <p class="ctx-compare">estudiantes en carreras del sector</p>
      </div>
    </div>
    ${diag ? `<p class="sector-diag">${esc(diag)}</p>` : `<p class="sector-diag sin-datos">El pipeline aún no registra señales de demanda específicas para ${esc(sector.label)}; la evaluación de este informe se basa únicamente en la oferta formativa.</p>`}
    ${demandaPrestada ? `<p class="sector-nota">Las señales de demanda de este informe provienen del análisis nacional del sector «${esc(sector.demanda_sector)}», que agrupa a ${esc(sector.label)}.</p>` : ""}`;
}

/* ─── Evidencia considerada ─────────────────────────────────── */
function renderEvidencia(sector, sinDemanda) {
  const nFuentes = DATA.fuentes_pipeline ? DATA.fuentes_pipeline.length : null;
  const fuentesSector = sector.fuentes_demanda && sector.fuentes_demanda.length
    ? ` Para este sector, la última actualización registró datos de: ${sector.fuentes_demanda.join(", ")}.`
    : "";
  const items = [
    ["Matrícula oficial Mineduc 2025",
     "Registro oficial por carrera, institución y región. Es la base de todos los indicadores de oferta formativa de este informe."],
    ["Demanda recopilada mediante scraping semanal",
     `Pipeline automatizado que monitorea ${nFuentes ? nFuentes : "múltiples"} fuentes públicas (portales de empleo, Mercado Público, ANID, entre otras).${fuentesSector}`],
    ["Cobertura territorial",
     "Presencia de la carrera en las 16 regiones del país, calculada desde el mismo registro oficial de matrícula."],
    ["Comparación nacional",
     "La matrícula regional se contrasta con el promedio de las 16 regiones, aplicando el mismo criterio en todo el país."],
    ["Reglas auditables para la clasificación de brechas",
     "El nivel de brecha se obtiene con reglas fijas y verificables, sin inteligencia artificial: el mismo dato de entrada produce siempre el mismo diagnóstico."],
  ];
  $("evidencia-grid").innerHTML = items.map(([t, d]) => `
    <div class="evidencia-item">
      <span class="factor-check" aria-hidden="true">✓</span>
      <div><p class="factor-titulo">${esc(t)}</p><p class="factor-texto">${esc(d)}</p></div>
    </div>`).join("");
}

/* ─── Alcance y limitaciones ────────────────────────────────── */
function renderAlcance() {
  const nSemanas = (DATA.historico || []).length;
  $("alcance-lista").innerHTML = [
    "Matrícula oficial Mineduc 2025, por carrera, institución y región.",
    "Registros semanales de demanda sectorial a nivel nacional, con desglose por tipo (ofertas laborales, licitaciones, concursos, entre otros).",
    "Cobertura territorial y comparación entre las 16 regiones del país.",
    `Serie histórica de demanda (${nSemanas} ${nSemanas === 1 ? "actualización registrada" : "actualizaciones registradas"} a la fecha).`,
  ].map((x) => `<li>${esc(x)}</li>`).join("");

  $("limitaciones-lista").innerHTML = [
    "Demanda específica por carrera: los registros se asocian a sectores, no a carreras individuales.",
    "Demanda desagregada por región o comuna: las fuentes no informan la ubicación de forma consistente.",
    "Salarios regionales e inserción laboral de titulados.",
    "Proyecciones demográficas y de empleo regional.",
  ].map((x) => `<li>${esc(x)}</li>`).join("");
}

/* ─── Mapa interactivo de Chile por brecha (mapa real, Leaflet) ─ */
async function renderMapaRegiones(c, currentRegionId) {
  if (!window.L) return;

  if (_mapaLeafletMap) { _mapaLeafletMap.remove(); _mapaLeafletMap = null; }

  const mapEl = $("mapa-leaflet");
  mapEl.innerHTML = "";
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
        const e = estadoParaRegion(c, key);
        const matTxt = regData ? `Matrícula 2025: ${fmt(regData.matricula)}` : "Matrícula 2025: 0 (sin oferta)";
        const instTxt = regData && regData.instituciones.length
          ? `Instituciones: ${regData.instituciones.length}`
          : "Sin instituciones que la impartan";

        layer.bindTooltip(
          `<strong>${esc(r.nombre_largo)}</strong><br>
           Brecha: <strong>${esc(e.corto)}</strong><br>
           ${esc(matTxt)}<br>${esc(instTxt)}`,
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
