# Progreso del proyecto

## Estado actual del proyecto

- **Fases completadas:** 0 a 11 implementadas, auditadas y fusionadas en `main`.
- **Nuevas directrices estratégicas:** Implementadas en [`strategy/`](strategy/README.md) y [`AGENTS.md`](AGENTS.md) (modelos GLB CC0/CC-BY, Catastro de España para 12.000 portales, oficios cacereños, minimapa táctico de radar y audio procedural Web Audio).
- **City kit integrado y edificios diferenciados:** `tools/generate_citykit.py` genera ahora 44 GLB CC0 en Blender 5.2 (1 primitiva y atlas embebido `kit_atlas` por modelo; mobiliario urbano + 17 módulos arquitectónicos con LOD0/LOD1). Los edificios de Cáceres se diferencian en 12 arquetipos (`building-styles.ts`), atlas de fachadas 8×8 (`building-materials.ts`), aleros, zócalos, petos de azotea y detección de medianeras (`building-details.ts`), con conmutación de LOD de detalles en `ChunkManager.setLod()`. Comparativa con `?citykit=0` conservada.
- **Personaje y coche jugable:** El peatón es el derivado CC0 de Kenney (`caceres-pedestrian.glb`). El coche jugable es el «Cáceres GT», modelo original CC0 creado en Blender 5.2 (`build_car.py` + `export_car_glb.py`) y publicado como `caceres-gt.glb`; `caceres-sedan.glb` se conserva solo como referencia. `vehicle.ts` usa las ruedas del GLB y fusiona el resto por material; el coche arranca en `(8,8)` con dirección, aceleración, frenado, suspensión y cámara de persecución, y `KeyE` permite entrar/salir. El spawn se recoloca automáticamente cuando el streaming publica la altura del terreno. Licencias registradas en [`ASSETS_LICENSES.md`](ASSETS_LICENSES.md) y fallback procedural intacto. Revisión visual en navegador superada: 178 draw calls y 505.275 triángulos con el coche, sin errores de consola.
- **Próxima fase:** Fase 12 — Combate ligero estilizado e inicio de los oficios urbanos (Línea 1/8 autobús, paquetería en Judería), después de validar visualmente esta tanda de assets.
- **Despliegue corregido:** `format:check` volvió a pasar en GitHub Actions tras formatear `src/world/city-kit.ts`; el flujo de Pages ya puede publicar el build del city kit.

## City Kit GLB procedural y diferenciación de edificios

### Hecho
- `tools/generate_citykit.py` genera 44 GLB CC0 propios en Blender 5.2 headless (farola, encina, semáforo, señales, chimenea, balcones histórico y moderno, ventanas de casco/ensanche/modernas, portales de dovelas/modernos, escaparates con toldo, portones industriales, sillares esquinales, buhardillas, casetas de ascensor, climatizadores HVAC, espadañas, matacanes de torres y escudos nobiliarios; LOD0/LOD1 de cada uno).
- `src/world/building-styles.ts`, `building-materials.ts`, `building-builder.ts` y `building-details.ts` clasifican los 7.148 edificios OSM en 12 arquetipos reales (casco palaciego/encalado/ocre/terracota, ensanche ladrillo/estuco/moderno, periferia chalets/bloques/naves industriales/cívicos), pintan 4 bandas arquitectónicas en atlas 1024×1024 con mapa emisivo nocturno, añaden zócalos, aleros inclinados de teja y petos en azoteas planas, y suprimen vanos en medianeras contiguas.
- `src/world/city-kit.ts` y `src/world/chunk-manager.ts` comparten el material `kit_atlas` entre todos los GLB e instancian los detalles arquitectónicos separados por LOD0/LOD1 (`setLod()`).
- Inventario y licencias actualizados en `ASSETS_LICENSES.md`, `ATTRIBUTION.md`, `ASSETS_NEEDED.md` y `DECISIONS.md`.
- Medición Playwright (14–15 chunks): Plaza Mayor 112 draw calls / 375.151 triángulos / 90,0 MiB; Cánovas 106 / 272.003; Santa María 113 / 390.212 (muy por debajo de los límites de 300 draw calls y 600.000 triángulos; cero errores de consola).

### Pendiente
- Revisión visual humana de los 12 arquetipos, toldos, espadañas y matacanes en recorrido completo.
- Valorar variantes adicionales de vehículos CC0 (autobús urbano, taxi, patrulla).

### Cómo probar
- `npm run dev` y abrir `http://localhost:5173/?debug=1` para la versión con GLB (activa por defecto).
- Abrir `http://localhost:5173/?debug=1&citykit=0` para la versión baseline procedural. F9 muestra qué variante está activa.
- Comparar `#draw-calls`, `#triangles`, `#fps` y el aspecto visual en Plaza Mayor y en una calle arbolada. La medición automatizada con 5 chunks cargados dio 75/547.149 (baseline) frente a 111/503.728 (kit), dentro de los límites de 300 draw calls y 600.000 triángulos.
- Regenerar los GLB con Blender 5.2: `blender.exe --background --factory-startup --python tools/generate_citykit.py`.

## Fase 0 - Repositorio, herramientas y despliegue (completada)

### Revisión adicional de fase 2 (completada)
- Se corrigió el parseo de `--region` para aceptar tanto `--region=cc-monumental` como `--region cc-monumental`, según la guía.
- Overpass y el WCS de elevación comparten reintentos acotados, respetan `Retry-After`, limitan la respuesta y no descargan teselas de elevación demasiado deprisa.
- Las salidas se escriben atómicamente solo cuando cambian; el constructor elimina chunks obsoletos y el verificador detecta chunks huérfanos.
- Regenerada la región desde cachés locales: 900 chunks y 41.527 registros de elementos; los 15.024 tramos OSM incluidos en el informe de fidelidad coinciden con la geometría fuente con desviación máxima de 0 m. No se detectaron nombres de negocios bloqueados y la repetición produjo los mismos hashes.
- Catastro INSPIRE integrado como referencia de contraste en un núcleo de 1 km centrado en Plaza Mayor, sin cambiar los 7,6 km del mundo del juego. Las 2.502 huellas se consultan en teselas de hasta 250 m, con reintentos, límite de tamaño, subdivisión adaptativa y caché local. En 2.324 casos (92,9 %) los centroides quedan a 10 m o menos de un centroide OSM; es una métrica aproximada, no una afirmación de equivalencia geométrica.
- El GML original se queda en `data/raw/catastro/`, ignorado por Git. El manifiesto y el informe publican solo fuente, licencia, hash y métricas agregadas; no se exportan referencias catastrales, nombres ni geometrías Catastro a `public/`. La atribución quedó registrada en `ATTRIBUTION.md`.
- El inspector 2D se abrió y se verificó visualmente: representa las huellas y calles del extracto sobre la capa de comparación OSM. Muestra 7.148 edificios, 7.894 calles y 41.527 elementos en EPSG:25829.
- Verificación de cierre: formato, ESLint, TypeScript, build y 58 pruebas pasan; `verify-world` valida 900 chunks y `fidelity-check` confirma 15.024 tramos con desviación máxima de 0 m. Una segunda reconstrucción desde caché mantuvo los hashes del manifiesto e informes.

