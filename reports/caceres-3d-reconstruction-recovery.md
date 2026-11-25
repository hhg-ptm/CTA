# Estrategia de Versionado, Respaldo y Reproducibilidad (`feat/caceres-3d-reconstruction`)

## 1. Política de Ramas y Seguridad

- **Rama activa de desarrollo:** `feat/caceres-3d-reconstruction` (remoto `origin`: `https://github.com/hhg-ptm/CTA.git`).
- **Aislamiento de `main` y producción:** Todo el trabajo de la reconstrucción Blender se mantiene en `feat/caceres-3d-reconstruction` sin hacer merge a `main` ni modificar [`public/world/cc-monumental/`](../public/world/cc-monumental/manifest.json) hasta aprobación explícita.
- **Integridad:** Nunca se usa `--force` push, ni se versionan cachés (`node_modules/`, `dist/`, `test-results/`, `playwright-report/`, `__pycache__/`), capturas pesadas (`reports/screens/`, `reports/blender_experiment/`) ni respaldos temporales de Blender (`*.blend1`).

## 2. Qué Está Versionado en Git vs. Qué Se Regenera

| Conjunto                                                                                                                 | Estado en Git               |            Tamaño en disco | Motivo / Estrategia                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------- | -------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Código TypeScript, adaptador y tests (`src/`, `tests/`, `playwright.*.config.ts`)                                        | **Versionado en Git**       |                  `< 1 MiB` | Fuente canónica de simulación, render e instanciado                                                                                                                                          |
| Scripts Blender (`tools/blender_buildings/*.py`, 16 archivos)                                                            | **Versionado en Git**       |                 `0,43 MiB` | Generadores deterministas headless de la biblioteca de 8 edificios + 4 variantes + atlas                                                                                                     |
| Biblioteca GLB + Atlas + Manifiesto (`public/models/buildings/`, 40 archivos)                                            | **Versionado en Git**       | `7,90 MiB` (`max 866 KiB`) | Assets binarios optimizados bajo atlas compartido de 2 materiales (`CC_Atlas_Opaque`, `CC_Atlas_Glass`); empaquetado delta de Git ~`4 MiB`, muy inferior al límite de `50/100 MiB` de GitHub |
| Pipeline GIS y reconstrucción staging (`tools/caceres_geo_processing.py`, `build_blender_staging_all900.py`)             | **Versionado en Git**       |                `< 0,2 MiB` | Scripts reproducibles para generar `cc-blender-staging` desde `cc-monumental` + Catastro + OSM                                                                                               |
| Documentación y auditorías (`PROGRESS.md`, `DECISIONS.md`, `reports/caceres-final-visual-audit.md`, este documento)      | **Versionado en Git**       |                `< 0,2 MiB` | Registro recuperable de decisiones, métricas y estado de verificación                                                                                                                        |
| Datos fuente externos (`data/raw/`)                                                                                      | **Ignorado (`.gitignore`)** |                `38,80 MiB` | Extractos públicos OSM/CNIG MDT05/Catastro INSPIRE descargables con `tools/fetch-osm.mjs`, `fetch-elevation.mjs` y ATOM Catastro                                                             |
| Enriquecimiento y mundo staging (`data/staging/`, `public/world/cc-blender-staging/`)                                    | **Ignorado (`.gitignore`)** |         `6,62 + 50,62 MiB` | Salida determinista regenerable en segundos con `python tools/build_blender_staging_all900.py` sin duplicar 904 binarios `.bin` en cada iteración                                            |
| Capturas de validación y `.blend`/renders experimentales (`reports/screens/`, `reports/blender_experiment/`, `*.blend1`) | **Ignorado (`.gitignore`)** |        `91,20 + 35,57 MiB` | Evita inflar el historial Git con PNGs e intermedios locales                                                                                                                                 |

## 3. Estrategia Git LFS

El cliente `git-lfs` (`git-lfs/3.7.1`) está disponible en el entorno local, aunque actualmente no se activa `.gitattributes` porque los GLB finales individuales oscilan entre `23 KiB` (`LOD2`) y `866 KiB` (`LOD0`) — sumando `7,90 MiB` en disco — y se comprimen bien en Git estándar. Conviene activar Git LFS (`git lfs track`) únicamente si en el futuro se versionan:

1. Ficheros `.blend` complejos con texturas empaquetadas (`> 5–10 MiB`).
2. Capturas congeladas o dumps binarios `public/world/*.bin` > `50 MiB` en caso de querer conservar snapshots precompilados sin depender de fuentes externas.
3. Ficheros fuente `data/raw/*.zip` o `*.json` (`> 10 MiB`) si se quisiera congelar exactamente el extracto histórico en GitHub sin volver a descargar de Overpass/Catastro.

## 4. Receta de Recuperación Completa desde un `git clone` Limpio

1. Instalar dependencias y validar el juego con los GLB ya versionados en Git:
   - `git clone -b feat/caceres-3d-reconstruction https://github.com/hhg-ptm/CTA.git`
   - `npm install`
   - `npm run typecheck && npm run lint && npm test && npm run data:verify && npm run build`
2. _(Opcional)_ Regenerar los GLB y el atlas desde los scripts Blender 5.2:
   - `"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python-exit-code 1 -P tools/blender_buildings/run_experiment.py`
   - `"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python-exit-code 1 -P tools/blender_buildings/export_variants.py`
3. Reconstruir el mundo completo de staging (`cc-blender-staging`, 900 chunks):
   - Colocar o descargar datos fuente en `data/raw/` (`npm run data:osm:fresh`, `npm run data:elevation`, y los ZIP INSPIRE `BU`/`AD` de Cáceres en `data/raw/catastro-atom/`).
   - `python tools/caceres_geo_processing.py` _(genera `data/staging/cc-monumental/building_enrichment.json`)_
   - `python tools/build_blender_staging_all900.py` _(genera `public/world/cc-blender-staging/` y `data/staging/cc-blender-staging/`)_
   - `npm run data:verify -- --region cc-blender-staging`
4. Ejecutar auditoría visual en navegador real:
   - `npx playwright test --config=playwright.final-audit.config.ts`
