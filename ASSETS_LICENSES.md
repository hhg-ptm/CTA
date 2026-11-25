# Licencias de assets 3D

Este archivo es el inventario canónico de modelos 3D. Los datos geográficos y sus licencias siguen en [`ATTRIBUTION.md`](ATTRIBUTION.md).

## Procedurales propios (sin coste, sin atribución obligatoria)

| Asset | Archivos | Licencia | Origen | Uso |
| --- | --- | --- | --- | --- |
| City Kit — farola histórica | `public/models/citykit/street-lamp-lod{0,1}.glb` | CC0-1.0 | `tools/generate_citykit.py` (Blender 5.2, geometría y materiales originales) | Sustituye la farola procedural de `RoadRenderer` con el kit activo (por defecto). |
| City Kit — encina mediterránea | `public/models/citykit/tree-lod{0,1}.glb` | CC0-1.0 | Ídem | Sustituye el árbol procedural con el kit activo (por defecto). |
| City Kit — semáforo | `public/models/citykit/traffic-signals-lod{0,1}.glb` | CC0-1.0 | Ídem | Sustituye el semáforo procedural con el kit activo (por defecto). |
| City Kit — señal de stop | `public/models/citykit/stop-sign-lod{0,1}.glb` | CC0-1.0 | Ídem | Sustituye la señal procedural con el kit activo (por defecto). |
| City Kit — señal de ceda el paso | `public/models/citykit/give-way-sign-lod{0,1}.glb` | CC0-1.0 | Ídem | Sustituye la señal procedural con el kit activo (por defecto). |
| City Kit — chimenea de ladrillo | `public/models/citykit/chimney-lod{0,1}.glb` | CC0-1.0 | Ídem | Detalle en tejados de teja inclinados (`dormer-roof` y `chimney`). |
| City Kit — balcón de forja | `public/models/citykit/balcony-lod{0,1}.glb` | CC0-1.0 | Ídem | Balcones con ménsulas, puerta francesa y reja para el casco histórico y Torre de Bujaco. |
| City Kit — balcón de ensanche | `public/models/citykit/balcony-modern-lod{0,1}.glb` | CC0-1.0 | Ídem | Balcón en voladizo con antepecho de hormigón/aluminio para bloques de ensanche y periferia. |
| City Kit — ventanas por zona | `public/models/citykit/window-{casco,ensanche,modern}-lod{0,1}.glb` | CC0-1.0 | Ídem | Ventanas 3D diferenciadas: contraventanas de madera, cajas de persiana y viseras modernas. |
| City Kit — portales y escaparates | `public/models/citykit/{portal-casco,portal-modern,shopfront-awning,industrial-door}-lod{0,1}.glb` | CC0-1.0 | Ídem | Portadas de dovelas, portales acristalados, locales con toldo a rayas y portones industriales. |
| City Kit — esquineros y cubiertas | `public/models/citykit/{pilaster-corner,rooftop-penthouse,rooftop-hvac,dormer-roof,bell-gable,corner-turret,heraldic-crest}-lod{0,1}.glb` | CC0-1.0 | Ídem | Sillares esquinales, casetas de ascensor, climatizadores, buhardillas, espadañas, matacanes y escudos. |

Todos los GLB del kit comparten un atlas procedural embebido (`kit_atlas`, 1 primitiva por modelo), sin texturas externas, sin marcas y sin referencias a juegos comerciales. El manifest con recuento de triángulos y bytes está en `public/models/citykit/manifest.json`.

Para regenerarlos (requiere Blender 5.x instalado):

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' `
  --background --factory-startup --python tools/generate_citykit.py
```

La ruta de Blender depende de la instalación local; el script no se ejecuta en tiempo de juego ni en CI.

## Terceros con licencia CC0

| Asset | Archivo | Licencia | Fuente | Atribución |
| --- | --- | --- | --- | --- |
| Kenney — Animated Characters: Protagonists | `public/models/characters/caceres-pedestrian.glb` | CC0 1.0 | https://kenney.nl/assets/animated-characters-protagonists | Rig convertido de FBX a GLB con `tools/generate_cc0_assets.py`; textura `skaterMaleA` embebida y clips `idle`/`walk`. Sustituye a Tevy «Casual Walker». |
| Kenney — Car Kit | `public/models/vehicles/caceres-sedan.glb` | CC0 1.0 | https://kenney.nl/assets/car-kit | Sedán GLB reexportado con `colormap.png` embebida, sin marcas. Conservado como referencia/fallback; sustituyó a Innerscene «Graphite sedan». |
| Producción propia — Cáceres GT | `public/models/vehicles/caceres-gt.glb` | CC0 1.0 | Geometría original generada en Blender 5.2 | Cupé deportivo ficticio creado desde cero con `build_car.py`; convertido a GLB de 5 nodos con `export_car_glb.py`. Sin marcas, texturas ni geometría de terceros. Modelo jugable actual. |
| Producción propia — Cáceres GT tráfico | `public/models/vehicles/caceres-gt-traffic.glb` | CC0 1.0 | Derivado de la misma fuente Blender 5.2 | LOD de 1 nodo y 1.691 triángulos generado con `export_car_traffic_glb.py`; pintura neutra teñida por instancia, sin transmisión ni marcas. Coches ambientales. |
| Producción propia — Cáceres GT patrulla | `public/models/vehicles/caceres-gt-police.glb` | CC0 1.0 | Derivado de la misma fuente Blender 5.2 | LOD de 1 nodo y 1.775 triángulos con barra y franjas originales, sin insignias reales. Patrullas. |

Los archivos antiguos (`casual-walker*.glb` y `graphite-sedan.glb`) se han eliminado. El peatón sirve jugador y multitud: `character.ts` reproduce sus animaciones y `npc-system.ts` hornea una pose de marcha para el `InstancedMesh`, que actúa como LOD1 sin segundo archivo. Los dos LOD de tráfico se hornean en geometría de colores por vértice; cada `InstancedMesh` mantiene una sola llamada de dibujo y el teñido por instancia.

Para regenerar los derivados (requiere Blender 5.x y los paquetes CC0 descargados en directorios separados):

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' `
  --background --factory-startup --python tools/generate_cc0_assets.py -- `
  --characters <kenney-animated-characters-protagonists> `
  --cars <kenney-car-kit> `
  --output <repository-root>
```

## Pendiente

- Revisar en navegador la orientación del peatón y la alineación del Cáceres GT con el colisionador y las ruedas animadas.
- Valorar variantes adicionales propias (taxi, autobús urbano) derivadas del Cáceres GT sin romper el instanciado por color.
