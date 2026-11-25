# Auditoría Final de Cierre Pre-Promoción — Cáceres 3D (`cc-blender-staging`)

**Rama de trabajo:** `feat/caceres-3d-reconstruction`  
**Escenario auditado:** [`public/world/cc-blender-staging/manifest.json`](../public/world/cc-blender-staging/manifest.json) (`900` chunks, `256 × 256 m`)  
**Estado de producción:** [`public/world/cc-monumental/manifest.json`](../public/world/cc-monumental/manifest.json) intacto (`0` cambios en `git status`)  
**Pruebas y E2E post-cambio:** `npm run format:check`, `npm run typecheck`, `npm run lint`, `npm test` (`16/16` ficheros, `68/68` tests), `npm run build`, `playwright.final-audit.config.ts` (`1/1` passed, `0` errores) y `npm run data:verify` (`900` chunks prod y staging OK)

---

## Resumen ejecutivo de cierre

| Área auditada | Estado previo | Estado final validado | Mejora |
| --- | --- | --- | --- |
| **Asentamiento y cubiertas** | `248` empotramientos `> 4 m` · `15` tejados enterrados (`< 1,5 m`) · `4` por debajo del centroide | **`0` tejados enterrados** · **`0` flotantes** (`maxFloatGap = 0`) · `208` apoyos en ladera `> 4 m` | **100 % tejados visibles** (`-16,1 %` `> 4 m`) |
| **Solapamientos y patios** | `591` `same-base` · `178` distintos · `7` duplicados OSM · fuga en costuras de chunk | `331` `same-base` (`-44,0 %`) · **`0` duplicados exactos** · `0` invasiones en patio · `0` costuras procedurales | **`-44 %` multiparte · `0` duplicados** |
| **Fidelidad de alturas** | `2.116` diferencias `> 35 %` respecto a `visualHeightMeters` | **`576` totales** (`504` subpartes `_p*`, `7` alzado en ladera, `65` tope proporción) · `0` en `estimated`/`unknown` | **`-72,8 %` discrepancias** |
| **Rendimiento panorámico (`wc-casco-panoramico-proxy`)** | `877` draw calls (`442 + 435`) · `57 HUD / 60 rAF FPS` · `gpuMainMs = 10,3 ms` | **`340` draw calls** (`189 + 151`) · **`60 HUD / 60 rAF FPS` (`16,66 ms`)** · `gpuMainMs = 8,95 ms` | **`-61,2 %` draw calls · `60 FPS` estables** |
| **Hardware limitado (`CPU 4×`)** | `10 rAF FPS` en `wc-casco-lowcpu-4x` | **`24 rAF FPS` (`26 HUD FPS`, `41,3 ms`)** con `286` draw calls | **`+140 %` rAF FPS** |
| **Cobertura geográfica** | `7.250` edificios únicos detectados | **`7.140` adaptados (`18.920` módulos) + `110` justificados** (`3` torres, `44` micro/ruinas, `63` duplicados/alas) | **Cuadre exacto `7.250`** |

---

## 1. Geometría y asentamiento sobre el terreno

Se investigaron los `2.293` empotramientos `> 2 m` y `248` `> 4 m` detectados inicialmente en los `900` chunks (con un máximo de `8,63 m`), comprobando que en laderas reales de Cáceres la base descendía según `minFootprintGround`, lo que permitía que inmuebles de baja altura quedaran semienterrados bajo la cota alta de su propia parcela (`15` casos con menos de `1,5 m` visibles sobre `maxY` y `4` por debajo del centroide).