### Hecho
- Repositorio inicializado desde `hhg-ptm/CTA`.
- Leída la guía de fases: comienza con una base Vite/TypeScript y no añade juego todavía.
- Esqueleto Vite/TypeScript estricto, Three.js/WebGL2 y GitHub Actions para Pages.
- Escena de diagnóstico y panel FPS/draw calls/triángulos con tecla F3.
- Documentos `AGENTS.md`, `PROGRESS.md`, `DECISIONS.md` y `ATTRIBUTION.md`.
- Validación local: lint, typecheck, 1 prueba unitaria, build y comprobación visual en navegador.
- Fase 1: bucle fijo a 60 Hz con guardia de cinco pasos y render interpolado.
- ECS de capacidad fija con arreglos tipados, handles generacionales y recorrido sin crear objetos transform por entidad.
- EventBus tipado, logger con niveles, calidad por presets, entrada WASD/ratón/gamepad, cámaras libre y orbital.
- AssetManager con caché, prioridad de carga GLB, progreso, KTX2, Meshopt y transcodificador Basis local.
- Pruebas de ECS, eventos y orden/determinismo del bucle; 10.000 pasos reproducibles.
- Validación fase 1: lint, typecheck, 6 pruebas y build pasan; escena local observada a 75 FPS con 2 draw calls.

### Pendiente
- Activar GitHub Pages con origen GitHub Actions en Settings > Pages. El despliegue requiere publicar el commit de la fase 0 en `main`.

### Cómo probar
- `npm install`
- `npm run dev`
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`
- Despliegue en GitHub Actions a Pages tras habilitar Pages desde Actions en la configuración del repositorio.

## Fase 2 - Pipeline de datos geográficos (completada; revisión adicional)

### Plan
- Definir `cc-monumental` alrededor de Plaza Mayor en EPSG:25829 y documentar OpenStreetMap ODbL y CNIG MDT05 CC BY 4.0.
- Implementar consulta Overpass con caché local, conversión de geometría, proyección UTM, normalización de categorías, filtro de marcas y empaquetado CTA2 comprimido.
- Añadir lector local de ESRI ASCII Grid, manifiesto con hashes, informes de fidelidad/marcas e inspector 2D.
- Añadir fixtures locales para proyección, muestreo de elevación, normalización y sustitución de nombres comerciales.
- Descargar y validar el extracto OSM (4.549 elementos) y una malla regional MDT05 servida por WCS oficial IGN/CNIG en EPSG:25829.
- Generar 16 chunks deterministas con cabecera CTA2, hashes SHA-256, malla de terreno cuantizada y geometría normalizada.
- Validación local: lint, typecheck, 11 pruebas y build pasan; cero muestras de terreno ausentes.

Los datos fuente se guardan en caché local ignorada por git; el juego usa los chunks estáticos y no consulta servicios remotos. El informe registra edificios sin altura y comercios por revisar, sin inventar alturas ni conservar nombres reales de negocios.

### Cómo probar la fase 2
- `npm run data:build` usa cachés locales; descarga automáticamente el extracto OSM o MDT05 que falte.
- `npm run data:build:fresh` vuelve a descargar ambas fuentes oficiales.
- `npm run data:elevation` renueva solo la tesela MDT05 acotada de la región.
- Abrir `/debug/map.html` con el servidor Vite después de generar el manifest.

## Fase 3 - Terreno y streaming de chunks (completada)

### Plan
- Añadir `src/world/` para cargar el manifest y gestionar chunks con radio de carga/descarga con histéresis y prioridad por distancia.
- Añadir un Web Worker para descomprimir CTA2, crear mallas con normales, colores de suelo desde superficies OSM, LOD 3 niveles y skirts anti-grietas.
- Añadir Rapier heightfields solo en chunks próximos, eventos de carga/descarga y límites por presupuesto de trabajo.
- Sustituir el cubo de diagnóstico en `src/main.ts` por el terreno, niebla, controles de cámara y panel F4 con bordes de chunk y contadores.
- Registrar licencia/dependencia en `DECISIONS.md` y progreso; validar chunks reales, navegación, lint, typecheck, tests y build.

### Hecho
- Mallas de terreno con normales, color según superficies OSM, tres niveles de detalle (2/4/8 m) y skirts de 4 m.
- Web Worker para verificar CTA2, descomprimir, validar tamaños y construir las mallas; SHA-256 y límites de tamaño comprobados antes de enviar datos al worker.
- Carga con prioridad por distancia, radio de 512 m y descarga a 614 m; colliders heightfield Rapier solo hasta 192 m; eventos de carga/descarga y panel F4 que dibuja perímetros elevados siguiendo las muestras del terreno.
- Corregido el número de celdas del heightfield: Rapier recibe `samples - 1` por eje junto a la matriz completa de muestras.
- Verificador Playwright repetible en `tools/verify-streaming.mjs` y `npm run verify:streaming`.

### Validación de fase 3
- `eslint`, `tsc -b`, 15 pruebas Vitest y build Vite pasan; build inicial gzip de 875 kB, inferior al límite de 25 MB.
- Navegación automatizada de 5 minutos en Edge con bordes F4 visibles: las 16 teselas descargadas, de 5 a 12 chunks activos, cero errores, máximo frame durante streaming 14,7 ms y cero intervalos mayores de 16 ms.
- Memoria geométrica estimada durante el recorrido: 6,9–16,5 MiB; al terminar queda en 11,0 MiB con 8 chunks activos. El contador incluye buffers CPU del overlay F4 y no memoria del driver GPU.
- En el arranque previo al primer chunk se midieron frames de 80,1 y 26,8 ms mientras se inicializaban física y terreno; no ocurrieron con el terreno activo.

### Cómo validar el streaming
- Inicia Vite en `http://127.0.0.1:5173/`.
- Ejecuta `npm run verify:streaming`; el recorrido automatizado dura 5 minutos y falla ante errores, frames activos >16 ms o teselas no visitadas. Se puede pasar una duración en milisegundos a `node tools/verify-streaming.mjs` para una comprobación breve.
- Prueba unitaria: la geometría del borde usa muestras de elevación y se eleva 0,15 m para evitar z-fighting.
- F4 alterna el panel y los bordes; la geometría de borde se eleva 0,15 m siguiendo el MDT05 para evitar z-fighting.

## Fase 4 - Red viaria (completada)

### Plan
- Ampliar la normalización OSM con nodos compartidos, sentidos, carriles, superficie, aceras, rampas, puentes, túneles, escaleras y nodos de cruce/señal; actualizar la consulta y refrescar solo la fuente OSM oficial necesaria.
- Generar un grafo navegable estable con nodos, segmentos por carril y conexiones de intersección, listo para IA futura; guardar hash y atribución.
- Añadir geometría fusionada por chunk para calzadas, aceras, bordillos, intersecciones, pasos peatonales, flechas, marcas de stop/ceda y escaleras, ajustada a elevación MDT05 y con materiales repetibles por superficie.
- Añadir señalización vertical y semáforos instanciados en nodos OSM; crear colisionadores viales simplificados solo cerca del jugador.
- Integrar los datos y mallas en el worker/streaming y mostrar la ruta Plaza Mayor → Arco de la Estrella → Plaza de San Jorge en el inspector.
- Validar posición/topología contra OSM, ausencia de parpadeo entre superficies, presupuesto de draw calls, lint, typecheck, tests y build; registrar límites de datos ausentes sin inventarlos.

### Hecho
- Consulta Overpass actualizada y renovada: 4.561 elementos; se incluyen 156 nodos de cruce, 10 semáforos y 6 cedas el paso.
- Las 689 vías conservan nodos, sentidos, carriles, anchos/superficies conocidos, aceras y atributos de puentes/túneles/escaleras.
- `road-network.json` generado con 2.433 nodos, 2.744 segmentos, 569 intersecciones y 4.144 conexiones; manifiesto guarda tamaño y SHA-256.
- Mallas de calzada por superficie con UV repetibles y desgaste de vértice estable, aceras/bordillos inferidos, áreas peatonales rellenas, parches de intersección, curvas limitadas a 0,3 m, pasos zebra, carriles, flechas y líneas de stop/ceda.
- Puentes con perfil de tablero visual y rampas; túneles conservan la cota MDT05 mientras se difiere la excavación del terreno. Pasos `highway=steps` tienen peldaños individuales.
- Semáforos, cedas, stops y farolas se dibujan como lotes instanciados; los colliders triangulares de calles se activan junto a la altura del terreno en chunks cercanos.
- El inspector 2D resalta el trayecto de 403 m Plaza Mayor → Arco de la Estrella → Plaza de San Jorge desde elementos OSM confirmados; el manifiesto y el verificador validan tamaño, SHA-256 y referencias del grafo/ruta.

