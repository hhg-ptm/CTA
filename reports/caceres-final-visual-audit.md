# Auditoría Visual y Técnica Final — Cáceres Criminal (`cc-blender-staging`)

> **Estado de producción:** Este informe audita la reconstrucción completa de **900 chunks (`7.250` edificios únicos, `41.919` registros de features)** ejecutándose en el motor WebGL (`?world=cc-blender-staging`, `1440×900`) antes de autorizar su promoción a producción. La carpeta [`public/world/cc-monumental/`](../public/world/cc-monumental/manifest.json) permanece intacta (`git status -s public/world/cc-monumental` vacío).

## 1. Resumen Ejecutivo

- **Galería real verificada:** `36` capturas en tiempo real sobre `cc-blender-staging` (`9` localizaciones cubriendo las `8` tipologías de zona solicitadas × `4` ángulos: vista aérea, perspectiva de calle, cámara del personaje y primer plano de fachadas) + `4` capturas base de `cc-monumental` original, ejecutadas mediante [`tests/e2e/final-visual-audit.spec.ts`](../tests/e2e/final-visual-audit.spec.ts) con `0` errores JS/consola/red.
- **Corrección de repetición arquitectónica:** El bloque único `07_midrise_residential` (originalmente `3.474` edificios) se desdobló mediante **4 variantes reales en Blender 5.2** ([`tools/blender_buildings/hero_variants.py`](../tools/blender_buildings/hero_variants.py) y [`export_variants.py`](../tools/blender_buildings/export_variants.py)) usando los **2 mismos materiales del atlas UV** (`CC_Atlas_Opaque` y `CC_Atlas_Glass`): `07b_midrise_gabled` (`3.809` módulos), `07c_midrise_attic` (`1.461`), `02b_modern_setback` (`1.527`) y `05b_lowrise_village` (`1.811`), reduciendo `07_midrise_residential` base a `834` módulos.
- **Corrección de parcelas industriales:** En [`src/world/blender-geo-adapter.ts`](../src/world/blender-geo-adapter.ts), se eliminó el mapeo de grandes naves (`>= 480 m²`) a `08_civic_equipment` (pórtico con reloj y bandera), enrutándolas a `04_commercial` en orientación industrial trasera/persiana con paleta acero-pizarra (`0` cívicos en `industrial`).
- **Rendimiento y VRAM:** En el perfil por defecto `proxy`, el núcleo denso del Casco Histórico (`wc-casco-corazon-proxy`, `13` chunks activos) rinde a **`72 FPS` medios (`81 FPS` HUD)** con `262` main draw calls, `562` shadow draw calls, `1,52M` triángulos principales y **`34,32 MiB`** de memoria geométrica de mundo frente a **`437,20–457,02 MiB`** en `cc-monumental` original (**>12× menos VRAM geométrica en Casco**).
- **Fidelidad geográfica (900 chunks):** De `19.080` módulos colocados (`7.147` edificios únicos), **`0` flotan** (`maxFloatGap = 0 m`), **`0` invaden patios (`innerRings`)**, `39` centros (`0,20%`) rozan ejes viarios OSM y `178` (`0,93%`) presentan solape pesado en parcelas irregulares.

## 2. Variantes Blender Agregadas (`public/models/buildings/manifest.json`)

| Clave                 | Descripción                                                                          | Plantas | Dimensiones nominales (m) | Tris LOD0 / LOD1 / LOD2 | Materiales UV | Módulos 900 chunks | Edificios únicos |
| --------------------- | ------------------------------------------------------------------------------------ | ------: | ------------------------: | ----------------------: | ------------: | -----------------: | ---------------: |
| `07b_midrise_gabled`  | Residencial 3 plantas con cubierta de teja a dos aguas, buhardillas y contraventanas |       3 |  `14,68 × 11,576 × 12,58` |   `5.858 / 2.454 / 194` |             2 |              3.809 |            2.699 |
| `07c_midrise_attic`   | Residencial 4 plantas + ático retranqueado y cuerpo en mirador                       |       4 |  `14,50 × 12,130 × 16,56` |   `5.862 / 2.694 / 132` |             2 |              1.461 |              910 |
| `02b_modern_setback`  | Torre residencial moderna escalonada en salvia/pizarra/crema                         |       6 |  `14,36 × 12,480 × 22,21` |   `6.378 / 4.662 / 168` |             2 |              1.527 |              709 |
| `05b_lowrise_village` | Casa tradicional baja ocre/cal de 1–2 plantas                                        |       2 |    `11,56 × 9,595 × 7,77` |   `1.970 / 1.058 / 194` |             2 |              1.811 |            1.091 |