- **Solución implementada ([`src/world/blender-geo-adapter.ts`](../src/world/blender-geo-adapter.ts)):** se sustituyó el apoyo ciego en cota mínima por [`sampleHillsideGroundFit`](../src/world/blender-geo-adapter.ts), evaluando `9` puntos en el `80 %` interior de la huella orientada (`min80`, `ctrY`, `max80`), limitando el hundimiento al alcance real del zócalo pétreo (`0,55 · scaleY`) y elevando la escala vertical cuando es necesario para asegurar al menos **`2,25 m`** de volumen útil por encima de `max80`, sin alterar jamás las coordenadas geográficas reales `[x, z]`.
- **Resultado en 900 chunks (`deep_diagnose` y `geo_audit_all900`):**
  - Edificios flotantes (`gap > 0,05 m`): **`0`** (`maxFloatGap = 0`).
  - Tejados enterrados (`visibleAboveMax < 1,5 m` o `visibleAboveCtr < 2 m`): **`0`** (eliminados `15/15` y `4/4`).
  - Empotramientos `> 2 m`: `2.293 -> 1.981`; empotramientos `> 4 m`: `248 -> 208`.
  - Caso máximo actual (`8,354 m`, bajando desde `8,63 m`): bloque residencial `w1330511130#m1` (`02b_modern_setback`, Nuevo Cáceres, `8` plantas, `25,92 m` de altura renderizada sobre una parcela con `7,77 m` de desnivel real), dejando `21,61 m` visibles sobre el centroide y `17,56 m` por encima de la cota más alta.

---

## 2. Solapamientos, patios y costuras de chunk

Se auditaron todos los pares con centro a `< 4,5 m` en los `900` chunks (`overlap_and_56`):

| Categoría | Antes | Después | Interpretación técnica |
| --- | --- | --- | --- |
| **Subpartes mismo edificio (`same-base`)** | `591` | **`331`** (`-44,0 %`) | Agrupación por `slotGroup` en `PlacedModuleRecord` para que las alas de una misma malla compartan medianera limpia sin apilar subpartes `_p0/_p1` sobre un mismo módulo base. |
| **Duplicados poligonales exactos (`< 4,5 m`)** | `7` | **`0`** (`-100 %`) | Filtro por contención mutua de centros dentro del polígono vecino (`pointInsidePolygon2d`) que elimina envolventes OSM duplicadas sin suprimir colindantes legítimos. |
| **Aleros o medianeras en contacto (`pen <= 0,65 m`)** | — | **`18`** | Contacto perimetral imperceptible de aleros en trama densa del casco y barrios. |
| **Parcelas irregulares o multiparte (`> 6` vértices / `_w*` / `_p*`)** | — | **`145`** | Encuentros en esquinas en `L`/`U` e intersecciones geométricas de subpartes diferenciadas (`185` pares `< 4,5 m` totales al recuperarse bordes interiores antes omitidos). |
| **Intersección visible entre vecinos estrechos** | `31` | **`22`** (`-29,0 %`) | Casos residuales puntuales en callejones estrechos donde dos huellas colindantes quedan a `< 4,5 m`. |
| **Invasiones en patios interiores** | `0` | **`0`** | Ningún módulo invade los anillos interiores (`innerRings`). |

Adicionalmente, se corrigió el registro de `handledBuildingIds` en [`buildBlenderGeoPlacements`](../src/world/blender-geo-adapter.ts) para los edificios que cruzan fronteras internas de chunk (`|cx| < 3840 && |cz| < 3840`), impidiendo que el chunk no propietario vuelva a extruir mallas procedurales grises. Esto eliminó al **100 %** los triángulos/cubiertas procedurales sueltas detectadas previamente en las costuras `x = 0`, `z = 0`, `z = 768` y `z = 1280`.

---

## 3. Alturas por procedencia y fiabilidad del dato

Siguiendo la prioridad **Catastro -> BuildingPart -> OSM explícito -> estimación**, se ampliaron los márgenes sanos de escala vertical (`MIN_HEIGHT_SCALE = 0,42`, `MAX_HEIGHT_SCALE = 1,48`, `MAX_HEIGHT_STRETCH = 2,15`) y se refinó la selección de variante en `resolveArchitecturalVariant` y `chooseSiblingVariant` para que edificios de 1–2 plantas utilicen modelos bajos (`05b_lowrise_village`, `05_extremadura_traditional`) y bloques altos (`>= 14,5 m` / `>= 18 m`) no queden forzados en arquetipos bajos. No se alteraron alturas origen reales.