### Validación de fase 4
- `eslint .`, `tsc -b --pretty`, 26 pruebas Vitest y build Vite pasan; el build gzip de 887,8 kB permanece debajo del máximo de 25 MB.
- Recorrido automatizado de 5 minutos con carrera de QA: 16/16 chunks descargados; 5–16 activos; 75 FPS; máximo 53 llamadas de dibujo y 186.927 triángulos, frente a límites de 300 y 600.000.
- Máximo de frame durante streaming: 15,7 ms; cero intervalos >16 ms. Memoria geométrica estimada: 9–28,7 MiB, termina en 14,6 MiB con 8 chunks activos. Dos intervalos iniciales (20,5 y 93,4 ms) ocurrieron antes del primer chunk mientras arrancaba Rapier.
- El inspector confirma 689 calles, 2.847 edificios, 5.156 elementos y la ruta de referencia de 403 m; el grafo conserva one-way para futura IA y la ruta peatonal admite ambos sentidos.

### Cómo validar la fase 4
- `npm run data:build` reconstruye los chunks y el grafo desde cachés locales.
- `node tools/verify-world.mjs` comprueba integridad/hash, topología, ruta y nombres bloqueados.
- `npm run dev` y abrir `/debug/map.html` para comparar el trayecto con OpenStreetMap.
- `node tools/verify-streaming.mjs` hace el barrido de cinco minutos; falla si no visita las 16 teselas, rebasa 300 llamadas/600.000 triángulos, supera 16 ms durante streaming o no carga la ruta del inspector.
- Alcance excluido de la fase 4: vehículos y tráfico de IA.

## Fase 5 - Edificios (completada)

### Plan
- Conservar id OSM/Catastro, huella, altura/planta, `roof:shape`, tipo y zona; extraer geometría comercial para reservar una cara de rótulo y puntos de tejado para hitos de fase 6.
- Implementar extrusión de huellas con jerarquía `height=*` → `building:levels * 3 m` → default por zona/tipo, y cubiertas planas/a dos/a cuatro aguas por etiqueta y heurística de huella.
- Crear atlas procedural modular de fachada por zona, sembrado por id de edificio, con zócalo, plantas, balcones/ventanas/cornisa, ventanas emisivas deterministas y geometría low-poly de escudos/portadas sin textos.
- Generar tres LOD (fachada, caja texturizada, silueta) fusionados por chunk/material, colisiones simplificadas por huella y sustitución automática cuando exista `public/landmarks/<id>.glb`.
- Integrar los edificios en worker y streaming, ampliar el inspector 2D y verificar la silueta monumental, la distinción casco/ensanche/periferia, draw calls, triángulos, tests, lint, typecheck y build.

### Hecho hasta ahora
- Extraída la especificación del PDF (página 10): el alcance excluye modelos de hitos y rótulos finales, que corresponden a las fases 6 y 7.
- Las 2.847 huellas fuente conservan id OSM, etiquetas de altura/plantas, tipo, cubierta, material y etiqueta comercial; 2.811 caen en el recorte de chunks. Los 36 edificios exteriores permanecen fuera del mundo jugable. Los defaults visuales no sustituyen los valores OSM faltantes.
- Zonas heurísticas casco/ensanche/periferia por tipos monumentales y distancia al origen: 447 / 1.904 / 460 edificios dentro del mundo.
- Tres LOD de edificios fusionados por chunk/material; extrusión de huella, fachadas modulares por zona, zócalos, ventanas, balcones, cornisa, cubiertas planas/a dos/a cuatro aguas y colisión perimetral simplificada.
- Semilla estable por id para variación de fachada y emisividad de ventanas; reserva de cara comercial hacia la calle y anclas de tejado del casco para fase 6.
- Reemplazo opcional por `public/landmarks/<id>.glb`; el constructor limita tamaño, estructura, extensiones, número de vértices/texturas y URIs a recursos embebidos PNG/JPEG.
- Inspector 2D colorea las tres zonas; los chunks y el informe de fidelidad guardan la clasificación y los valores visuales inferidos.

### Validación de fase 5
- `eslint .`, `tsc -b --pretty`, 32 pruebas Vitest, `vite build` y `node tools/verify-world.mjs` pasan. Bundle inicial gzip: 944,2 kB; debajo de 25 MB.
- Verificación automatizada de 5 minutos: 16/16 chunks; 5–16 activos; 75 FPS; máximo 85 draw calls y 303.477 triángulos; pico de frame durante streaming 15,6 ms y cero intervalos >16 ms.
- Memoria geométrica estimada: 23,9–70,8 MiB; termina en 32,4 MiB con 8 chunks. El arranque previo al primer chunk tuvo frames de 26,6, 93,4, 26,7 y 40 ms durante inicialización de física, fuera del streaming.
- No hay GLB de hitos en el repositorio, así que el reemplazo se valida con fixtures acotados; modelos manuales y rótulos visibles quedan fuera de esta fase.

### Cómo validar la fase 5
- `node tools/data-build.mjs` regenera los chunks desde las cachés OSM/MDT05 locales; `node tools/verify-world.mjs` valida integridad, conteos de zona y referencias.
- Ejecutar `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` y `node tools/verify-streaming.mjs` desde la raíz del repositorio.
- `/debug/map.html` compara las huellas y zonas con OSM; el QA 3D comprueba streaming, LOD y presupuesto visible.

## Fase 6 - Hitos y fidelidad (en curso)