## 3. Comparativa `cc-monumental` Original vs `cc-blender-staging`

| Escena y ángulo          | Versión              | Main DC | Shadow DC | Main Tris | Shadow Tris | CPU Total (ms) | GPU Total (ms) | FPS (rAF) | Mem Mundo (MiB) |
| ------------------------ | -------------------- | ------: | --------: | --------: | ----------: | -------------: | -------------: | --------: | --------------: |
| `01-casco-plaza · calle` | `cc-monumental`      |     140 |       198 | 2.468.305 |     353.316 |            9,9 |           6,47 |       107 |          437,20 |
| `01-casco-plaza · calle` | `cc-blender-staging` |     240 |       387 |   840.371 |     922.143 |            7,9 |           7,26 |        83 |           35,55 |
| `01-casco-plaza · aerea` | `cc-monumental`      |     192 |       187 | 2.114.907 |     375.926 |            6,6 |           7,01 |        94 |          457,02 |
| `01-casco-plaza · aerea` | `cc-blender-staging` |     308 |       368 |   948.326 |     864.183 |           11,7 |           9,77 |        62 |           37,98 |
| `02-canovas · calle`     | `cc-monumental`      |     108 |        44 |   769.269 |     155.772 |            2,2 |           3,69 |       138 |          310,17 |
| `02-canovas · calle`     | `cc-blender-staging` |     227 |       302 | 1.148.876 |     845.953 |           11,1 |           7,10 |        83 |           38,08 |
| `02-canovas · aerea`     | `cc-monumental`      |     134 |        52 | 1.360.228 |     203.101 |            4,5 |           5,01 |       127 |          310,17 |
| `02-canovas · aerea`     | `cc-blender-staging` |     299 |       445 | 1.010.464 |     986.216 |            9,8 |           7,46 |        92 |           38,08 |

## 4. Benchmarks de Peores Escenarios y Hardware Modesto

| Escenario                   | Perfil / CPU       | Main DC | Shadow DC | Main Tris | Shadow Tris | CPU Actor / Occl / NPC (ms) | CPU Shadow / Main (ms) | CPU Render (ms) | GPU Total (ms) | FPS HUD / rAF | Mem Mundo (MiB) | Chunks |
| --------------------------- | ------------------ | ------: | --------: | --------: | ----------: | :-------------------------: | :--------------------: | --------------: | -------------: | :-----------: | --------------: | -----: |
| `wc-casco-corazon-proxy`    | `proxy` · 1x       |     262 |       562 | 1.520.987 |   1.365.286 |      `0,1 / 0,1 / 0,6`      |      `8,1 / 4,0`       |            12,1 |           7,34 |   `81 / 72`   |           34,32 |     13 |
| `wc-casco-panoramico-proxy` | `proxy` · 1x       |     369 |       508 | 1.302.816 |     893.919 |      `0,0 / 0,0 / 1,5`      |      `7,5 / 5,4`       |            12,9 |          12,20 |   `57 / 60`   |           36,75 |     14 |
| `wc-canovas-sanblas-proxy`  | `proxy` · 1x       |     224 |       507 | 1.385.730 |   1.335.489 |      `0,0 / 0,1 / 0,6`      |      `6,3 / 5,1`       |            11,4 |           9,12 |   `78 / 72`   |           40,14 |     15 |
| `wc-casco-budget600k`       | `budget=600k` · 1x |     241 |       395 |   948.115 |     826.714 |      `0,1 / 0,2 / 0,7`      |      `7,5 / 5,2`       |            12,7 |           6,18 |  `94 / 100`   |           35,49 |     13 |
| `wc-casco-lowcpu-4x`        | `budget=600k` · 4x |     128 |       197 |   298.463 |     266.280 |      `0,6 / 1,0 / 0,0`      |     `18,5 / 40,8`      |            59,3 |           6,70 |   `11 / 10`   |           36,60 |     13 |