| Procedencia en chunk (`heightOrigin`) | Módulos evaluados (`> 3,5 m`, no industrial) | Discrepancias `> 35 %` | Porcentaje | Notas |
| --- | --- | --- | --- | --- |
| **`catastro_floors`** | `12.678` | **`548`** | `4,3 %` | Mayoría (`504` totales entre fuentes) son subpartes `_p*` bajas comparadas por el auditor frente a `visualHeightMeters` del edificio completo. |
| **`osm_explicit`** | `313` | **`28`** | `8,9 %` | Torres/alas muy esbeltas limitadas por proporción arquitectónica de huecos. |
| **`estimated`** | `1.241` | **`0`** | `0,0 %` | Coherencia total sin forzar datos. |
| **`unknown` / `none`** | `1.840` | **`0`** | `0,0 %` | Coherencia total. |
| **Total global (`heightMismatchesGt35Pct`)** | `16.072` | **`576`** (antes `2.116`) | **`-72,8 %`** | Desglose exacto: `504` `_p*`, `7` alzados mínimos en ladera (`>= 2,25 m` sobre `maxY`), `65` topes sanos (`45` `_w*`). |

---

## 4. Rendimiento en WebGL real y optimizaciones

Implementado en [`src/world/blender-building-renderer.ts`](../src/world/blender-building-renderer.ts) y [`src/world/chunk-manager.ts`](../src/world/chunk-manager.ts):
1. **Agrupación `LOD2` en `THREE.BatchedMesh`:** cada chunk agrupa todos los módulos lejanos (`> 110 m`) en como máximo `2` draw calls (`1` lote opaco + `1` vidrio) con visibilidad por subcelda mediante `setVisibleAt`.
2. **Fusión estática de `ShadowProxy` (`SHADOW_PROXY_LAYER = 1`):** los proxies de sombra de cada subcelda se combinan en un único mesh estático opaco.
3. **Poda de sombras en vidrio (`CC_Atlas_Glass`):** los cristales dejan de emitir sombras en todos los LODs y proxies (`noShadowCast = true`).
4. **Material ligero en `LOD1`/`LOD2` y sombras de props en `LOD0`:** reducción a `MeshStandardMaterial` más allá de `42 m` y desactivación de sombras en `InstancedMesh` viarios fuera de chunks `LOD0`.

### Puntos de estrés y perfiles (observado en `final-audit-metrics.json`)

| Escenario | Main DC | Shadow DC | Total DC | Main Tris | Shadow Tris | CPU ms | GPU ms | HUD / rAF FPS | Mem. Mundo |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **`wc-casco-corazon-proxy`** (`-1_-1`) | `115` | `178` | **`293`** | `1.648.473` | `1.161.146` | `6,7` | `8,59` | **`60 / 60`** (`16,67 ms`) | `34,32 MiB` |
| **`wc-casco-panoramico-proxy`** (`4` chunks casco) | `189` | `151` | **`340`** *(antes `877`)* | `1.390.790` | `757.809` | `6,0` | `10,67` | **`60 / 60`** (`16,66 ms`) | `36,75 MiB` |
| **`wc-canovas-sanblas-proxy`** (`-2_0` / `-2_1`) | `122` | `131` | **`253`** | `1.333.640` | `1.019.357` | `7,7` | `9,66` | **`60 / 60`** (`16,67 ms`) | `40,63 MiB` |
| **`wc-casco-budget600k`** (perfil ligero) | `118` | `183` | **`301`** | `1.420.073` | `934.462` | `6,1` | `7,88` | **`60 / 60`** (`16,67 ms`) | `34,84 MiB` |
| **`wc-casco-lowcpu-4x`** (CPU `4×` slowdown) | `130` | `156` | **`286`** | `343.947` | `89.624` | `20,5` | `5,32` | **`26 / 24`** *(antes `10`)* | `36,60 MiB` |

### Comparativa directa con producción (`cc-monumental`)