### Hecho hasta ahora
- Añadido un catálogo de hitos de referencia basado en la lista de la guía. Los objetivos de `cc-monumental` se distinguen de los que requieren una futura región de ciudad.
- El pipeline audita nombres OSM de vías, edificios no comerciales, superficies y POIs con coincidencia exacta normalizada; el informe enlaza los IDs fuente.
- La consulta incluye plazas (`place=square`) y relaciones históricas. La normalización conserva sus IDs como `r<number>` y calcula un centro de referencia desde miembros exteriores, sin usarlo como huella.
- Se confirmó la relación OSM `r5728957` del Palacio de los Golfines de Abajo; no se confunde con el Palacio de los Golfines de Arriba.
- Los 13 de 13 hitos de `cc-monumental` aparecen en el extracto OSM regenerado. Las otras 6 referencias quedan fuera del alcance de esta región.
- Ampliado `cc-monumental` a 7,6 km por lado alrededor del mismo origen; conserva chunks de 256 m y ahora cubre las referencias urbanas del parque, avenida, estadio, estación y campus. La descarga local contiene 30.186 elementos OSM y la región se construye en 900 chunks deterministas.
- El catálogo encuentra ahora los 19 hitos: el hospital se vincula al perímetro cerrado OSM `w389025250` (`amenity=hospital`, Ciudad de la Salud y la Innovación). El polígono contiene el punto de Hospital de Día y la etiqueta mal escrita del museo/taxi; se usa como límite del complejo, nunca como huella de un edificio concreto.
- Añadida una silueta procedural low-poly del Arco de la Estrella anclada al POI OSM y orientada desde la vía más cercana, además de almenado aproximado para torres. Se añadió un material procedural de piedra y un fallback visual de 7 plantas solo para torres sin altura/plantas fuente.
- Las áreas `place=square` ya se procesan como superficies y POIs: sus huellas OSM se renderizan en el terreno con la clasificación de piedra.
- Las líneas `barrier=city_wall` se conservan y reciben una silueta de muralla sobre su trazado OSM, con medidas visuales aproximadas documentadas por ausencia de cotas.
- El informe de hitos ahora indica la geometría fuente disponible (huella, polígono, trazado, vía o punto/centro); evita tratar un POI sin huella como si fuera un edificio modelable.
- Añadido el catálogo canónico de fase 6 con 19 entradas, una ficha Markdown por hito y `status.json` en pendiente. El pipeline incorpora posiciones, huellas y alturas solo cuando la extracción OSM las aporta; los hitos exteriores siguen sin fuente geométrica en la región actual.
- Añadido `npm run fidelity`: compara directamente las vías y huellas OSM con los chunks y falla si falta geometría, aparece una forma inesperada o supera 1 m. La comprobación local comparó 15.024 vías/huellas con desviación máxima 0,0000 m.
- El inspector 2D puede superponer trazados OSM originales y huellas de edificio sobre el mundo; queda pendiente la revisión visual humana.
- La extracción nueva incluye `barrier=city_wall`; los chunks regenerados conservan sus tramos. Se añadieron cigüeñas low-poly en torres y una selección estable de tejados del casco; al acercarse el jugador baten las alas y despegan, y vuelven a posarse cuando se aleja.
- El data build regeneró 900 chunks; los verificadores confirmaron hashes, terreno MDT05 completo, fidelidad de 15.024 vías/huellas con desviación máxima 0,0000 m, red vial, ruta y ausencia de nombres comerciales bloqueados.
- Se completaron los modelos low-poly específicos de fase 6 (soportales de Plaza Mayor, campanario de la Concatedral, escalinata de San Francisco Javier y torre sintética de Torre de las Cigüeñas); todos los valores dimensionales son aproximaciones pendientes de revisión fotográfica. lint, typecheck, 34 pruebas y build pasan.
- Añadido un relieve low-poly de soportales en el frente del Ayuntamiento hacia Plaza Mayor, orientado mediante huellas OSM. Las medidas son aproximaciones visuales documentadas y el hito permanece pendiente de revisión humana.
- Añadida una portada apuntada a la Concatedral en el lado de su huella OSM orientado a Plaza Mayor y una torre occidental procedural de tres cuerpos con cuatro flameros, situada según el extremo oeste de la huella. Las dimensiones y el anclaje son aproximaciones, pendientes de revisión visual.
- Añadidas dos torres low-poly sobre la fachada de San Francisco Javier orientada a San Jorge, a partir de su huella OSM y los rasgos de torre cuadrada documentados por el SIG municipal. Tamaños y ubicación precisa siguen pendientes de comparación fotográfica.
- Confirmado que la escalinata de Plaza San Jorge reutiliza peldaños OSM `highway=steps`; se documentaron fuentes institucionales y límites geométricos de los detalles monumentales pendientes.
- La ficha oficial de Cáceres Histórica y el CEFOT 1 describen la Torre de las Cigüeñas como cuadrada, con cuerpo superior volado sobre ménsulas y merlones. El punto OSM nombrado para el museo está dentro del perímetro de la relación del palacio y fuera del patio; la nueva silueta se ancla a ese punto, no a la huella completa del palacio.

### Pendiente
- Revisar visualmente con fotos los soportales, portada y torres recién añadidos, en especial las proporciones y el anclaje de las torres de la Concatedral y las Cigüeñas. La escalinata ya se genera desde las vías OSM `highway=steps`.
- Revisar visualmente con fotos la colocación del hospital como recinto y distinguir los edificios individuales dentro del complejo.
- Ejecutar lint, typecheck, pruebas, build y revisión visual; ningún hito puede pasar a aprobado sin comparación humana con fotografías.

## Fase 7 - Marcas ficticias (en curso)

### Plan
- Sustituir nombres comerciales reales por identidades ficticias originales; ampliar `tools/brand-blocklist.json` con las cadenas reales presentes en el extracto OSM.
- Renderizar rótulos (sign slots) sobre fachadas comerciales con el nombre ficticio.
- Verificar que ningún nombre de marca real aparezca en los chunks (verify-world).
- Actualizar `reports/brands.md` y documentar en `DECISIONS.md`.

### Hecho hasta ahora
- Ampliado `brand-blocklist.json` con 8 cadenas reales (supermercados, bancos, hoteles, restaurantes, farmacias vía genéricos) mapeadas a marcas ficticias; 26 POIs ahora quedan como `mapped`.
- Los edificios comerciales reciben un nombre ficticio en `normalize-data.mjs` y lo exponen como `BuildingSignSlot.name`.
- Añadido renderizado de rótulos en `chunk-manager.ts` (`createBrandSign`) con textura canvas; se crean al cargar el chunk y se liberan al descargarlo.
- `verify-world.mjs` ahora comprueba solo nombres comerciales (fictional/commercial) con límites de palabra, evitando falsos positivos por calles.
- lint, typecheck, 34 pruebas, build y verify-world pasan.

### Pendiente
- Revisar visualmente los rótulos en navegador y ajustar tamaño/contraste.
- Añadir más cadenas reales si aparecen en futuras regiones.

## Fase 8 - Personaje jugable (en curso)

### Plan
- Añadir un personaje low-poly procedural (src/world/character.ts) con animación de caminata.
- Controlar el personaje con WASD en modo tercera persona; la cámara orbita alrededor (CameraRig ya soporta thirdPerson).
- El personaje se ajusta a la altura del terreno (chunks.groundHeightAt) y rota hacia la dirección de movimiento.
- Alternar libre/tercera persona con Tab.

### Hecho hasta ahora
- Añadido Character con malla low-poly (torso, cabeza, brazos, piernas, pies) y animación de caminata.
- Integrado en main.ts: modo por defecto tercera persona; el personaje se mueve con WASD relativo a la cámara y se ajusta al terreno.
- Añadido CameraRig.getYaw() para orientar el movimiento.
- lint, typecheck, 34 pruebas y build pasan.

## Fase 9 - Vehículos (en curso)

### Plan
- Implementar controlador de vehículo con Rapier DynamicRayCastVehicleController (suspensión, tracción, dirección, freno).
- Añadir vehículo low-poly (carrocería + 4 ruedas) con parámetros de manejo.
- Entrar/salir con tecla E; conducir con WASD + Espacio (freno de mano).
- Cámara de persecución reutilizando CameraRig en modo tercera persona.
- Aparcar al menos un vehículo cerca del origen para probar.

### Hecho hasta ahora
- Añadido src/world/vehicle.ts con DynamicRayCastVehicleController y malla low-poly.
- Integrado en main.ts: aparición de un vehículo, entrada/salida con E, conducción WASD+Espacio, cámara de persecución.
- lint, typecheck, 34 pruebas y build pasan.

