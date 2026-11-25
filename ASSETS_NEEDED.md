# Assets pendientes

Prioridad actual: sustituir los GLB CC0 genéricos ya integrados por modelos más adecuados para Cáceres, manteniendo siempre licencia clara y coste cero.

| Prioridad | Asset | Estado | Restricción | Destino |
| --- | --- | --- | --- | --- |
| 1 | Peatón con ropa contemporánea española, rig y animaciones `idle`/`walk` | Sustituido: Kenney CC0 convertido a `caceres-pedestrian.glb` | Sin marcas; licencia registrada en `ATTRIBUTION.md` | `public/models/characters/` + `src/world/character.ts`, `src/world/npc-system.ts` |
| 2 | Coche deportivo sin marca con ruedas separadas y LOD | Completado: «Cáceres GT» original CC0 en Blender (`caceres-gt.glb`, 5 nodos, ruedas animadas) y LOD instanciados (`caceres-gt-traffic.glb`, `caceres-gt-police.glb`); `caceres-sedan.glb` se conserva como referencia | Sin libreas policiales/reales externas ni marcas; licencia registrada en `ATTRIBUTION.md` | `public/models/vehicles/` + `src/world/vehicle.ts`, `npc-models.ts` |
| 3 | Variantes de fachada para casco/ensanche/periferia con huecos y balcones | Completado (tanda 1): 17 módulos arquitectónicos Blender CC0 (`LOD0/LOD1`) integrados | Ancladas solo a huellas OSM exteriores evitando medianeras; sin geografía inventada | `public/models/citykit/` + `src/world/city-kit.ts`, `building-details.ts`, `building-styles.ts` |
| 4 | Props adicionales: bancos, papeleras, bolardos, contenedores | Ampliación de `tools/generate_citykit.py` | Anclados a nodos/propiedades OSM ya existentes | `public/models/citykit/` + `src/world/city-kit.ts` |
| 5 | Hitos de Cáceres (Torre de Bujaco, Arco de la Estrella…) | Requiere referencias verificables | No modelar de memoria; registrar fuente y licencia | `public/models/landmarks/` + catálogo de hitos |

## Reglas antes de incorporar cualquier asset

1. Anotar fuente, licencia y URL en `ASSETS_LICENSES.md` y `ATTRIBUTION.md`.
2. Verificar que no contiene marcas, logotipos ni contenido de GTA/Rockstar u otros juegos.
3. Exportar GLB con recursos embebidos y dos LOD cuando sea visible a distancia.
4. Comprobar `lint`, `typecheck`, `test` y `build`; medir draw calls, triángulos y tamaño de descarga antes y después.
5. No tocar `public/world`: sus hashes están registrados en el manifiesto.