| Vista | Mundo | Total DC | Main Tris | Shadow Tris | CPU ms | GPU ms | rAF FPS | Mem. Mundo |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `01-casco-plaza · calle` | Producción (`cc-monumental`) | `338` (`140+198`) | `2.415.277` | `300.288` | `3,8` | `7,60` | `60` | `437,20 MiB` |
| `01-casco-plaza · calle` | **Staging Blender** | **`298`** (`115+183`) | **`1.279.280`** | `1.343.306` | `3,9` | **`7,12`** | **`60`** | **`34,65 MiB`** (`-92,1 %`) |
| `01-casco-plaza · aerea` | Producción (`cc-monumental`) | `377` (`192+185`) | `2.055.633` | `315.036` | `4,4` | `6,77` | `60` | `457,02 MiB` |
| `01-casco-plaza · aerea` | **Staging Blender** | **`334`** (`179+155`) | **`1.352.066`** | `782.787` | `4,4` | `10,39` | `57` | **`37,08 MiB`** (`-91,9 %`) |
| `02-canovas · calle` | Producción (`cc-monumental`) | `152` (`108+44`) | `753.436` | `139.939` | `3,3` | `5,25` | `60` | `310,17 MiB` |
| `02-canovas · calle` | **Staging Blender** | `172` (`126+46`) | `1.181.750` | `671.815` | `4,9` | `7,66` | **`60`** | **`37,69 MiB`** (`-87,8 %`) |
| `02-canovas · aerea` | Producción (`cc-monumental`) | `184` (`134+50`) | `1.350.811` | `192.644` | `2,7` | `6,11` | `60` | `310,17 MiB` |
| `02-canovas · aerea` | **Staging Blender** | **`181`** (`136+45`) | **`1.115.424`** | `845.416` | `4,6` | **`5,70`** | **`60`** | **`37,69 MiB`** (`-87,8 %`) |

---

## 5. Galería visual completa en WebGL real (`36` capturas + `4` baseline)

Ejecución verificada tras el último cambio con [`tests/e2e/final-visual-audit.spec.ts`](../tests/e2e/final-visual-audit.spec.ts) (`36` capturas en `cc-blender-staging` + `4` en `cc-monumental`, `0` errores, media global `59,47 rAF FPS`, `110,8` main DC, `65,7` shadow DC, máximo `37,69 MiB`). La vista **`01b-casco-interior-personaje.png`** se reubicó en la placeta abierta (`x = -90, z = -64`) con encuadre limpio de fachadas palaciegas sin obstrucciones de muralla.

| Zona (`angle = calle`) | Main / Shadow DC | Main Tris | Shadow Tris | CPU / GPU ms | rAF FPS | Capturas generadas (`reports/screens/final-audit/`) |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| **01 · Casco (Plaza Mayor)** | `115 / 183` | `1.279.280` | `1.343.306` | `3,9 / 7,12` | **`60`** | `01-casco-plaza-{aerea,calle,personaje,fachada}.png` |
| **01b · Casco Interior / Palacios** | `136 / 175` | `1.644.716` | `958.656` | `7,3 / 9,96` | **`60`** | `01b-casco-interior-{aerea,calle,personaje,fachada}.png` |
| **02 · Cánovas / Centro** | `126 / 46` | `1.181.750` | `671.815` | `4,9 / 7,66` | **`60`** | `02-canovas-{aerea,calle,personaje,fachada}.png` |
| **03 · Nuevo Cáceres** | `116 / 38` | `908.276` | `676.637` | `4,2 / 1,54` | **`60`** | `03-nuevo-caceres-{aerea,calle,personaje,fachada}.png` |
| **04 · Mejostilla** | `144 / 32` | `728.700` | `464.364` | `4,8 / 8,37` | **`60`** | `04-mejostilla-{aerea,calle,personaje,fachada}.png` |
| **05 · Aldea Moret** | `132 / 51` | `824.312` | `592.327` | `5,1 / 6,85` | `58` | `05-aldea-moret-{aerea,calle,personaje,fachada}.png` |
| **06 · Zonas Industriales** | `62 / 25` | `759.746` | `433.653` | `2,7 / 5,12` | **`60`** | `06-industrial-{aerea,calle,personaje,fachada}.png` |
| **07 · Campus Universitario** | `90 / 35` | `401.484` | `335.497` | `6,6 / 8,37` | **`60`** | `07-campus-{aerea,calle,personaje,fachada}.png` |
| **08 · Zonas de Chalets** | `78 / 32` | `453.740` | `298.954` | `4,1 / 5,52` | `58` | `08-chalets-{aerea,calle,personaje,fachada}.png` |

