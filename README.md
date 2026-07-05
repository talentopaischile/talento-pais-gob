# Talento País V2 — Informe Ejecutivo Regional

Panel para tomadores de decisión del Estado de Chile (ministerios, gobiernos
regionales, SENCE, CORFO, asesores). Responde en menos de un minuto:

1. **¿Qué está ocurriendo?** — con una carrera estratégica en una región
2. **¿Qué tan grave es?** — semáforo de brecha 🟢🟡🟠🔴
3. **¿Qué acción debería evaluarse?** — recomendación generada por reglas (sin IA)

## Flujo

Seleccionar Región → Seleccionar Carrera → Informe Ejecutivo

## Arquitectura

```
index.html / styles.css / app.js   ← frontend estático, sin frameworks ni build
data/informe.json                  ← único archivo de datos, pre-calculado
scripts/generar_informe.py         ← genera informe.json desde el repo original
.github/workflows/datos.yml        ← lo regenera cada martes y commitea → Vercel redespliega
```

Fuente de datos: repo [talento-pais-original](https://github.com/talentopaischile/talento-pais-original)
(pipeline semanal: Mineduc, ANID, Mercado Público, portales de empleo).

## Desarrollo local

```bash
# Regenerar datos desde una copia local del repo original
python scripts/generar_informe.py --local "../talento-pais-original"

# Servir
python -m http.server 3010
# → http://localhost:3010
```

## Reglas del semáforo (deterministas, auditables)

| Brecha nacional del sector | Matrícula regional = 0 | Bajo promedio regional | Sobre promedio |
|---|---|---|---|
| ALTA  | 🔴 Crítica  | 🟠 Alta     | 🟡 Moderada |
| MEDIA | 🟠 Alta     | 🟡 Moderada | 🟢 Suficiente |
| BAJA  | 🟡 Moderada | 🟢 Suficiente | 🟢 Suficiente |
| Sin datos de demanda | 🟠 Alta* | 🟡 Moderada* | 🟢 Suficiente* |

\* evaluación basada solo en oferta formativa.

## Deploy

Proyecto estático en Vercel: importar el repo, sin comando de build,
directorio de salida `./`. Cada commit del workflow semanal redespliega solo.

### Configuración única (el repo de datos es privado)

1. En GitHub → Settings → Developer settings → Fine-grained personal access
   tokens: crear un token con acceso de **solo lectura de contenidos** al repo
   `talentopaischile/talento-pais-original`.
2. En este repo → Settings → Secrets and variables → Actions: crear el secret
   `DATA_REPO_TOKEN` con ese token.
3. Probar con Actions → "Actualización semanal de datos" → Run workflow.