### Pendiente
- Añadir más tipos de vehículo (moto, furgoneta, taxi, patrulla, autobús) y datos en src/data/vehicles/*.json.
- Ruedas que giran/steer (ya básico), luces, bocina, partículas, daño visual.
- Vehículos aparcados a lo largo de calles según OSM.
- Cámara capó y cinemática.

### Correcciones (buildings collision, salto, pies)
- Añadido collidesWithBuilding en ChunkManager basado en huellas de edificio; el personaje desliza en lugar de atravesar.
- Añadido salto (Espacio) y gravedad/ajuste al terreno en Character.
- Pies ahora son hijos de las piernas para que se animen al caminar.
- Añadido `footprints` a `BuiltBuildingChunk`.

### Integración del PR #3 (merge)
- Fusionada la rama `codex/phase-6-landmark-followup`: región ampliada a 7,6 km, 900 chunks, 19 hitos y módulos de detalle de hitos (`landmark-details.ts`, `concatedral-tower.ts`, `ciguenas-tower.ts`).
- Los conflictos de datos (16 chunks, manifiesto, informes) se resolvieron con la versión del PR porque el manifiesto guarda SHA-256 por chunk; mezclar chunks de versiones distintas rompería la verificación.
- `PROGRESS.md` conserva las notas de las fases 7-9 y añade las novedades del PR; se corrigió la codificación mixta UTF-8/CP1252 heredada.
- Causa raíz corregida para la colisión de cámara con edificios: Rapier no actualiza el query pipeline hasta llamar a `world.step()` o `world.updateSceneQueries()`. El `castRay` devolvía `null` antes de esa llamada (comprobado empíricamente). `TerrainColliders` marca los cambios y `refreshQueries()` reconstruye el pipeline; `main.ts` lo invoca al inicio de cada fotograma y tras crear el vehículo. Nueva prueba que verifica que un rayo no ve el collider hasta refrescar y lo detecta después.

## Fase 10 - tráfico y peatones (en curso)

### Plan
- Convertir `road-network.json` en un grafo dirigido con índice espacial y A*; separar la red vehicular (sentidos y carriles) de la peatonal (`walkable` en ambos sentidos).
- Simular peatones y coches con arreglos tipados, *pooling*, aparición detrás de la cámara, LOD por distancia, evitación local, prioridad en intersecciones y detección de atascos.
- Renderizar ambas poblaciones con dos `InstancedMesh` procedurales, sin assets externos.
- Validar el grafo y generar `reports/audit-npcs.md` con `npm run audit:npcs`.

### Hecho hasta ahora
- `src/world/road-graph.ts`: 41.253 nodos y 46.812 segmentos indexados en celdas de 48 m; A* reutiliza su heap y marca los costes por generación para no asignar memoria por búsqueda.
- `src/world/npc-models.ts`: peatón y coche low-poly procedurales fusionados en una geometría por tipo; dos llamadas de dibujo para toda la población.
- `src/world/npc-system.ts`: hasta 150 peatones y 60 coches en calidad alta (escalado por `quality.populationDensity`), spawn/despawn fuera del campo visual, evitación, cesión en intersecciones, re-ruteo tras 3 s y retirada tras dos fallos.
- `main.ts` carga la red viaria de forma diferida (≈30 MB) después del primer fotograma y actualiza los agentes en el bucle de 60 Hz; el panel muestra el número de peatones y coches.
- `tools/validate-road-graph.mjs` y `reports/audit-npcs.md`: 0 nodos aislados, 0 intersecciones sin conexiones, 11 sumideros y 9 fuentes vehiculares, 300 tramos peatonales sobre huellas (el sistema los descarta al moverse).
- Pruebas unitarias del grafo (sentido único, grafos separados, ruta A*) y del ciclo de vida del pool; lint, typecheck y build pasan.

### Pendiente
- Semáforos y señales de stop: el extracto OSM no los incluye en el grafo; hoy se usa prioridad por llegada con tiempo máximo de espera.
- Animación de extremidades por agente, reacciones al jugador (mirar/huir), voces en español y escenas de vida (sentarse, escaparates).
- Prueba de resistencia de 10 minutos con 150 peatones y 60 coches y medición de coste de IA (<4 ms/frame).
- Carga del grafo en Web Worker para reducir el bloqueo de parseo inicial.
- `npm run fidelity` falla por un problema de entorno previo a esta fase: la caché local `data/raw/osm/cc-monumental.json` sigue siendo el extracto antiguo de 1 km (4.561 elementos), mientras el mundo fusionado cubre 7,6 km (41.527 elementos). Requiere `npm run data:osm:fresh` y reconstruir datos; `verify:data` y `audit:npcs` sí pasan con los datos desplegados.

### Cómo probarlo
- `npm run audit:npcs` regenera el informe del grafo.
- Abrir la web desplegada: los agentes aparecen a 45–290 m del jugador, siempre detrás de la cámara; el panel F4 muestra `Agentes`.

## Fase 11 - delitos y policía (completada)

### Plan
- Modelar nivel de búsqueda, calor, decaimiento y detención en un módulo puro y probarlo por separado.
- Perseguir al jugador con patrullas instanciadas sobre el grafo viario real, sin inventar calles ni añadir assets.
- Conectar robo de vehículo ambiental, atropello y conducción temeraria con el nivel de búsqueda.
- Mostrar estrellas y avisos con claves i18n, y devolver al jugador a Plaza Mayor tras la detención.

### Hecho hasta ahora
- `src/world/crime-system.ts`: calor 0–5, estrellas redondeadas, enfriamiento más rápido si la policía está lejos (>260 m), *cooldowns* por tipo de delito y detención tras 2 s a menos de 7 m y 2,5 m/s.
- `src/world/police-system.ts`: hasta cinco patrullas agrupadas en un `InstancedMesh`, spawn detrás de la cámara, re-ruteo A* cada 1,5 s hacia el nodo más cercano al jugador, prioridad en intersecciones y retirada al caer el nivel a cero.
- `src/world/npc-system.ts`: `alarm()` (peatones huyen y evitan la amenaza en los cruces), `claimVehicle()` (robo de un coche ambiental) y `checkVehicleImpact()` (atropello).
- `src/world/npc-models.ts`: coche policial procedural con barra de luces; colores azul/blanco ficticios, sin marcas reales.
- `src/main.ts`: la tecla `E` roba coches ambientales o sale del vehículo; atropellar a >6 m/s y circular a >16 m/s durante 2,5 s suman calor; al ser detenido se reinicia la búsqueda y se reaparece en Plaza Mayor.
- `src/i18n.ts`: primer *seam* de internacionalización; los textos nuevos del HUD y los avisos se resuelven mediante claves.
- `tests/crime.test.ts`: 4 pruebas de calor, *cooldown*, decaimiento, arresto, persecución y robo; `lint`, `typecheck`, `test` y `build` pasan.

### Pendiente
- Fase 12: combate ligero estilizado (sin armas de terceros ni assets con copyright).
- Denuncia ciudadana automática y phases de señales de tráfico: el extracto OSM sigue sin semáforos en el grafo.
- Persecución con radio de búsqueda, pérdida de visión y registro de delitos en guardado (fase 13).
- Prueba de resistencia de la persecución con cinco patrullas y 150 peatones durante 10 minutos.

### Cómo probarlo
- Pulsa `E` junto a un coche ambiental para requisarlo: suben 2 estrellas y aparecen patrullas detrás de ti.
- Atropella un peatón o conduce rápido para aumentar el nivel; el panel F4 muestra `Búsqueda`.
- Detente cerca de una patrulla durante 2 s: aparece `DETENIDO` y vuelves a Plaza Mayor con el nivel a cero.

## Corrección posterior a la Fase 11 - agentes, colisiones y materiales (completada)

### Plan
- Diagnosticar por qué los agentes instanciados se veían blancos y por qué no exertían colisión.
- Dar a la acera un material propio para que no comparta aspecto con la calzada de piedra del casco antiguo.
- Añadir físicas reales a peatones, tráfico y patrullas sin perder los dos draw calls por sistema.

### Hecho hasta ahora
- `src/world/npc-models.ts`: las geometrías fusionadas incluyen un atributo `color` blanco y el material usa `vertexColors`; junto con `setColorAt()` y `instanceColor.needsUpdate`, los colores por agente ya llegan a la GPU.
- `src/world/agent-colliders.ts`: nuevo adaptador que crea cuerpos cinemáticos de Rapier (cápsula para peatones, caja para coches) y sincroniza traslación/rotación con el grafo. `src/main.ts` lo conecta a `NpcSystem` y `PoliceSystem`.
- `src/world/vehicle.ts`: se descubrió que el controlador de Rapier solo actualiza velocidades; ahora se llama a `world.step()` después de aplicar fuerzas, de modo que el chasis integra contactos con terreno, edificios y agentes.
- `src/world/npc-system.ts` y `src/world/police-system.ts`: empujan al jugador a pie fuera de los huecos de los agentes (`resolveCollision`) y liberan los colisionadores al desaparecer.
- `src/world/types.ts`, `road-geometry.ts`, `road-materials.ts` y `road-builder.ts`: nuevo estilo `sidewalk`, con textura de losa clara, distinto de `stone` (calzada) y de `concrete` (bordillo); se bajó el tono del asfalto para reforzar el contraste.
- `tests/npc.test.ts` y `tests/road-builder.test.ts`: nuevas comprobaciones de coloreado, empuje al jugador y presencia del estilo de acera. `lint`, `typecheck`, `test` (42/42) y `build` pasan.

### Pendiente
- Medir el coste de hasta 215 cuerpos cinemáticos en la prueba de resistencia de 10 minutos y, si hace falta, filtrar grupos de colisión para que los agentes solo interactúen con el coche del jugador.
- Añadir animación de extremidades y reacciones ricas de los peatones (fase 10 pendiente).

### Cómo probarlo
- Conduce contra un coche ambiental o una patrulla: el chasis ya no los atraviesa.
- Camina hacia un peatón: el personaje queda fuera de su hueco en lugar de superponerse.
- Mira una calle del casco antiguo: la acera clara y el bordillo se distinguen de la calzada de piedra.

## Integración del PR #4 - herramientas de auditoría (completada)

### Plan
- Resolver el conflicto entre la rama del PR y `main` conservando las fases 10/11 y la corrección de agentes.
- Incorporar el modo de depuración, overlays, consola y tour Playwright sin cambiar la experiencia normal de juego.
- Corregir las incompatibilidades del PR con el código actual y documentar las limitaciones reales.

### Hecho hasta ahora
- Rama de resolución basada en `origin/main` con el HEAD del PR#4 superpuesto; el HUD y la documentación se conservan de `main` y se añaden solo las herramientas nuevas.
- `?debug=1`: F3 panel, F4 bordes, F5 colisionadores, F6 calzadas, F7 LOD, F8 sombras, F9 aviso y ` consola. Sin el parámetro, F4 mantiene su comportamiento anterior.
- `src/engine/debug-console.ts`, `src/world/debug-overlays.ts`, `playwright.audit.config.ts`, `tests/e2e/debug-audit.spec.ts`, `tests/e2e/audit-destinations.json` y `reports/audit-debug.md` incorporados.
- Corregidos `minimumHeight`/`maximumHeight` en el overlay de LOD, la ruta del catálogo de hitos (copiado a `public/data/landmarks/`), el navegador del tour (Chromium) y la exclusión de los specs E2E de Vitest.
- `npm run audit` genera capturas en `reports/screens/audit-<fecha>/` y el resumen en `reports/audit-summary.md`; las capturas están ignoradas por Git.
- `lint`, `typecheck`, `test` (42/42), `build`, `data:verify` y `audit:npcs` pasan tras la integración.

### Pendiente
- Ejecutar el tour completo una vez publicada la región urbana ampliada: el despliegue actual solo sirve `cc-monumental` y varias paradas caen fuera de su manifiesto.
- Conectar comandos de consola `time`, `weather`, `god` y `wanted` cuando existan esos sistemas (el nivel de búsqueda ya existe en el HUD, pero no se expone aún como comando).

### Cómo probarlo
- Abre `/?debug=1` y pulsa ` para abrir la consola; escribe `help`, `tp Plaza Mayor`, `spawn vehicle` o `noclip`.
- Prueba F5/F6/F7 para ver colisionadores, calzadas y límites de LOD; F8 alterna sombras.
- Ejecuta `npm run audit` con el servidor de desarrollo disponible para generar el informe de las diez paradas.

## LOD de simulación de agentes (completado)

### Plan
- Recuperar la idea del commit `251c794` del fork, posterior al cierre del PR #4, y adaptarla al `NpcSystem` actual con colisionadores cinemáticos.
- Reducir el coste de los agentes lejanos sin cambiar su aspecto ni hacerlos atravesables.
- Exponer los recuentos por nivel en el HUD de depuración y comprobar que la población no se pierde.

### Hecho hasta ahora
- `src/world/npc-system.ts`: niveles near/mid/far a 90 y 210 m con cadencias de 1/2/4 frames; el tiempo se acumula por agente, se reparte entre frames y cada paso se limita a 0,05 s. Los agentes siguen dibujándose y moviendo su colisionador; los lejanos avanzan más despacio.
- `lodCounts` sustituye el `0 / 0 / 0` fijo en `main.ts` (HUD y `window.__CTA_DEBUG__.metrics()`).
- El despawn usa distancia al cuadrado y se evalúa cada 0,25 s junto al spawn.
- `tests/npc.test.ts`: nueva prueba de que la suma de los tres niveles iguala la población activa y que el nivel cercano está poblado.

### Pendiente
- Medir el ahorro real de CPU con 150 peatones y 60 coches en la prueba de resistencia de 10 minutos.

### Cómo probarlo
- Abre `/?debug=1` y observa `Agentes por LOD`: los tres números suman el total de `Agentes`.
- Al caminar, el nivel cercano cambia mientras los agentes lejanos siguen visibles y conservan sus colisionadores.

## Corrección visual y colisión sobre calzadas (completada)

- El jugador ahora sigue la altura triangulada de calzadas, bordillos y aceras además del MDT05. Se añadió un índice por celdas espaciales y movimiento con pasos cortos para reducir hundimientos y atravesamientos.
- Las calles asfaltadas contrastan más con aceras y piedra. Los peatones conservan colores naturales de piel y ropa; coches y patrullas tienen cristales separados, detalles de rueda y carrocería.
- El LOD lejano de edificios conserva la huella de calle original y la forma de cubierta, en lugar de usar rectángulos alineados al mapa.
- Integrado desde el PR #8 y corregido: `paneGeometry()` y `cabinGeometry()` generan `uv` para que `mergeGeometries()` no descarte el coche instanciado, y las pruebas de LOD de edificios y de colores de agentes reflejan el comportamiento real.
- Validado con `lint`, `typecheck`, `test` (43/43) y `build`; sin advertencias de geometría. Pendiente únicamente la comprobación visual en ejecución local.

## Pasada visual de era PS2 (integrada en el PR #10)

### Hecho
- Integrado el trabajo del PR #9 de `delgadomin`: personaje y peatones con ropa por capas y rasgos más legibles, coches con carrocería esculpida, cristales, asientos, ruedas y molduras, fachadas con ventanas arqueadas y contraventanas, y guardabarros del coche conducible alineados con las ruedas.
- El PR #9 no se podía mergear directamente (draft, conflicto en `npc-models.ts` y sin permisos sobre el fork), así que se integró como PR #10 conservando los commits originales.
- Corregidos los 4 errores de TypeScript del moteado de fachada con `seededSequence()` y restablecido el atributo `uv` en las dos geometrías nuevas de vehículo.

### Verificación
- `npm run lint`, `npm run typecheck`, `npm test` (43/43) y `npm run build`: correctos, sin advertencias de `mergeGeometries()`.

### Pendiente
- Revisar en ejecución local que las nuevas siluetas y fachadas se lean bien a distancia y que el coste de triángulos siga dentro del objetivo.

### Cómo probarlo
- Abre `/?debug=1`, camina por el casco antiguo y conduce un coche; compara fachadas, peatones y vehículos con la versión anterior.


## Pasada de gráficos, atmósfera y pulido de NPCs (completada)

### Hecho
- **Atmósfera e iluminación:**
  - Luz solar direccional (`sun`) con sombras suaves PCF (`PCFSoftShadowMap`) que se desplaza junto al jugador manteniendo nítidas las sombras de edificios, árboles y vehículos.
  - El terreno y las carreteras ahora reciben sombras arrojadas proyectadas de forma natural.
  - Cúpula de cielo procedimental con gradiente atmosférico cálido (horizonte dorado y cenit azul intenso) y niebla de distancia ajustada para evitar desvanecimientos grises prematuros.
  - Luz de hemisferio con rebote inferior cálido para sombras menos oscuras y más ricas en contraste.
- **Materiales y estética:**
  - Material textil específico para peatones (acabado mate, alta rugosidad, bajo metalness).
  - Material automotriz específico para vehículos con brillo de chapa, reflejos y cristales tintados translúcidos.
  - Contraste acentuado entre calzadas de asfalto, calzadas de piedra, aceras peatonales de losa y bordillos.
- **Comportamiento y variedad de NPCs:**
  - 20 variantes de color de indumentaria y 14 de vehículos (ampliando la variedad de la multitud).
  - Escalas aleatorias variadas en peatones (entre 0.88 y 1.12) para alturas y siluetas humanas no uniformes.
  - Rotaciones de agentes suavizadas con interpolación angular (`turnRate`), eliminando giros bruscos/robóticos en intersecciones.
  - Rampa diferenciada de aceleración y frenado para peatones y vehículos.
  - Paso de caminata con inclinación frontal según velocidad y balanceo corporal orgánico.
  - Filtro estricto de generación angular detrás de la cámara para prevenir apariciones visibles.
- **Cámara y jugabilidad:**
  - Suavizado cinemático con interpolación (*lerp*) en el seguimiento de la cámara en 3ª persona.
  - FOV dinámico que se abre gradualmente al acelerar en coche, aumentando la sensación de velocidad.
  - Postura y animaciones de carrera del protagonista mejoradas con inclinación de torso y braceo.
  - Avisos HUD y estrellas de búsqueda estilizados con mayor legibilidad.

### Verificación
- `npm run lint`: sin errores.
- `npm run typecheck`: sin errores de TypeScript.
- `npm test`: 43/43 pruebas unitarias pasando.
- `npm run build`: compilación de producción en Vite exitosa.

### Cómo probarlo
- Iniciar `npm run dev` y moverse a pie o en vehículo:
  - Observar las sombras proyectadas sobre el asfalto y el suelo.
  - Acelerar en coche para apreciar la apertura dinámica del campo de visión (FOV) y la cámara suave.
  - Observar cómo los peatones y el tráfico giran de manera natural y suave en las esquinas.

## Corrección de física y robo de vehículos (completada)

### Hecho
- El vehículo conducible ahora conserva el color procedural y el ángulo de marcha (`heading`) del coche ambiental requisado.
- Corregida la cota del chasis a `y + 0.82` para equilibrar la suspensión y erradicar el impulso elástico de descompresión violenta contra el suelo.
- Las instancias de agentes liberadas en `NpcSystem` se limpian de inmediato en el `InstancedMesh` para evitar artefactos visuales superpuestos.
- Salida inteligente de vehículos evitando solapes con fachadas y edificios.

### Verificación
- `npm run lint`, `npm run typecheck`, `npm test` (43/43) y `npm run build` pasando correctamente.

## Renovación visual drástica, modelos 3D y atmósfera cinematográfica (completada)

### Hecho
- **Relieve y texturas del terreno y calzadas:**
  - Micro-relieve procedural de 512×512 píxeles (`createTerrainDetailTexture()`) con grava, tierra y motas minerales integrado con coordenadas UV planares en `ChunkManager`.
  - Calzadas con adoquines de granito biselados y llagas de mortero (`stone`), aceras con losas serradas con relieve (`sidewalk`) y asfalto granular.
  - Tejas árabes curvas con sombreado cilíndrico tridimensional en tejados y sillería de granito en hiladas regulares con juntas rehundidas para monumentos y muros.
  - Ventanas con brillo diagonal de reflejo celeste y repisas de granito biseladas.
- **Vegetación y mobiliario urbano:**
  - Árboles mediterráneos orgánicos (estilo encina / pino piñonero) con troncos ramificados y 5 racimos de follaje dodecaédrico.
  - Farolas históricas de forja con pedestal octogonal, poste estriado, jaula de linterna de 4 caras y remate, proyectando sombras reales.
- **Vehículos y personajes:**
  - Colores automotrices realistas (14 acabados metalizados elegantes).
  - Llantas de aleación plateadas de 5 radios con discos de freno, tubos de escape dobles cromados, ópticas de xenón de alta emisión y matrículas europeas/españolas.
  - Patrullas policiales con libreas verde/azul y puente de luces aerodinámico estroboscópico.
  - Protagonista con gafas de sol polarizadas, cremallera metálica, cinturón, reloj de pulsera dorado y zapatillas con entresuela blanca.
  - Peatones con accesorios urbanos (bandoleras, gafas de sol, calzado estilizado).
- **Atmósfera y cielo:**
  - Sol bajo de hora dorada (~33° de elevación, `#fff0d6`, intensidad 3.6) generando sombras largas espectaculares.
  - Disco solar brillante y corona cálida visibles en el cielo, siguiendo al jugador.
  - Gradiente de cielo cálido ibérico (melocotón en horizonte a azul profundo en cenit) con niebla atmosférica y tone mapping ACESFilmic a 1.14.

### Verificación
- `npm run lint`: sin errores.
- `npm run typecheck`: sin errores de TypeScript.
- `npm test`: 43/43 pruebas unitarias pasando.
- `npm run build`: compilación de producción exitosa en 2.18s.

## Integración gamedev-skills: Motor de audio procedural, minimapa y respuesta de cámara (completada)

### Hecho
- **Motor de audio procedural Web Audio API (`src/engine/audio-system.ts`):**
  - Sistema de audio 100% procedural en tiempo real (cero archivos de audio externos, cero consumo de ancho de banda).
  - Sonido dinámico de motor con oscilador sawtooth y filtro pasobajo reactivo a la velocidad y aceleración del coche.
  - Generador de chirrido/derrape de neumáticos con ruido blanco filtrado en paso banda al usar freno de mano o giros a velocidad.
  - Claxon vehicular bitonal armónico europeo con tecla `H`.
  - Sirena de policía con modulación LFO bifásica y atenuación espacial según distancia a la patrulla más cercana.
  - Efectos de pisadas por zancada (`stepTriggered`), crujido de impacto en colisiones y avisos sonoros de búsqueda/detención.
  - Silenciado/activación de audio con tecla `M` y desbloqueo seguro de AudioContext por interacción de usuario.
- **Minimapa de radar circular (`src/ui/minimap.ts`):**
  - Radar táctico en esquina inferior izquierda con rotación según cámara, cuadrícula métrica y aguja indicadora de Norte ("N").
  - Marcadores de posición en tiempo real para jugador, tráfico ambiental y patrullas policiales con estroboscopio rojo/azul.
  - Borde con efecto pulsante animado durante persecuciones policiales activas.
- **Impacto y sacudida de cámara (Trauma cuadrático):**
  - Sacudida cinemática de cámara en 3 ejes ante colisiones y atropellos mediante `CameraRig.addTrauma()`.
- **Controles y textos:**
  - Actualizados los avisos y el hint de controles en HUD con las nuevas acciones (`H` claxon, `M` audio, `Espacio` freno de mano).

### Verificación
- `npm run lint`: sin errores.
- `npm run typecheck`: sin errores de TypeScript.
- `npm test`: 47/47 pruebas unitarias pasando (13/13 suites, incluyendo `tests/audio-and-ui.test.ts`).
- `npm run build`: compilación de producción exitosa en 2.11s.

- La triangulación de cada celda compara ambas diagonales y usa la más corta en 3D, adaptando la malla a las cotas MDT sin desplazar ni inventar alturas.

## Integración de los PR #11 y #14 - modelos CC0 (completada)

### Hecho
- Se resuelve localmente el merge del PR #14 sobre `main` conservando las correcciones de los PR #10, #12 y #13; se añaden solo los modelos CC0 y su documentación. El PR #11 queda supersedido por el #14.
- Jugador: GLB «Casual Walker» de Tevy con animaciones `idle`/`walk` y fallback procedural si falla la carga. Peatones: pose de marcha horneada del LOD1 en una sola malla instanciada, sin teñido por instancia. Coches manejables: sedán CC0 de Innerscene agrupado por material; los coches ambientales y patrullas siguen siendo procedurales.
- Se descarta `atmosphere.ts` porque el cielo, el disco solar y la corona ya presentes en `main` cubren esa función con la paleta actual. No se toca `public/world` ni se introducen assets con copyright.
- Atribuciones en `ATTRIBUTION.md`; decisiones de integración en `DECISIONS.md`.

### Verificación
- `npm run lint`: sin errores.
- `npm run typecheck`: sin errores de TypeScript.
- `npm test`: 47/47 pruebas unitarias pasando (13/13 suites).
- `npm run build`: compilación de producción exitosa; solo el aviso preexistente de tamaño de chunks de Rapier/Three.
- Pendiente de inspección visual en navegador: escala del sedán, orientación del personaje y ausencia de avisos de `mergeGeometries()`.

## Nueva estrategia de desarrollo inspirada en «Badajoz: El Juego» y «gamedev-skills» (completada)

### Hecho
- **Investigación profunda de *Badajoz: El Juego*:** Análisis de los factores de éxito del juego de Alfredo Narváez (Godot 4, integración de Catastro de España para 12.000 portales y alturas reales, OpenStreetMap, IGN MDT05, oficios locales pacenses como autobús urbano línea 18, camalote en el Guadiana y paquetería).
- **Creación de la carpeta estratégica canónica (`strategy/`):**
  - `strategy/NEW_STRATEGY.md`: Manifiesto con los 5 grandes pilares (abandono de la geometría procedural en código, cruce Catastro+OSM+IGN, desarrollo gameplay-first, HUD comercial limpio, y audio Web Audio con feedback háptico/cámara).
  - `strategy/GAMEPLAY_AND_MISSIONS.md`: Especificación de 4 oficios cacereños auténticos (Autobús Urbano Líneas 1 y 8, Repartidor en la Judería y Casco Antiguo, Guía Turístico por la Ciudad Monumental y Carreras urbanas en Cánovas/Ronda Norte), con economía en € y tipado declarativo TypeScript.
  - `strategy/ASSET_AND_DATA_PIPELINE.md`: Pipeline de assets 3D GLB optimizados (CC0/CC-BY de Kenney, Quaternius, Poly Haven y Blender), presupuestos técnicos de triángulos/texturas, y flujo de datos geográficos oficiales.
  - `strategy/README.md`: Índice general de la estrategia.
- **Actualización de `AGENTS.md` y `DECISIONS.md`:** Incorporadas directrices estratégicas de obligado cumplimiento para todos los agentes y desarrolladores del proyecto.

### Verificación
- Documentación técnica y estratégica revisada y enlazada.
- No se ha tocado código de producción conforme a la instrucción directa del usuario ("No toques código").

## Revisión y alineación global de fases 0 a 11 con AGENTS.md (completada)

### Hecho
- **Revisión integral de arquitectura por fases (0 a 11):**
  - **Fases 0 a 3:** Verificada la infraestructura de Vite, WebGL2, Worker de chunks y Rapier WASM. El dataset de 900 chunks y 41.527 elementos mantiene su integridad 100% verificada (`verify-world.mjs`).
  - **Fases 4 a 7:** Red viaria con 4.144 conexiones navegables, edificios zonificados con atlas PBR y catálogo de hitos monumentales con 17/17 tests passing.
  - **Fases 8 a 11:**
    - Erradicado el salto violento y despegue de vehículos: limitado el impulso vertical a ≤4,5 m/s y el cabeceo angular a ≤3,0 rad/s en `Vehicle.update`, y reinicializada la velocidad a 0 al requisar vehículos.
    - Preservado el color de carrocería en la carga del modelo GLB: el sedán transfiere el color del vehículo al material `paint`, eliminando el salto brusco a gris.
  - **Presentación comercial (Pilar 4):** El panel de diagnóstico técnico y los bordes de chunks se ocultan por defecto (`is-hidden`), mostrándose únicamente bajo `?debug=1` o pulsación de F3. El HUD muestra de forma limpia el minimapa de radar táctico y las indicaciones del juego.

### Verificación
- `npm run lint`: sin errores.
- `npm run typecheck`: sin errores de TypeScript.
- `npm test`: 47/47 pruebas unitarias pasando (13/13 suites).
- `npm run build`: compilación de producción exitosa en 5.3s.

## Sustitución de personaje y coche CC0 (completada)

### Hecho
- `tools/generate_cc0_assets.py` convierte el personaje FBX de Kenney a `public/models/characters/caceres-pedestrian.glb` (230 KB): textura embebida, escala de 1,88 m y clips `idle`/`walk`. Copia además el sedán CC0 de Kenney como `public/models/vehicles/caceres-sedan.glb` (172 KB).
- `src/main.ts` carga el mismo GLB para el jugador y para la multitud. El jugador reproduce las animaciones; los peatones instanciados hornean una pose de marcha en tiempo de carga.
- `src/world/vehicle.ts` descarta las ruedas estáticas del GLB, conserva las ruedas animadas de Rapier, escala la carrocería al colisionador existente y aplica el color del coche requisado al material `colormap`.
- Se eliminan `casual-walker.glb`, `casual-walker-lod1.glb` y `graphite-sedan.glb`. Licencias y URLs en `ATTRIBUTION.md` y `ASSETS_LICENSES.md`; decisiones en `DECISIONS.md`.
- La descarga de modelos baja de ~7,52 MB a ~0,40 MB. No se añaden dependencias ni se modifica `public/world`.

### Verificación
- `format:check` (con salto de fin de línea), `lint`, `typecheck`, `test` (53/53) y `build` pasan.
- Navegador con 6 chunks: peatón y sedán responden 200, cero errores de consola, 111 draw calls y 458.315 triángulos a pie; 143 draw calls y 530.025 triángulos dentro del coche. El sedán se reexportó con `colormap.png` embebida para eliminar la única petición externa detectada.
- Corregido el peatón invisible: el material del FBX llegaba con alfa 0 y el exportador glTF descartaba la escala del rig; el generador ahora fuerza material opaco y escala el nodo raíz del GLB a 0,5 eliminando la pista de escala que la animación restauraba.
- Mejorada la animación: Kenney sólo trae `idle`, `jump` y `run`, así que `soften_walk()` deriva un `walk` suave del `run` (35 % de amplitud, rotaciones interpoladas hacia la identidad y ×1,4 de duración → 0,96 s). El desplazamiento máximo de vértice baja de 2,07 m a 0,88 m y el ciclo deja de parecer una carrera.
- Render aislado del peatón con THREE en navegador: 21.971 píxeles no fondo, caja 163,159–476,488 en 640×640, coherente con 1,88 m a 4 m de cámara. Fotogramas de `idle`/`walk` capturados en `reports/anim-*.png` (fuera del repo) con cajas estables y cambios de postura visibles. El FPS de la prueba (2–3) no es representativo porque Chromium usa WebGL por software.

### Pendiente
- Revisar visualmente la orientación del peatón, la altura de la carrocería y que no haya ruedas duplicadas.
- Decidir si el tráfico ambiental y las patrullas adoptan también variantes GLB de Kenney sin perder el instanciado por color.

### Cómo probarlo
- `npm run dev` y abrir `http://localhost:5173/?debug=1`: caminar, correr y observar a los peatones; entrar en el coche con `E` y comprobar la carrocería, las ruedas y el color al requisar un vehículo ambiental.
- Regenerar los GLB con Blender 5.2 según el comando documentado en `ASSETS_LICENSES.md`.
