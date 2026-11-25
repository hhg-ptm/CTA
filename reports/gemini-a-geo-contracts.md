# Contratos Geográficos Compartidos — Ámbito Gemini A

**Rama base de integración:** `integration/multiagent-base` (`98e257c`)  
**Rama de desarrollo:** `feat/gemini-a-geo-contracts`  
**Ámbito exclusivo:** mundo 3D, arquitectura Blender, pipeline GIS, monumentos y consultas espaciales.  
**Estado de producción:** `public/world/cc-monumental/` protegido e intacto (`0` cambios, sin promociones).

---

## 1. Acceso compartido de solo lectura a datos staging y raw entre worktrees

Los directorios `data/raw/`, `data/staging/` y `public/world/cc-blender-staging/` están excluidos de Git en `.gitignore`. En un worktree limpio (`../repo-gemini-a`, `../repo-opencode`, `../repo-gemini-b`), **no aparecen automáticamente**.

- **Resolución automática ([`tools/shared_data_paths.py`](../tools/shared_data_paths.py)):** las herramientas Python de Gemini A localizan fuentes crudas y staging en modo **solo lectura** siguiendo este orden:
  1. Directorio del propio worktree si el recurso existe localmente.
  2. Variable de entorno `CTA_SHARED_DATA_ROOT` apuntando al repositorio maestro local.
  3. Descubrimiento automático vía `git worktree list --porcelain` y carpeta hermana `../repo`.
- **Nota importante para worktrees en Windows (`core.autocrlf=true`):** al crear un worktree nuevo en Windows, Git puede expandir a CRLF (`\r\n`) los JSON minificados de `public/world/cc-monumental/` (`source-fidelity.json`, `road-network.json`, `walk-route.json`), alterando su tamaño en `1` byte respecto al SHA-256 del manifiesto al ejecutar `npm run data:verify`. Si ocurre en un worktree recién creado, basta restaurar los bytes LF exactos del commit sin alterar Git:
  ```bash
  git -c core.autocrlf=false checkout -- public/world/cc-monumental/*.json
  ```

---

## 2. Catálogos públicos generados (`public/data/world/`)

Generados de forma determinista con [`tools/export_world_geo_contracts.py`](../tools/export_world_geo_contracts.py) leyendo las fuentes oficiales cacheadas (Catastro INSPIRE AD `10900`, OSM expandido `cc-monumental-expanded.json`, malla MDT05 de chunks, grafo viario `road-network.json` y `tools/brand-blocklist.json`).

### 2.1 `public/data/world/portals.json`

- **Volumen:** **`16.486`** portales reales dentro del mundo de `7,6 × 7,6 km` (`16.644` registros brutos en Catastro AD deduplicando `158` centroides `Parcel` redundantes junto a accesos `Entrance` idénticos; `5,24 MB` JSON, `< 0,9 MB` gzip).
- **Rango de cotas reales MDT05:** `311,00 m` a `639,00 m` (`y` en metros locales).
- **Privacidad Catastro:** todo identificador `rc1`, `rc2`, `localId` y `gml:id` se descarta en el extractor. Cada entrada usa un ID anónimo estable (`p_<sha256_10>`).
- **Reparto verificado por `DistrictKind`:** `periferia` (`5.110`), `mejostilla` (`3.683`), `chalets` (`1.931`), `canovas_centro` (`1.928`), `aldea_moret` (`1.700`), `industrial` (`747`), `nuevo_caceres` (`574`), `casco` (`449`), `comercial` (`217`), `campus` (`91`), `residencial` (`56`).

### 2.2 `public/data/world/bus-stops.json`

- **Volumen:** **`213`** paradas reales de autobús urbano dentro de `±3.840 m` (`126 KB`), excluyendo andenes exclusivamente ferroviarios (`railway=platform` sin `bus=yes`).
- **Acoplamiento viario (`213/213` conectadas):** cada parada incluye `roadNodeId`, `roadSegmentId`, coordenadas exactas sobre calzada vehicular `roadPoint: [x, z]`, distancia a calzada `roadDistanceMeters` y rumbo tangente `heading` respetando sentidos únicos (`oneWay`).
- **Rango de cotas reales MDT05:** `348,00 m` a `483,00 m`.
- **Fidelidad de líneas:** solo se exportan `lineRefs` explícitos en etiquetas OSM `route_ref` (`[]` cuando OSM no las declara, sin inventar recorridos ni frecuencias).

---

## 3. Contratos TypeScript y `WorldGeoQuery`

Definidos en [`src/world/geo-contracts.ts`](../src/world/geo-contracts.ts) (re-exportados desde [`src/world/types.ts`](../src/world/types.ts)) e implementados en [`src/world/world-geo-query.ts`](../src/world/world-geo-query.ts) mediante `IndexedWorldGeoQuery` sobre rejillas espaciales de `64 m` (portales) y `128 m` (paradas y hitos).

### 3.1 Convención espacial única compartida entre agentes

- **Sistema:** proyección métrica `EPSG:25829` centrada en Plaza Mayor (`+X` Este, `+Y` elevación MDT05, `+Z` Norte).
- **Ángulos (`heading` en radianes):** `Math.atan2(dx, dz)`, idéntico al eje `+Z` local de Three.js (`rotation.y = heading`) y del chasis `Vehicle` en Rapier.
  - En `PortalRecord`: orientado desde la puerta hacia la calzada/calle frontal.
  - En `BusStopRecord`: orientado a lo largo del sentido de marcha vehicular en la calzada (`roadSegmentId`).

### 3.2 Contrato para Gemini B (Gameplay, Oficios y Economía)

Los sistemas de misiones, economía (€) y refugios consumen exclusivamente `WorldGeoQuery` (sin importar `ChunkManager` ni `BlenderGeoAdapter`):

