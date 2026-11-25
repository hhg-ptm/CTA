# Cáceres Criminal — Especificación Técnica de Reconstrucción 3D (FASE 1)

**Estado:** FASE 1 completada (Base de datos, cruce geográfico y auditoría arquitectónica)  
**Rama de trabajo:** `feat/caceres-3d-reconstruction`  
**Área de juego:** `public/world/cc-monumental/` **preservada intacta** (`900` chunks, `7.148` edificios en mundo)  
**Artefactos hermanos:** [`caceres_data_manifest.json`](file:///c:/Users/cerbe/Downloads/CTA-main/CTA-main/repo/caceres_data_manifest.json) y [`caceres_building_styles.json`](file:///c:/Users/cerbe/Downloads/CTA-main/CTA-main/repo/caceres_building_styles.json)

---

## 1. Visión general e integración en Cáceres Criminal (Opción 1)

El proyecto reconstruirá visualmente la ciudad real de **Cáceres** dentro de la arquitectura técnica actual de *Cáceres Criminal*, manteniendo intactos el sistema de streaming de `900` chunks (`256 × 256 m`), las físicas de **Rapier**, las colisiones, el personaje en tercera persona, la cámara, la navegación NPC/tráfico y los presupuestos de rendimiento definidos en [`AGENTS.md`](file:///c:/Users/cerbe/Downloads/CTA-main/CTA-main/repo/AGENTS.md):

- **Presupuesto gráfico objetivo:** `<= 300` *draw calls*, `<= 600.000` triángulos visibles, `60 FPS` en escritorio y carga inicial `< 25 MB`.
- **Seguridad no destructiva:** Ningún script ni documento de FASE 1 modifica [`public/world/cc-monumental/manifest.json`](file:///c:/Users/cerbe/Downloads/CTA-main/CTA-main/repo/public/world/cc-monumental/manifest.json) ni sus `.bin`. Los resultados del cruce geográfico residen exclusivamente en el directorio de staging ignorado por Git `data/staging/cc-monumental/`.
- **Privacidad catastral:** [`tools/caceres_geo_processing.py`](file:///c:/Users/cerbe/Downloads/CTA-main/CTA-main/repo/tools/caceres_geo_processing.py) descarta toda `referencia catastral` (`rc1`/`rc2`) durante la lectura XML en streaming y solo exporta geometrías derivadas, conteos de plantas, número de partes, patios, décadas de construcción, uso agregado y cercanía de portales.

---

## 2. Sistema de coordenadas y cobertura urbana real (7,6 × 7,6 km)

Todas las fuentes cartográficas se proyectan a **ETRS89 / UTM zona 29N (`EPSG:25829`)** respecto al origen local del juego situado en la **Plaza Mayor de Cáceres**:

| Parámetro | Valor verificado |
| --- | --- |
| Sistema de referencia | `EPSG:25829` (ETRS89 / UTM 29N) |
| Origen geográfico | `lat = 39.474414`, `lon = -6.371556` |
| Origen UTM proyectado | `easting = 726089.2276890515`, `northing = 4372723.106076299` |
| Extensión del mundo | `7.600 × 7.600 m` (`[-3.800 m, +3.800 m]` en ejes X y Z) |
| Rejilla de chunks | `30 × 30 = 900` chunks de `256 m` (`-15_-15` a `14_14`) |
| Envolvente WGS84 | `S 39.43920424`, `W -6.41695654`, `N 39.50960921`, `E -6.32611233` |

### Verificación de barrios, equipamientos y zonas dentro de `±3.800 m`

| Sector / Hito real | Referencia OSM verificada | Coordenadas locales `(x, z)` m | Estado en rejilla `7,6 km` |
| --- | --- | --- | --- |
| Casco Antiguo / Plaza Mayor | `w22358108` Ayuntamiento de Cáceres | `(-34.6, -6.9)` | Dentro |
| Centro / Paseo de Cánovas | `w30824096` Paseo de Cánovas | `(-574.0, -492.7)` | Dentro |
| San Blas | `w238698337` Ermita de San Blas | `(164.3, 635.9)` | Dentro |
| San Marquino | `n1757250456` Ermita de San Marquino | `(499.3, -147.9)` | Dentro |
| Plaza de Toros | `w376803613` Plaza de Toros Era de los Mártires | `(-366.2, 643.4)` | Dentro |
| Moctezuma / R-66 | `w596167832` Casa Municipal de cultura Moctezuma | `(-452.7, -1482.2)` | Dentro |
| Estación de Tren | `w53246385` Estación de Cáceres | `(-1171.8, -1499.3)` | Dentro |
| Nuevo Cáceres / Espíritu Santo | `w58253870` Plaza del Espíritu Santo | `(333.9, -1528.3)` | Dentro |
| Mejostilla y Montesol | `w466170582` Centro Cívico Mejostilla | `(510.1, 1416.9)` | Dentro |
| Zona Comercial El Vivero | `w24717473` Zona Comercial El Vivero | `(-1819.2, -282.9)` | Dentro |
| Aldea Moret | `n7972975663` A. Moret (cruce c/ Danubio) | `(-1491.0, -2543.1)` | Dentro (cobertura parcial OSM; enriquecer con Catastro) |
| Polígono Charca Musia | `n7972975682` Polígono Charca Musia | `(537.8, -2332.2)` | Dentro |
| Estadio Príncipe Felipe y Capellanías | `w257266364` Estadio Príncipe Felipe | `(-3556.7, 1305.3)` | Dentro (borde oeste industrial alcanza `x = -3868.0 m`) |
| Campus Universitario UEx | `w377649521` Campus Cáceres UEx | `(2453.7, 690.7)` | Dentro |
| Hospital Universitario | `w389025250` Ciudad de la Salud y la Innovación | `(3549.7, 196.9)` | Dentro |

---

## 3. Cruce geográfico real: Antes vs. Después (FASE 1)

El gran hallazgo técnico de FASE 1 es que, aunque el fichero GML principal de Catastro INSPIRE `BU.Building` deja `numberOfFloorsAboveGround` con `xsi:nil="true"`, el fichero **`A.ES.SDGC.BU.10900.buildingpart.gml`** contiene **exactamente las plantas sobre rasante de cada cuerpo edificatorio** (`_part1`, `_part2`, …), cubriendo el **100 %** (`11.068` de `11.068`) de los edificios catastrales dentro del área de juego de `7,6 km`.

### Métricas comparativas verificadas (`phase1_stats.json` vs. `public/world/cc-monumental/manifest.json`)

| Indicador | Producción actual (`cc-monumental`) | Staging FASE 1 (`cc-monumental-expanded` + Catastro ATOM) |
| --- | --- | --- |
| Edificios OSM en mundo (`±3.800 m`) | `7.148` | `7.249` (incluye `106` relaciones multipolígono y `16` `building:part`) |
| Edificios con altura o plantas OSM explícitas | `56` (`55` niveles + `1` altura; `0,78 %`) | `60` (`osm_explicit`; `39` también emparejados en Catastro) |
| Edificios con plantas reales de Catastro (`BuildingPart`) | `0` integrados (solo contraste 1 km `2.502` edif.) | `6.124` (`catastro_floors`; total emparejados: `6.179`) |
| **Total edificios con altura real verificada** | **`56` (`0,78 %`)** | **`6.184 / 7.249` (`85,31 %`)** |
| Edificios en `heuristic_fallback` (estimación explícita) | `7.092` (`99,22 %`) | `1.065` (`14,69 %`: `1.049` sin cruce + `16` con `0` plantas en Catastro) |
| Edificios con múltiples cuerpos / volúmenes escalonados | No modelado | `4.955` (`catastroPartCount > 1`) |
| Edificios con patio interior detectado | Ignorado al extruir | `713` (`620` anillos Catastro + `102` relaciones OSM) |
| Edificios con portales de dirección cercanos (`AD`) | No utilizado | `5.688` (de `16.689` portales en área de juego) |
| Usos catastrales identificados | Solo etiquetas OSM | `1_residential: 5.212`, `3_industrial: 344`, `4_3_publicServices: 284`, `4_2_retail: 246`, `4_1_office: 50`, `2_agriculture: 8` |
| Épocas constructivas identificadas | Solo zona radial | `modern_1985_plus: 2.088`, `classic_1900_1950: 2.017`, `ensanche_1950_1985: 1.955`, `historic_pre_1900: 94` |

### Limitaciones documentadas y honestidad de datos

1. **Casos `heuristic_fallback` (`1.065` edificios):**
   - `16` edificios sí cruzaron con Catastro pero figuran con `0` plantas sobre rasante (anexos en ruina, pórticos o estructuras bajas).
   - Los `1.049` restantes no cruzaron bajo la regla actual de celda `40 m` + centroide en [`tools/caceres_geo_processing.py`](file:///c:/Users/cerbe/Downloads/CTA-main/CTA-main/repo/tools/caceres_geo_processing.py). Los tipos OSM predominantes son `yes` (`669`), `industrial` (`88`), `terrace` (`85` manzanas adosadas donde la huella OSM agrupa varias parcelas catastrales estrechas cuyo centroide cae fuera de la celda central), `roof` (`78` marquesinas que en Catastro residen en `otherconstruction.gml` y no en `building.gml`) y `residential` (`53`). En FASE 2 se ampliará la consulta espacial multi-celda y el cruce contra `otherconstruction.gml` para reducir aún más ese `14,69 %`, manteniendo siempre marcada la bandera `heightOrigin: "heuristic_fallback"`.
2. **Modelo Digital de Superficies (`MDS`) y servicios municipales:**
   - El servicio IGN WCS `https://servicios.idee.es/wcs-inspire/mdt` (`Elevacion25830_5`, MDT05 ya horneado en los `900` chunks: `1.548 × 1.512`, cotas `299,02 m` – `639,00 m`) respondió correctamente.
   - Los endpoints automatizados `https://servicios.idee.es/wcs-inspire/mds`, `https://ide.caceres.es/geoserver/wfs`, `http://ide.caceres.es/` y `https://sig.caceres.es/` devolvieron `fetch failed` desde este entorno. Si en FASE 2/4 se necesitan cotas LiDAR de copas o cubiertas singulares, se documenta la descarga manual de hojas PNOA-LiDAR COG (`MDS02`/`MDT02`) desde `centrodedescargas.cnig.es`.
   - Asimismo, [`data/raw/elevation/cc-monumental.asc`](file:///c:/Users/cerbe/Downloads/CTA-main/CTA-main/repo/data/raw/elevation/cc-monumental.asc) (`293.674` bytes) corresponde a la caché local inicial de `1 km`, mientras que la malla MDT05 completa de `7,6 km` está integrada en los binarios actuales de [`public/world/cc-monumental/manifest.json`](file:///c:/Users/cerbe/Downloads/CTA-main/CTA-main/repo/public/world/cc-monumental/manifest.json).

---

## 4. Auditoría de los 12 arquetipos y 17 módulos arquitectónicos actuales

El diagnóstico técnico tras auditar [`src/world/building-styles.ts`](file:///c:/Users/cerbe/Downloads/CTA-main/CTA-main/repo/src/world/building-styles.ts), [`src/world/city-kit.ts`](file:///c:/Users/cerbe/Downloads/CTA-main/CTA-main/repo/src/world/city-kit.ts) y [`public/models/citykit/manifest.json`](file:///c:/Users/cerbe/Downloads/CTA-main/CTA-main/repo/public/models/citykit/manifest.json) explica exactamente por qué la ciudad sigue percibiéndose en gran medida como bloques prismáticos:

1. **Volumetría plana de un solo bloque:** [`building-builder.ts`](file:///c:/Users/cerbe/Downloads/CTA-main/CTA-main/repo/src/world/building-builder.ts) extruye cada anillo exterior OSM de forma uniforme desde el suelo hasta `wallHeight`, ignorando anillos interiores (`713` edificios con patio) y cambios de altura entre cuerpos (`4.955` edificios con múltiples `BuildingPart` en Catastro).
2. **Huecos sin profundidad real:** Las `window-casco`, `window-ensanche` y `window-modern` (`48–60` tris LOD0) se instancian como placas pegadas por delante del muro plano en lugar de alojarse en jambas/dinteles o relieves de fachada diferenciados con alféizares y persianas/contraventanas.
3. **Baja diferenciación por uso real y mobiliario escaso:** Aunque existen `10.859` props colocados, **los `7.313` árboles comparten 1 único modelo GLB** (`tree-lod0.glb`, `376` tris), cuando OSM distingue `890` frondosas (`broadleaved`) y `173` coníferas (`needleleaved`); además, `214` paradas de autobús, `10` fuentes, `17` bancos y `7` aparcabicis extraídos aún no cuentan con módulo propio en [`public/models/citykit/manifest.json`](file:///c:/Users/cerbe/Downloads/CTA-main/CTA-main/repo/public/models/citykit/manifest.json).
4. **Hitos monumentales sin GLB dedicados:** Actualmente hay `0` modelos hero en Blender; torres y arcos clave se generan mediante cajas y cilindros procedurales en [`src/world/landmark-geometry.ts`](file:///c:/Users/cerbe/Downloads/CTA-main/CTA-main/repo/src/world/landmark-geometry.ts).

### A. Auditoría de los 12 arquetipos (`building-styles.ts`)

| Arquetipo | Zona | Material / Atlas | Decisión FASE 2 | Motivo y mejora principal |
| --- | --- | --- | --- | --- |
| `casco_palace` | `casco` | `casco_facade` (banda `0`/`3`) | **Mejorar** | Conservar paleta pétrea dorada; añadir patios interiores, jambas rehundidas y cornisa moldurada. |
| `casco_lime` | `casco` | `casco_facade` (banda `1`) | **Mejorar** | Mantener encalado; añadir alero con canes, teja árabe con caballete y contraventanas. |
| `casco_ochre` | `casco` | `casco_facade` (banda `2`) | **Mejorar** | Diferenciar casas medianeras por altura de alero, orientación de faldón y zócalo adaptado a pendiente. |
| `casco_terracotta` | `casco` | `casco_facade` (banda `3`) | **Mejorar** | Separar fábricas sacras/conventuales de revoco cálido popular. |
| `ensanche_brick` | `ensanche` | `ensanche_facade` (banda `0`) | **Mejorar** | Incorporar planta baja comercial (`246` `retail` en Catastro) con doble altura, terrazas y áticos retranqueados. |
| `ensanche_stucco` | `ensanche` | `ensanche_facade` (banda `1`) | **Mejorar** | Añadir impostas por forjado, balcones volados con barandilla 3D y portales orientados según `AD`. |
| `ensanche_cream` | `ensanche` | `ensanche_facade` (banda `2`) | **Mejorar** | Cubiertas inclinadas con teja en vivienda baja y chaflanes urbanos en esquina. |
| `ensanche_modern` | `ensanche` | `ensanche_facade` (banda `3`) | **Dividir** | Separar torres/oficinas acristaladas (`4_1_office`, `4_3_publicServices`) de vivienda moderna. |
| `periferia_chalet` | `periferia` | `periferia_facade` (banda `0`) | **Dividir** | Separar unifamiliares exentas (`detached`) de hileras adosadas (`terrace`) con porches y chimeneas. |
| `periferia_block` | `periferia` | `periferia_facade` (banda `1`) | **Mejorar** | Aplicar alturas reales de Catastro (hasta `16` plantas) en Mejostilla/Nuevo Cáceres y cajas de escalera en relieve. |
| `periferia_industrial` | `periferia` | `periferia_facade` (banda `2`) | **Mejorar** | Naves con cubierta a dos aguas/diente de sierra, lucernarios y portones de muelle (`344` edificios industriales). |
| `periferia_civic` | `periferia` | `periferia_facade` (banda `3`) | **Dividir** | Tipología específica para Campus UEx, Hospital y colegios con parasoles y petos de cubierta. |

### B. Auditoría de los 17 módulos arquitectónicos + 5 módulos viales (`public/models/citykit/manifest.json`)

El kit completo suma **`44` GLB LOD0/LOD1** (`22` módulos) más el manifiesto, ocupando **`1.215.895` bytes** en disco (nótese que cada GLB incrusta actualmente ~`22 KB` de la textura compartida `kit_atlas` 256×256, lo cual supone ~`968 KB` duplicados en almacenamiento aunque [`city-kit.ts`](file:///c:/Users/cerbe/Downloads/CTA-main/CTA-main/repo/src/world/city-kit.ts) la deduplica en GPU al cargar).

| Módulo CityKit | Categoría | Tris LOD0 / LOD1 | Tamaño LOD0 / LOD1 (B) | Veredicto FASE 2 | Acción |
| --- | --- | --- | --- | --- | --- |
| `balcony` | Arquitectura (1/17) | `132 / 72` | `31.624 / 27.440` | Reutilizar + ampliar | Mantener hierro forjado; añadir variante con ménsulas y macetero. |
| `balcony-modern` | Arquitectura (2/17) | `84 / 60` | `28.272 / 26.592` | Mejorar | Añadir losa sobresaliente, antepecho mixto y vidrio estilizado. |
| `window-casco` | Arquitectura (3/17) | `60 / 36` | `26.612 / 24.924` | Mejorar | Dotar de jamba profunda, vierteaguas, reja y contraventanas abiertas/cerradas. |
| `window-ensanche` | Arquitectura (4/17) | `48 / 36` | `25.760 / 24.916` | Mejorar | Añadir cajón de persiana exterior y marco perimetral con relieve. |
| `window-modern` | Arquitectura (5/17) | `48 / 36` | `25.748 / 24.904` | Mejorar | Añadir parteluces y paño retranqueado de cristal Stylized Low Poly. |
| `portal-casco` | Arquitectura (6/17) | `108 / 84` | `29.968 / 28.288` | Reutilizar | Buen arco de dovelas; complementar con portón noble de doble hoja. |
| `portal-modern` | Arquitectura (7/17) | `72 / 60` | `27.448 / 26.608` | Mejorar | Añadir marquesina volada, dintel acristalado y zaguán rehundido. |
| `shopfront-awning` | Arquitectura (8/17) | `84 / 60` | `28.296 / 26.612` | Mejorar | Añadir escaparates bajos, rótulo neutro sin marcas y toldos variados. |
| `industrial-door` | Arquitectura (9/17) | `80 / 48` | `27.888 / 25.772` | Reutilizar | Válido para naves; añadir variante de muelle de carga. |
| `pilaster-corner` | Arquitectura (10/17) | `48 / 24` | `25.712 / 24.028` | Reutilizar | Sillar de esquina limpio y económico en triángulos. |
| `chimney` | Arquitectura (11/17) | `56 / 24` | `26.176 / 24.072` | Reutilizar + ampliar | Añadir chimeneas múltiples de ladrillo y sombreretes de barro. |
| `dormer-roof` | Arquitectura (12/17) | `48 / 48` | `25.760 / 25.760` | Mejorar | LOD0 y LOD1 idénticos (`48` tris); simplificar LOD1 y perfilar teja. |
| `rooftop-penthouse` | Arquitectura (13/17) | `60 / 36` | `26.616 / 24.928` | Mejorar | Ampliar con casetones reales, pérgolas y petos de terraza habitable. |
| `rooftop-hvac` | Arquitectura (14/17) | `72 / 12` | `27.028 / 23.216` | Reutilizar + ampliar | Gran reducción LOD (`72->12`); sumar paneles solares y antenas. |
| `bell-gable` | Arquitectura (15/17) | `120 / 88` | `30.568 / 28.460` | Reutilizar | Silueta de espadaña fiel a ermitas y conventos cacereños. |
| `corner-turret` | Arquitectura (16/17) | `96 / 64` | `28.552 / 26.632` | Reutilizar | Mantener para esquinas nobles e hitos históricos. |
| `heraldic-crest` | Arquitectura (17/17) | `48 / 24` | `25.768 / 24.084` | Reutilizar | Escudo blasonado de bajo poligonaje adecuado sobre portales históricos. |
| `street-lamp` | Vial / Mobiliario (1/5) | `108 / 72` | `29.180 / 27.236` | Dividir | Separar farola fernandina (Casco) de columna moderna doble (Ensanche). |
| `tree` | Vial / Vegetación (2/5) | `376 / 108` | `58.624 / 31.660` | Ampliar | Sustituir uso único (`7.313` árboles) por catálogo: encina/olivo, plátano (`broadleaved`), pino/ciprés (`needleleaved`) y arbustos. |
| `traffic-signals` | Vial / Señalización (3/5) | `92 / 60` | `28.328 / 26.596` | Reutilizar | Adecuado para `123` cruces semaforizados. |
| `stop-sign` | Vial / Señalización (4/5) | `76 / 52` | `27.064 / 25.764` | Reutilizar | Señal octogonal clara (`78` instancias en mundo). |
| `give-way-sign` | Vial / Señalización (5/5) | `44 / 36` | `25.324 / 24.888` | Reutilizar | Señal triangular clara (`415` instancias en mundo). |

---

## 5. Hoja de ruta técnica (FASE 2 — FASE 6)

- **FASE 2 — Nuevo sistema procedural de edificios (`building-builder` + CityKit v2 en Blender):**
  - Integrar los datos de [`caceres_building_styles.json`](file:///c:/Users/cerbe/Downloads/CTA-main/CTA-main/repo/caceres_building_styles.json) y `data/staging/cc-monumental/building_enrichment.json` manteniendo colisiones Rapier exactas.
  - Añadir triangulación con huecos para los `713` patios interiores, volúmenes escalonados para edificios multi-parte (`4.955`), zócalos/impostas/cornisas en relieve, ventanas con jamba y persiana/contraventana, variantes de árboles según taxonomía OSM (`broadleaved`/`needleleaved`) y mobiliario urbano (`214` marquesinas `bus_stop`, bancos, bolardos y fuentes).
  - *Nota visual pendiente para FASE 2/3:* solicitar al usuario la **Imagen 1 de referencia artística (Stylized Low Poly City Environment)** antes de fijar el sombreado, saturación y grosor final de biseles.
- **FASE 3 — Prototipo visual y recorrido en 5 zonas:** Generar muestra en staging y capturas a altura de personaje + vista aérea en **Casco Antiguo**, **Centro/Ensanche residencial**, **Aldea Moret/Chalet**, **El Vivero/Zona comercial** y **Nuevo Cáceres/Campus** antes de tocar la ciudad completa.
- **FASE 4 — Monumentos y edificios singulares en Blender:** Modelar GLBs propios (`public/models/landmarks/`) para Torre de Bujaco, Concatedral de Santa María, Arco de la Estrella, Ayuntamiento de Cáceres, Palacio de Carvajal/Veletas, Plaza de Toros, Estación de Cáceres y edificios singulares.
- **FASE 5 — Reconstrucción completa de los 900 chunks en staging:** Procesar toda la huella urbana en staging manteniendo intactos carreteras, alturas MDT05 y rutas NPC, con promoción atómica solo tras superar verificación automática.
- **FASE 6 — Integración y optimización:** Empaquetado/deduplicación de texturas CityKit, validación automática (`draw calls <= 300`, `tris <= 600.000`), tests unitarios y auditoría Playwright/WebGL.

---

## 6. Reproducibilidad de FASE 1

```powershell
# Re-ejecutar cruce geográfico en staging (sin modificar public/world/cc-monumental/)
& "C:\Program Files\Blender Foundation\Blender 5.2\5.2\python\bin\python.exe" tools/caceres_geo_processing.py

# Comprobar integridad del código, tests existentes y mundo de producción actual
& npm.cmd run lint
& npm.cmd run typecheck
& npm.cmd test
& npm.cmd run build
& npm.cmd run data:verify
```