## 5. Distribución por Distrito (`19.080` módulos en `7.147` edificios)

| Distrito         | Edificios adaptados | Módulos | Distribución principal de modelos                                                                                                                                                                     |
| ---------------- | ------------------: | ------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `periferia`      |               2.341 |   5.648 | `07b_midrise_gabled` (941), `02_modern_residential` (915), `02b_modern_setback` (908), `03_chalet` (754), `04_commercial` (523), `05b_lowrise_village` (519), `07c_midrise_attic` (502)               |
| `canovas_centro` |               1.769 |   2.866 | `07b_midrise_gabled` (1.629), `04_commercial` (561), `07c_midrise_attic` (191), `07_midrise_residential` (164), `02_modern_residential` (114), `02b_modern_setback` (109)                             |
| `mejostilla`     |                 650 |   2.460 | `05b_lowrise_village` (479), `07b_midrise_gabled` (453), `04_commercial` (311), `01_casco_house` (287), `05_extremadura_traditional` (240), `07c_midrise_attic` (202), `07_midrise_residential` (184) |
| `industrial`     |                 568 |   2.017 | `04_commercial` (1.865), `05_extremadura_traditional` (80), `05b_lowrise_village` (72) — **`0` cívicos**                                                                                              |
| `aldea_moret`    |                 386 |   1.635 | `05b_lowrise_village` (456), `05_extremadura_traditional` (286), `01_casco_house` (270), `07b_midrise_gabled` (168), `04_commercial` (153), `07c_midrise_attic` (151)                                 |
| `nuevo_caceres`  |                 255 |   1.031 | `02_modern_residential` (298), `02b_modern_setback` (257), `07b_midrise_gabled` (138), `04_commercial` (112), `07c_midrise_attic` (99)                                                                |
| `casco`          |                 456 |     947 | `01_casco_house` (508), `06_casco_palace` (199), `04_commercial` (98), `05_extremadura_traditional` (94), `08_civic_equipment` (30), `05b_lowrise_village` (13), `07b_midrise_gabled` (5)             |
| `campus`         |                 151 |     902 | `07b_midrise_gabled` (287), `07c_midrise_attic` (272), `08_civic_equipment` (93), `04_commercial` (88), `07_midrise_residential` (44)                                                                 |
| `comercial`      |                 218 |     758 | `04_commercial` (468), `07b_midrise_gabled` (134), `02_modern_residential` (42), `02b_modern_setback` (34)                                                                                            |
| `chalets`        |                 340 |     698 | `03_chalet` (263), `05b_lowrise_village` (161), `05_extremadura_traditional` (103), `01_casco_house` (61), `07b_midrise_gabled` (43)                                                                  |
| `residencial`    |                  13 |     118 | `02b_modern_setback` (40), `02_modern_residential` (34), `07c_midrise_attic` (17), `04_commercial` (12)                                                                                               |

## 6. Problemas Residuales Identificados

1. Viales OSM oscuros aflorando puntualmente bajo el empedrado de Plaza Mayor en zonas con desnivel (`road-builder.ts` sin modificar en esta etapa).
2. `103` anexos/garitas `< 4 m` o deduplicados omitidos sobre `7.250`; `178` solapes parciales (`0,93%`); `248` empotramientos `> 2 m` en laderas pronunciadas (`maxEmbedDepth = 8,63 m`); `2.116` diferencias de altura `> 35%` al acotar escala vertical a `0,46×–1,42×`.
3. Picos transitorios de `cpuNpcAiMs` (`17,4–19,4 ms`) inmediatamente tras teletransportes de larga distancia (en régimen estable `0,0–1,7 ms`).
4. Conviene diseñar en el futuro un arquetipo dedicado `09_industrial_warehouse` para enriquecer aún más el polígono industrial sin compartir geometría base con `04_commercial`.