- **Oficio de Repartidor (Casco / Judería / barrios):**
  - `queryPortalsInRadius(x, z, radiusMeters, { kind: 'entrance', zone: 'casco' })`
  - `searchPortals('Adarve Santa Ana', 10)` -> devuelve `PortalRecord` con `street`, `number`, `postalCode`, `(x, y, z)`, `roadPoint` para aparcar y `heading`.
  - `getPortalsForBuilding(buildingId)` -> agrupa portales reales de un mismo inmueble OSM/Catastro.
- **Pisos francos y propiedades en venta/alquiler:**
  - Filtrado directo por `use: 'residential' | 'commercial' | 'civic' | 'industrial' | 'mixed'` y `district`.
- **Oficio de Guía Turístico:**
  - `getLandmarkById(id)`, `findNearestLandmark(x, z)` y `queryLandmarksInRadius(x, z, r)` sobre los `19` hitos georreferenciados de [`public/data/landmarks/landmarks.json`](../public/data/landmarks/landmarks.json).
- **Oficio de Autobús Urbano (Líneas 1 y 8):**
  - `getAllBusStops()`, `findNearestBusStop(x, z)` y `toVehicleStopAnchor(stop, toleranceMeters)` para obtener paradas consecutivas listas para checkpoints y simulación.

### 3.3 Contrato para OpenCode (`VehicleSimulationApi`)

OpenCode conecta los vehículos de servicio y simulación con la ciudad únicamente a través de dos contratos de solo lectura sin acoplarse a `ChunkManager` ni a física interna de edificios:

- **`VehicleRouteStopAnchor`** (`geo.toVehicleStopAnchor(stop, toleranceMeters)`): entrega `{ stopId, name, ref, roadNodeId, roadSegmentId, stopPosition: [x, y, z], heading, stopRadiusMeters }` proyectado sobre segmento vehicular `!walkable`.
- **`GeoEnvironmentBridge`** (`createGeoEnvironmentBridge(...)`): expone de forma desacoplada `{ geo, worldRegion, sampleGroundHeight(x, z), isFootprintFree(x, z, radiusMeters) }` para que `VehicleSimulationApi` consulte altura instantánea de calzada/terreno y compruebe espacios libres al aparecer o detener autobuses/tráfico sin tocar `ChunkManager`.

---

## 4. Dependencias de integración declaradas

- **De Gemini B hacia Gemini A:** carga lazy vía `loadWorldGeoQuery(import.meta.env.BASE_URL)` cuando el jugador inicie misiones, oficios o UI inmobiliaria (no penaliza la carga inicial `< 25 MB` ni el arranque).
- **De OpenCode hacia Gemini A:** uso opcional de `VehicleRouteStopAnchor` y `GeoEnvironmentBridge` como interfaz pura; `VehicleSimulationApi` mantiene su propia física y ciclo de actualización en sus módulos sin cambios de Gemini A en `src/world/vehicle.ts`, `npc-system.ts`, `police-system.ts` o `src/main.ts`.
- **Validación automática integrada:** [`tools/verify-world.mjs`](../tools/verify-world.mjs) valida los catálogos `portals.json` y `bus-stops.json` (rangos `±3840 m`, cotas reales `200..900 m`, `0` fugas catastrales y `0` marcas bloqueadas) dentro de `npm run data:verify`, complementado por [`tests/world-geo-query.test.ts`](../tests/world-geo-query.test.ts).

---

## 5. Primeros monumentos GLB personalizados (`public/landmarks/`)

Modelados en Blender 5.2 ([`tools/blender_landmarks/build_monuments.py`](../tools/blender_landmarks/build_monuments.py)) directamente sobre sus huellas métricas OSM (`EPSG:25829`) centradas mediante `polygon_centroid` con cimentación bajo cota (`-2,6 m`) y atlas PBR embebido de `2` materiales (`<= 1.700` triángulos y `<= 135 KB` cada GLB, sin URIs externas):

| ID OSM | Monumento | Archivo GLB | Triángulos | Peso | Materiales |
| --- | --- | --- | ---: | ---: | ---: |
| `w385037728` | Torre de Bujaco | [`public/landmarks/w385037728.glb`](../public/landmarks/w385037728.glb) | `1.032` | `88.140 B` (`86,1 KiB`) | `2` |
| `w467504814` | Torre de Carvajal | [`public/landmarks/w467504814.glb`](../public/landmarks/w467504814.glb) | `1.004` | `86.252 B` (`84,2 KiB`) | `2` |
| `w385037723` | Concatedral de Santa María | [`public/landmarks/w385037723.glb`](../public/landmarks/w385037723.glb) | `1.176` | `98.636 B` (`96,3 KiB`) | `2` |
| `w22358108` | Ayuntamiento de Cáceres | [`public/landmarks/w22358108.glb`](../public/landmarks/w22358108.glb) | `668` | `62.568 B` (`61,1 KiB`) | `2` |
| `w382363931` | Palacio de las Veletas | [`public/landmarks/w382363931.glb`](../public/landmarks/w382363931.glb) | `1.693` | `134.848 B` (`131,7 KiB`) | `2` |

- **Integración retrocompatible sin modificar `public/world/cc-monumental/`:** [`src/world/custom-landmarks.ts`](../src/world/custom-landmarks.ts) expone `resolveLandmarkModelPath()` consumido por `building-builder.ts`, `blender-geo-adapter.ts` y `landmark-geometry.ts` / `concatedral-tower.ts` / `landmark-details.ts` para sustituir el bloque procedural por el GLB dedicado manteniendo colisionadores y `data/landmarks/status.json` en `pending` hasta revisión fotográfica humana.

