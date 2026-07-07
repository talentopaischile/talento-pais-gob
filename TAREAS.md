# Tareas — Rediseño Talento País Gob

Ficha ejecutiva para Gobiernos Regionales. Regla de oro: **nunca se muestra
información falsa** — todo dato proviene de Mineduc 2025 o del pipeline
semanal (`talento-pais-original`).

## Hechas

- [x] Pipeline: desglose de la demanda por tipo de registro (`demanda_desglose`),
      fuentes por sector (`fuentes_demanda`) y fuentes globales (`fuentes_pipeline`).
      El desglose solo se publica si su suma cuadra con la cifra oficial de `brechas.csv`.
- [x] Pipeline: detalle auditable de registros (`demanda_registros`: título, fuente,
      organización, URL, monto) y ubicación (`demanda_ubicacion`) detectada solo
      cuando el propio texto del registro menciona una región chilena.
- [x] Rediseño de la vista informe como Executive Brief: encabezado ejecutivo,
      tarjeta de estado con interpretación institucional, Resumen Ejecutivo +
      Hallazgos principales, 6 indicadores clave con contexto, tooltips (?),
      sección "¿Qué explica este diagnóstico?", comparación regional
      (mapa Leaflet + ranking), sector a nivel nacional, evidencia considerada,
      instrumentos de política pública (opciones, no órdenes), alcance y
      limitaciones, preguntas frecuentes.
- [x] Modal "Detalle de la demanda": registros separados por origen
      (ofertas de empleo / instrumentos y fondos públicos / otras señales),
      con enlace a cada publicación original y resumen de ubicación.

## Pendientes

- [ ] Verificación visual completa (desktop, móvil, impresión PDF).
- [ ] Evaluar en el pipeline la extracción de región desde la URL de los avisos
      (ej. getonbrd `...-santiago`) para mejorar la cobertura de ubicación.
- [ ] Variables aún no incorporadas (declaradas en "Alcance y limitaciones"):
      demanda por carrera, demanda comunal, salarios regionales, inserción
      laboral, proyecciones demográficas. Incorporarlas solo si aparece una
      fuente pública con calidad suficiente.