---

## 6. Reconciliación completa de datos (`7.250 = 7.140 + 110`)

- **Edificios únicos identificados en los 900 chunks:** **`7.250`**.
- **Edificios adaptados con arquitectura Blender:** **`7.140`** (`98,48 %`), desplegados en **`18.920` módulos**.
- **Edificios excluidos del kit residencial Blender (`110`, `1,52 %`):**
  1. **`3` hitos con torre monumental dedicada:** `Torre de Bujaco` (`w385037728`), `Torre de Carvajal` (`w467504814`) y `Torre de Espaderos` (`w978693971`), renderizadas mediante su geometría singular.
  2. **`35` microconstrucciones con superficie `< 9 m²`** (casetas mínimas o restos catastrales).
  3. **`9` ruinas / cubiertas / obras con superficie `< 35 m²`**.
  4. **`63` huellas suprimidas por duplicidad o geometría inviable:** polígonos envolventes duplicados en OSM superpuestos a subpartes detalladas, alas estrechas/anidadas absorbidas en lotes colindantes y `2` restos en el margen exterior del mapa.

### Reparto de los `18.920` módulos por arquetipo y variante

- `04_commercial`: `3.774` | `05b_lowrise_village`: `3.562` | `07b_midrise_gabled`: `2.889` | `02_modern_residential`: `1.890` | `02b_modern_setback`: `1.682` | `05_extremadura_traditional`: `1.106` | `07c_midrise_attic`: `1.066` | `03_chalet`: `1.054` | `07_midrise_residential`: `783` (`4,1 %`) | `01_casco_house`: `618` | `08_civic_equipment`: `255` | `06_casco_palace`: `241`.

### Cobertura por barrios (`district_stats`)

| Barrio / Zona | Edificios adaptados | Módulos colocados | Arquetipo principal |
| --- | ---: | ---: | --- |
| `periferia` | `2.340` | `5.525` | `02_modern_residential` (`1.052`) / `07b_midrise_gabled` (`915`) |
| `canovas_centro` | `1.768` | `2.926` | `05b_lowrise_village` (`1.023`) / `07b_midrise_gabled` (`917`) |
| `mejostilla` | `646` | `2.436` | `05b_lowrise_village` (`701`) / `07b_midrise_gabled` (`440`) |
| `industrial` | `568` | `2.002` | `04_commercial` (`1.850`, `92,4 %`) |
| `aldea_moret` | `385` | `1.618` | `05b_lowrise_village` (`583`) / `05_extremadura_traditional` (`283`) |
| `nuevo_caceres` | `255` | `992` | `02_modern_residential` (`335`) / `02b_modern_setback` (`243`) |
| `casco` | `456` | `948` | `01_casco_house` (`381`) / `06_casco_palace` (`199`) |
| `campus` | `151` | `902` | `07b_midrise_gabled` (`253`) / `07c_midrise_attic` (`237`) / `08_civic` (`93`) |
| `comercial` | `218` | `754` | `04_commercial` (`463`, `61,4 %`) |
| `chalets` | `340` | `699` | `03_chalet` (`250`) / `05b_lowrise_village` (`187`) |
| `residencial` | `13` | `118` | `02_modern_residential` (`46`) / `02b_modern_setback` (`41`) |

---

## 7. Respaldo GitHub, limpieza y estado de promoción

- **Política de ramas y sincronización:** trabajo aislado en `feat/caceres-3d-reconstruction`, respaldado contra `origin/feat/caceres-3d-reconstruction` (`https://github.com/hhg-ptm/CTA.git`) con commits atómicos sin `--force` y sin tocar `main`.
- **Higiene de repositorio:** excluidos en `.gitignore` `data/raw/`, `data/staging/`, `public/world/cc-blender-staging/`, renders PNG/MP4 y backups `*.blend1`; cero rutas locales de usuario ni credenciales en el código ni en los informes versionados.
- **Producción protegida:** [`public/world/cc-monumental/manifest.json`](../public/world/cc-monumental/manifest.json) y todos sus chunks permanecen intactos en espera de aprobación explícita del usuario para la promoción controlada.
