# Decisiones técnicas

## 2026-11-22 - Base de fase 0
- Usar Vite, TypeScript estricto y Three.js para el esqueleto WebGL 2 solicitado.
- Mantener la UI de depuración en DOM/CSS, separada del canvas 3D.
- GitHub Pages publica `dist/` mediante Actions. Se usan URLs relativas para que los assets funcionen en el subdirectorio del repositorio.
- La escena de diagnóstico con cubo se retira al sustituirse por terreno real en la fase 3.
- ECS usa capacidad fija, SoA en arreglos tipados y handles con generación para evitar asignaciones por entidad en el bucle caliente.
- La simulación corre a 60 Hz, limita la recuperación a cinco pasos por fotograma y el render interpola el giro de diagnóstico.
- GLB se carga con MeshoptDecoder; KTX2 usa el transcodificador Basis servido desde el mismo sitio y se atribuye por separado.

## 2026-11-24 - Auditoría de la fase 0
- Prettier se añade como dependencia de desarrollo para mantener formato reproducible; no forma parte del bundle del juego.
- Vitest se actualiza a la versión 5 porque la versión bloqueada anterior tenía vulnerabilidades críticas en el entorno de pruebas; la instalación limpia queda sin avisos de auditoría.
- La validación de pull requests se separa del despliegue: CI comprueba formato, lint, tipos, pruebas y build al abrir o actualizar una PR; Pages conserva el despliegue desde `main`.
- Se conserva la arquitectura evolucionada (`src/engine`, `src/ui`, `src/world`) y el mundo actual; no se crean directorios vacíos del esqueleto inicial ni se restaura el cubo de diagnóstico. El README describe F4 como acceso normal al panel y F3 como acceso del modo `?debug=1`.
# Fase 6 - hitos y fidelidad (actualización)

- Los soportales de Plaza Mayor se aproximan con pilares y losa plana sobre el polígono OSM; las medidas (espaciado 4,5 m, altura 3,1 m) son fallback visual pendiente de foto.
- El campanario de la Concatedral (w385037723) es una torre de piedra 4,2×4,2 m y 16 m añadida sobre la huella OSM, sin altura fuente.
- La escalinata de San Francisco Javier se modela con 12 gradas de 0,18 m desde el edificio hacia Plaza de San Jorge.
- Torre de las Cigüeñas (n13723182454) es un punto OSM sin huella: se usa una torre sintética de 7,5 m y 24 m documentada como fallback visual. Se añade ancla de cigüeña sobre ella.

# Fase 7 - marcas ficticias (actualización)

- `tools/brand-blocklist.json` ampliado con cadenas reales presentes en el extracto (supermercados, bancos, hoteles, restaurantes, telefonía, mensajería, panadería) mapeadas a marcas ficticias existentes.
- Los edificios comerciales reciben nombre ficticio en `normalize-data.mjs` y lo exponen en `BuildingSignSlot.name`.
- Rótulos renderizados con CanvasTexture en `chunk-manager.ts` (\`createBrandSign\`), liberados al descargar el chunk.
- `verify-world.mjs` limita la comprobación de marcas a nombres comerciales (fictional/commercial) con límites de palabra.

# Fase 8 - personaje (actualización)

- Personaje low-poly procedural (cajas) sin assets externos; animación de caminata por rotación de extremidades.
- Movimiento WASD relativo a la orientación de cámara; ajuste a altura MDT05 vía chunks.groundHeightAt.
- Modo por defecto tercera persona; Tab alterna a cámara libre.

# Fase 9 - vehículos (actualización)

- Controlador Rapier DynamicRayCastVehicleController con 4 ruedas, suspensión y tracción trasera.
- Vehículo low-poly procedural (cajas) sin assets externos; entrada/salida con E.
- Cámara de persecución reutiliza CameraRig thirdPerson con foco en el vehículo.

# Fase 2 - datos geográficos

- La región inicial es un rectángulo proyectado de 1 km centrado en Plaza Mayor; EPSG:25829 permite medir chunks y huellas en metros.
- Overpass se usa solo durante la preparación de datos. La respuesta se conserva localmente bajo `data/raw/` (ignorada por git); el cliente del juego consume los chunks estáticos.
- El terreno requiere el MDT05 CNIG reproyectado a EPSG:25829 en formato ESRI ASCII Grid. El constructor falla cuando falta para impedir elevaciones inventadas.
- Se empaquetan chunks con cabecera `CTA2`, versión, tamaño sin comprimir y payload JSON deflate para facilitar una futura carga selectiva.
- Los nombres de negocios se reemplazan por identidades ficticias; nombres reales detectados se reportan por id OSM/categoría sin conservar el nombre original en el reporte.
- Overpass entregó el extracto para el bbox el 2026-11-22; el JSON se conserva en caché local ignorada por Git.
- El WCS oficial IGN/CNIG sirve `Elevacion25830_5` recortada y reproyectada a EPSG:25829 como ASCII Grid; se conserva su hash, tamaño de celda y fecha en metadatos locales.
- El proveedor WCS entrega `dx` y `dy` independientes sin siempre incluir `NODATA_value`; el lector admite ambos formatos y clampa al centro de celda en el borde para cubrir la malla solicitada sin huecos.

## 2026-11-24 - Auditoría reiniciada de fase 2
- Overpass y WCS usan una política común de reintentos con `Retry-After`, límite de intentos y espera incremental. La descarga WCS serializa las teselas y limita el tamaño de la respuesta.
- Los artefactos se reemplazan atómicamente solo si cambian. El manifiesto se escribe antes de retirar chunks antiguos; el verificador falla si encuentra archivos binarios sin referencia.
- Catastro INSPIRE BU se consulta solo durante `data:build`, en el núcleo de 1 km de Plaza Mayor. Cada tesela base mide hasta 250 m; las cajas rechazadas o que exceden el límite de respuesta se subdividen. El intervalo mínimo entre peticiones es 350 ms y el timeout conduce a subdivisión, con profundidad limitada.
- Las respuestas GML originales se cachean en `data/raw/catastro/` y permanecen fuera de Git. El parser extrae solo anillos exteriores, elimina cierres duplicados, proyecta a metros locales y descarta IDs antes de devolver las geometrías al constructor. El informe publica conteos y comparación aproximada de centroides a 10 m; no publica GML, geometrías Catastro, referencias ni nombres.
- El caché usa el origen local y el tamaño en el nombre de cada tesela para evitar colisiones entre extensiones. Las subdivisiones adaptativas se guardan como marcadores; reconstruir desde caché no vuelve a consultar los cuadros padre. El hash del manifest usa huellas transformadas ordenadas por su geometría, sin IDs de Catastro.
- El manifest también registra WFS, alcance, hash, licencia y atribución. Las huellas OSM siguen siendo las únicas que alimentan chunks del juego.
- La salida regenerada corrige el desfase con los filtros y el catálogo actuales. La región completa se conserva en 7,6 km para no romper el mundo existente; el contraste Catastro usa el núcleo de 1 km indicado por la guía.
- El inspector 2D se verificó visualmente con la geometría reconstruida y la superposición de comparación OSM.

# Fase 3 - terreno y streaming

- `@dimforge/rapier3d-compat` 0.12.0 se declara como dependencia de ejecución para crear heightfields; su licencia Apache-2.0 se revisó en los metadatos oficiales del paquete.
- El worker del navegador verifica la cabecera CTA2 y tamaño antes de descomprimir; también construye niveles de detalle de 2, 4 y 8 m, normales, colores de superficies OSM y skirts de 4 m.
- Se carga dentro de 512 m del centro de chunk y se conserva hasta 614 m (histéresis); heightfields Rapier solo se crean dentro de 192 m.
- El worker procesa descompresión y malla; el hilo principal anexa geometría con presupuesto aproximado de 5 ms por frame. El panel F4 muestra memoria de buffers de geometría estimada, chunks, colliders y pico de frame.
- El color base es hierba si no hay polígono superficial OSM en el punto. Esto es solo un valor visual; no cambia los datos de elevación ni la geometría.
- Rapier 0.12 espera el número de celdas por eje (`samples - 1`) y una matriz column-major de `samples * samples`; la prueba integrada crea un collider real para evitar que una incompatibilidad de dimensiones llegue al navegador.
- La validación automatizada de cinco minutos con el overlay F4 activo muestra frames de streaming de hasta 14,7 ms, cero intervalos >16 ms y buffers geométricos estimados de 6,9–16,5 MiB; la fase de inicialización previa al primer chunk se registra aparte.
- Los bordes de depuración F4 siguen la elevación muestreada de cada perímetro y se elevan 0,15 m sobre la malla; sus buffers cuentan en la estimación de memoria mientras el overlay está visible.

# Fase 4 - red viaria

- Se conserva un grafo derivado de way/node OSM: cada segmento guarda carriles, sentido vehicular, superficie, puente/túnel y si el tipo de vía es peatonal. La ruta a pie trata ambos sentidos como transitables (salvo autopistas) y no cambia las restricciones de dirección del grafo para futura IA de vehículos.
- Ancho de calzada: `width=*` en metros si existe; después `lanes * 3,1 m`; por último una tabla de defaults por `highway`. Los defaults y el ancho inferido son aproximaciones visuales y no se escriben de vuelta a OSM.
- Para vías urbanas anchas sin `sidewalk=*`, se muestran aceras inferidas a ambos lados; las etiquetas explícitas `sidewalk`, `sidewalk:left/right` mandan. Estas aceras solo representan geometría y no se consideran atributos cartográficos confirmados.
- Las calzadas, bordillos y aceras siguen la altura bilineal MDT05 y se levantan 5,5 cm, 9 cm adicionales para acera y 3,5 cm para bordillo para evitar z-fighting. Las curvas usan fillets con desviación limitada a 0,3 m.
- OSM no aporta una altura de tablero fiable en estos puentes; la vista usa un perfil de rampa con elevación máxima 1,8 m y pendiente máxima aproximada 12 %. Los túneles conservan la cota del terreno más 7 cm para mantener continuidad peatonal; la excavación, bóveda y perforación de heightfields quedan pendientes de una fase de volumen de terreno.
- Señales y semáforos se instancian por kind y chunk. Las colisiones de vía usan malla triangular por chunk y solo se activan a menos de 192 m; las cotas elevadas de puente se incluyen en esa malla.
- Los mapas repetibles de asfalto, piedra, hormigón y tierra se generan desde Canvas en tiempo de ejecución; no se descargan texturas externas. El desgaste de vértice usa una semilla espacial estable para evitar costuras entre los segmentos de cada vía.
- La ruta peatonal de referencia se calcula con los hitos OSM Plaza Mayor (`w62237623`), Arco de la Estrella (`n419385562`) y Plaza de San Jorge (`w35883265`). El inspector presenta las conexiones y distancias de ajuste para comparar con el mapa fuente.
- Las conexiones topológicas cubren giros por nodos compartidos; la descarga actual no consulta relaciones OSM `type=restriction`, de modo que las restricciones de giro señalizadas no están aún modeladas.

# Fase 5 - edificios

- Solo 13 de las 2.847 huellas fuente tienen `building:levels` explícito y ninguna aporta `height=*`; los valores visuales usan `height=*` → `building:levels × 3 m` → default registrado por zona/tipo. Se conserva la distinción entre dato fuente y valor representado.
- La zona de fachada se infiere por tipo monumental/etiqueta historic y por distancia a Plaza Mayor: casco hasta 220 m, ensanche hasta 500 m y periferia fuera. Es una heurística visual; los 36 edificios fuera del límite de chunks quedan en el inventario de fuente, no en el mundo jugable.
- Los techos sin `roof:shape` usan huella alargada → gabled y cercana a cuadrada → hipped; `roof:height` y `roof:colour` prevalecen cuando están presentes. Los mapas modulares de casco/ensanche/periferia, teja y cubierta moderna se generan desde Canvas, sin descargar assets externos.
- Se construyen tres LOD por chunk/material, y los colliders de edificios son mallas perimetrales simplificadas que solo se activan cerca del jugador. Los rótulos todavía no se dibujan: el chunk expone un slot de fachada comercial para la fase 7.
- Las ventanas guardan una semilla estable por id y exponen `BuildingRenderer.setNight()` para su integración con el sistema de hora de fase 15. No hay ciclo día/noche en esta fase.
- `public/landmarks/<id>.glb` es una entrada local opcional; no se descargaron modelos. El data build acepta solo ids de way OSM, GLB 2.0 de máximo 50 MiB, estructura y malla acotadas, sin URIs externos, con texturas PNG/JPEG embebidas limitadas; al cargar se usa la caché local del AssetManager.
- QA automatizado de fase 5: 16 chunks, 75 FPS, 85 draw calls, 303.477 triángulos, 15,6 ms máximo de streaming, cero frames >16 ms y 23,9–70,8 MiB de buffers de geometría estimados.

# Fase 6 - hitos y fidelidad

## Hitos y fidelidad

- La colisión peatonal consulta la altura de las caras triangulares renderizadas de calzada, bordillo y acera, además de la altura MDT05. Se usa un índice espacial por chunk para mantener acotada la consulta; el desnivel visual del pavimento deja de hacer que el jugador se hunda bajo la calle.
- Las fachadas conservan la huella OSM también en LOD lejano y las cubiertas mantienen la forma inferida, en vez de sustituir toda planta por la caja de su bounding box.
- Los vehículos y peatones siguen siendo mallas procedurales originales de bajo poligonaje, ahora con cristales separados, detalles de rueda/carrocería y siluetas humanas con prendas diferenciadas. No se incorporan assets ni contenido de GTA/Rockstar.
- El asfalto usa un valor más oscuro que piedra, hormigón y acera para separar visualmente la calzada de los espacios peatonales sin inventar marcas viales.

- El inventario usa los nombres orientativos de la guía del proyecto y separa los objetivos de `cc-monumental` de los que requieren una futura región de ciudad. Los nombres se comparan exactamente después de normalizar mayúsculas, espacios y tildes; no se aplican coincidencias difusas.
- Un objetivo no encontrado se informa como ausente del extracto OSM de la región, no como inexistente. Los objetivos de ciudad se muestran fuera de alcance mientras se procesa `cc-monumental`.
- La consulta OSM incluye `place=square` en nodos y vías para que plazas como Plaza Mayor puedan formar parte del inventario. Los nombres de monumentos y plazas son datos geográficos permitidos; las reglas de sustitución comercial siguen aplicándose a negocios.
- Los museos etiquetados `tourism=museum` se tratan como hitos públicos cuando OSM no declara `brand` ni `operator`; una marca u operador explícito conserva el saneamiento comercial.
- Las relaciones OSM históricas se conservan como POIs con prefijo `r` y centro calculado desde la geometría de sus miembros exteriores. Esa posición sirve para inventario y referencia; no sustituye ni crea huellas de edificio.
- La auditoría consulta nombres de vías, edificios no comerciales, superficies y POIs. Para fachadas, solo se conservan nombres de edificios no comerciales; los nombres de locales continúan sometidos al brand scrubber. Los alias del catálogo se añaden solo cuando el nombre alternativo está confirmado en el extracto OSM.
- No se derivan posiciones, huellas, dimensiones ni modelos de hitos a partir del nombre solamente. Los modelos detallados siguen necesitando geometría OSM o un GLB local validado y atribuido.
- Para la silueta visual, el Arco de la Estrella se centra en el POI OSM y se orienta perpendicular a la vía más cercana dentro de 24 m. El vano (8,6 m de ancho; 8,9 m de altura aproximada), profundidad y dovelas son parámetros artísticos, no medidas fuente; si no hay vía cercana, se omite.
- Las vías/polígonos OSM con `place=square` se conservan como superficies nombradas además de POIs, y colorean el terreno como piedra. La huella proviene de OSM; el material es una clasificación visual.
- Las vías OSM `barrier=city_wall` se conservan como geometría de muro monumental. La altura de 3,8 m, el grosor de 1,1 m y las almenas son fallbacks visuales porque el tramo fuente consultado no declara cotas; el trazado procede únicamente de la línea OSM.
- El informe de hitos distingue huellas, polígonos, trazados, vías, puntos y centros de relación. Un POI puntual sin huella cercana identificable (como la Torre de las Cigüeñas en este extracto) no se extruye como edificio para evitar ubicar una masa inventada.
- La página oficial del CEFOT 1 y la ficha municipal describen la Torre de las Cigüeñas como alta, cuadrada, con cuerpo superior saliente sobre ménsulas y merlones. El punto OSM nombrado para el museo cae dentro del perímetro multipolígono OSM del Palacio de las Cigüeñas y fuera de su patio; se usa como ancla del volumen, mientras que la relación del palacio solo aporta contexto. La torre procedural de 6 m de lado tiene cuerpo de 15,5 m, remate superior de 4,2 m y almenas visuales; no hay altura fuente y requiere revisión fotográfica.
- El catálogo `data/landmarks/landmarks.json` deriva las posiciones y huellas de geometrías OSM originales. Altura OSM explícita, conversión de plantas y altura visual se guardan en campos distintos; no se promociona un fallback artístico a dato fuente.
- `npm run fidelity` proyecta way geometries OSM y geometría serializada de chunks a EPSG:25829, compara IDs, tipo, número de vértices y error por vértice, con límite de 1 m. Se excluyen solo vías/huellas cuyo bounding box no intersecta ningún chunk jugable.
- El estado humano se guarda aparte en `data/landmarks/status.json`; el generador solo inicializa en pendiente y conserva aprobaciones existentes, y nunca aprueba una ficha.
- Para la extensión urbana, el área se amplía a un recorte cuadrado de 7,6 km por lado alrededor del mismo origen EPSG:25829, manteniendo los chunks de 256 m. La tesela MDT05 WCS se solicita con un chunk adicional de margen por lado y se mosaica solo cuando las teselas comparten dimensiones, origen alineado, resolución y nodata; si no, el proceso se detiene para evitar huecos o desplazamientos.
- Fase 10: los agentes usan el grafo derivado de OSM sin inventar calles; los vehículos respetan `oneWay`, carriles y `maxSpeedKph` con límites urbanos, y los peatones usan solo segmentos `walkable` en ambos sentidos. El destino de cada agente se elige a 80–520 m para acotar A* y evitar picos de frame.
- No se añaden dependencias: los modelos procedurales se fusionan con `mergeGeometries` de los addons de Three.js ya presentes, y la población se dibuja con dos `InstancedMesh`. Los colores son variaciones por semilla, sin assets ni marcas externas.
- El extracto no incluye semáforos ni señales de stop en el grafo; se documenta como limitación en `reports/audit-npcs.md` y se sustituye por prioridad de llegada con cesión temporal en intersecciones. No se promociona esta heurística a dato geográfico.
- La red viaria (≈30 MB) se carga de forma diferida tras la primera escena visible para no comprometer el objetivo de carga inicial; la densidad de agentes escala con `quality.populationDensity` (150/60 en calidad alta).
- Fase 11: el nivel de búsqueda es calor continuo de 0 a 5 y las estrellas son solo su representación en el HUD. Pesos: robo 2, atropello 3, conducción temeraria 1; con enfriamiento por tipo (8/4/6 s) para no sumar estrellas cada fotograma.
- La detención exige 2 s consecutivos a menos de 7 m de una patrulla y con velocidad menor de 2,5 m/s; al detener se reinicia el calor y se reaparece en Plaza Mayor, sin cárcel ni transición (fuera del alcance de la fase).
- Las patrullas usan el mismo grafo viario que el tráfico ambiental, con A* re-ruteado cada 1,5 s y prioridad por llegada en intersecciones. No se inventan semáforos ni calles; la ausencia de señales ya está documentada en `reports/audit-npcs.md`.
- Los coches policiales son geometría procedural original con colores azul/blanco ficticios y una barra de luces simple; no se usan libreas, marcas ni modelos de juegos existentes.
- Se introduce `src/i18n.ts` como costura mínima: los textos nuevos (HUD, avisos, controles) se resuelven por clave. Los textos heredados de fases anteriores se migrarán cuando se aborde la fase de HUD completa.
- El perímetro cerrado OSM `w389025250`, llamado «Ciudad de la Salud y la Innovación» y etiquetado `amenity=hospital`, se usa como límite del complejo sanitario. Contiene el POI Hospital de Día y el POI mal escrito «Hospital Universiario de Cáceres»; este último sigue clasificado como parada de taxi y no se usa como hospital.
- El Ministerio de Sanidad confirma que el Hospital Universitario de Cáceres está en Avenida de la Universidad 75; la página del Área de Salud ofrece un mapa basado en OpenStreetMap. El recinto del complejo es referencia geográfica, no huella de un edificio individual; los edificios OSM internos conservan sus propias huellas.
- La etiqueta fuente OSM `roof:shape=many` se conserva en el chunk; el verificador la acepta y el render usa el fallback geométrico por huella, ya que el constructor no tiene una cubierta procedural para ese perfil.
- Las torres sin `height=*` ni `building:levels` reciben un fallback visual de 7 plantas (21 m); el dato fuente permanece ausente. Se añaden almenas low-poly a partir de los bordes de la huella, también como detalle aproximado. No se añade esta geometría cuando el edificio usa un GLB local validado.
- Las cigüeñas ambientales se colocan únicamente en tejados con huella de edificio y altura visual conocida: todas las torres clasificadas y una selección estable por ID de edificios del casco. El modelo low-poly despega al entrar el jugador en 28 m y vuelve a posarse cuando se aleja; no se inventa una huella para la Torre de las Cigüeñas, cuyo OSM actual es solo un punto.
- Los soportales del Ayuntamiento se anclan al lado de su huella OSM más cercano al centro de la superficie OSM de Plaza Mayor. Sus arcos low-poly usan pilares de 2,55 m, separación basada en 3,1 m, 0,3 m de profundidad y radios visuales; no son cotas fuente y permanecen pendientes de comparación fotográfica. La portada apuntada low-poly de la Concatedral se ubica en el lado de la huella OSM más cercano a Plaza Mayor; ancho, altura y posición precisa son aproximaciones visuales. La torre occidental documentada se añade en el extremo oeste de la huella, con tres cuerpos (5,6/5,4/5,0 m de base, 3,5/3,5/4,2 m de alto) y cuatro flameros low-poly; su posición y proporciones requieren comparación fotográfica. Para San Francisco Javier se sitúan dos torres cuadradas en el lado de su huella más cercano a Plaza San Jorge, con cuerpos de 7,5 m, chapiteles piramidales de 1,5 m y ancho de 1,55 m; son valores visuales y no se infiere una huella independiente. La escalinata de San Jorge se obtiene de las vías `highway=steps` ya renderizadas, no de una segunda geometría aproximada.
- Corrección de agentes: los `InstancedMesh` llevan un atributo `color` blanco y `vertexColors: true` para que `instanceColor` se multiplique de forma fiable en todas las versiones de Three.js; además se marca `instanceColor.needsUpdate` en cada actualización con agentes visibles. No cambia el número de draw calls.
- Las colisiones de agentes usan cuerpos cinemáticos de Rapier en un adaptador (`agent-colliders.ts`) para no acoplar los sistemas de tráfico a la física. El jugador a pie, que es scriptado, se resuelve por empuje circular; el coche del jugador sí usa contactos Rapier.
- Se descubrió que `DynamicRayCastVehicleController.updateVehicle()` solo modifica velocidades: `Vehicle.update()` llama a `world.step()` para integrar y resolver contactos. Sin ese paso los coches ambientales y las patrullas eran puramente visuales para la física.
- La acera deja de compartir el material `stone` de la calzada del casco antiguo: se añade el estilo `sidewalk` (losa clara), se oscurece el asfalto y se mantiene `concrete` para el bordillo. Es una decisión visual sin añadir datos geográficos ni assets externos.

# Integración del PR #4 - herramientas de auditoría (post Fase 11)

- El PR #4 nace de un commit anterior a las fases 10/11 y tocaba HUD, estilos y documentación. El conflicto se resuelve conservando `main` como base y superponiendo solo las herramientas nuevas; así no se pierden los agentes, el sistema policial ni las correcciones de colisiones y aceras.
- `?debug=1` activa un modo de depuración independiente: F3 panel, F4 bordes de chunk, F5 colisionadores, F6 calzadas, F7 límites de LOD, F8 sombras, F9 aviso y ` consola. Sin el parámetro, F4 sigue alternando a la vez panel y bordes como en versiones anteriores.
- Los overlays se generan en `debug-overlays.ts` a partir de geometría ya existente (heightfield, colisionadores de vía y edificio, huella de LOD). No introducen dibujos ni sistemas nuevos cuando el modo de depuración está apagado.
- El código del PR referenciaba `minHeight`/`maxHeight` en `BuiltTerrainChunk`; el tipo real expone `minimumHeight`/`maximumHeight`. Se corrigió esa incompatibilidad al integrar, en lugar de ampliar el tipo con alias.
- El catálogo de hitos se publica copiando `data/landmarks/landmarks.json` a `public/data/landmarks/landmarks.json` (231 KB) para que Vite lo sirva también en GitHub Pages. No se modifica `public/world`: sus hashes están registrados en el manifiesto.
- `tests/e2e/debug-audit.spec.ts` pertenece a Playwright (`npm run audit`) y se excluye de Vitest en `vite.config.ts`. El navegador del tour es Chromium estándar, no `msedge`, para que la auditoría pueda ejecutarse en CI.
- `agentsByLod` cuenta agentes ambientales cercanos, intermedios y lejanos; no incluye patrullas. La población total de peatones y coches se muestra aparte en `agents`.
- No se añaden dependencias: Playwright ya figuraba en `devDependencies` y los overlays usan Three.js.

# LOD de simulación de agentes (post integración del PR #4)

## Ajustes visuales y de movimiento (noviembre de 2026)

- La colisión peatonal consulta la altura de las caras triangulares renderizadas de calzada, bordillo y acera, además de la altura MDT05. Se usa un índice espacial por chunk para mantener acotada la consulta; el desnivel visual del pavimento deja de hacer que el jugador se hunda bajo la calle.
- Las fachadas conservan la huella OSM también en LOD lejano y las cubiertas mantienen la forma inferida, en vez de sustituir toda planta por la caja de su bounding box. El LOD lejano puede tener un par de triángulos más que el intermedio (que usa cubierta plana); ambos siguen estando muy por debajo del LOD detallado, así que la prueba compara contra ese nivel en vez de exigir orden estricto entre los dos simplificados.
- `paneGeometry()` genera también el atributo `uv`: sin él, `mergeGeometries()` descartaba todas las piezas del coche instanciado y caía en la cápsula de reserva. Los peatones usan colores por vértice (piel, ropa, calzado) y no se tiñen por instancia; solo los vehículos conservan `instanceColor`.
- Los vehículos y peatones siguen siendo mallas procedurales originales de bajo poligonaje, ahora con cristales separados, detalles de rueda/carrocería y siluetas humanas con prendas diferenciadas. No se incorporan assets ni contenido de GTA/Rockstar.
- El asfalto usa un valor más oscuro que piedra, hormigón y acera para separar visualmente la calzada de los espacios peatonales sin inventar marcas viales.

- El quinto commit del fork (`251c794`) proponía un LOD por distancia, pero estaba escrito contra un `NpcSystem` sin los colisionadores de la fase 11. Se adapta la idea al sistema actual en lugar de aplicar el parche tal cual.
- Umbrales: 90 m para el nivel cercano, 210 m para el intermedio y el resto como lejano. Cadencias de actualización 1/2/4 frames respectivamente; los tres niveles siguen dibujándose y conservando su colisionador cinemático, así que el mundo no cambia de aspecto ni de physicalidad con la distancia.
- El tiempo de simulación se acumula por agente y se reparte entre frames (`slot % cadence`) para no concentrar el trabajo en un solo fotograma. Cada paso se limita a 0,05 s para que un agente lejano no salte una arista corta; el coste es que avanza más despacio fuera del nivel cercano. `lodCounts` expone los tres recuentos al HUD de depuración; antes se mostraba un `0 / 0 / 0` fijo porque no existía el planificador.
- El despawn usa distancia al cuadrado y se comprueba solo cada 0,25 s, igual que el spawn, para reducir raíces cuadradas en el bucle caliente. Sin fuentes geográficas ni assets nuevos.

# Pasada visual de era PS2 (integración del PR #9)

- Se integra el trabajo de `delgadomin` del PR #9 mediante el PR #10: el original estaba en draft, tenía un conflicto en `npc-models.ts` contra el arreglo de `uv` del PR #8 y la rama del fork no se puede actualizar desde esta cuenta. El PR #10 conserva la autoría original y añade solo las correcciones.
- `seededSequence()` genera los moteados del estuco. El PR #9 trataba `random` (un número devuelto por `seeded()`) como función, lo que rompía `typecheck` y `build`; la nueva secuencia mantiene la apariencia determinista sin llamadas aleatorias por fotograma.
- `createSedanBodyGeometry()` y `createWheelArchGeometry()` generan `uv`. Sin ese atributo, `mergeGeometries()` volvía a descartar el coche instanciado y caía en la malla de reserva.
- Las siluetas, prendas, ventanas arqueadas, contraventanas y detalles de coches siguen siendo geometría procedural original; no se añaden assets con copyright ni se modifica `public/world`.

# Pasada de pulido de gráficos, atmósfera y comportamiento de NPCs (noviembre de 2026)

- Iluminación y sombras direccionales: la luz solar (`sun`) activa sombras suaves PCF con caja ortográfica centrada en el jugador, desplazándose en cada fotograma para proyectar sombras nítidas sobre el terreno y las calles sin exceder el presupuesto de rendimiento.
- Cúpula celeste y niebla: gradiente atmosférico cálido (horizonte ibérico dorado en transición a azul cenital) y niebla suavizada que empieza a 0.5× la distancia de visión para evitar el corte gris plano previo.
- Materiales diferenciados: peatones con material textil mate (roughness 0.88, metalness 0.02) y vehículos con acabado automotriz pulido (roughness 0.28-0.32, metalness 0.48-0.55) con reflejos en carrocería y cristales.
- Variedad y comportamiento de NPCs: paleta ampliada a 20 tonos de ropa/piel y 14 de vehículos; escalas humanas variadas (0.88-1.12); interpolación angular de giros (`turnRate`) y rampa suave de aceleración/frenado para erradicar movimientos robóticos; balanceo y ligera inclinación hacia adelante al caminar/correr.
- Sensación de velocidad y cámara: interpolación suave de seguimiento con lerp en la cámara y apertura dinámica del FOV en vehículos según la velocidad punta. Postura de carrera en el personaje con inclinación de torso y braceo natural.

## Corrección de robo de vehículo y física de entrada (noviembre de 2026)

- Al subirse a un vehículo ambiental (`E`), el coche robado hereda la orientación angular (`heading`) del vehículo ambiental en la calle y su color procedural exacto. Anteriormente se creaba con `heading = 0` y color rojo por defecto, lo que hacía que el coche apareciera atravesado en la calle (a menudo penetrando edificios o bordillos) y cambiara de color.
- Cota de spawn físico: el chasis dinámico se sitúa a `y + 0.82` (en lugar de `y + 0.60`). A `0.60` los muelles de la suspensión (longitud de reposo 0.30 m + radio 0.35 m + conexión 0.20 m = 0.85 m) se comprimían 25 cm contra el suelo en el primer frame, liberando una fuerza de restitución que lanzaba el coche catapultado hacia arriba. A `0.82` el vehículo apoya suavemente en equilibrio.
- Matriz de instancia fantasma: al requisar o liberar un agente en `NpcSystem.release()`, su matriz en el `InstancedMesh` se colapsa a escala cero bajo el suelo (`y = -9999`) de inmediato. Esto evita que la geometría ambiental anterior quede congelada en el mismo sitio que el nuevo vehículo manejable solapándose visualmente.
- Salida de vehículo segura: al bajarse con `E`, el jugador calcula el vector lateral a partir de la orientación del vehículo y comprueba colisión con edificios (`collidesWithBuilding`) antes de elegir el lado izquierdo o derecho, evitando quedar atrapado dentro de una pared.

# Gran renovación visual, modelos 3D y ambientación atmosférica (noviembre de 2026)

## 1. Texturizado procedural y relieve de superficies
- **Micro-relieve de terreno:** Se incorpora un mapa de detalle procedural de 512×512 píxeles (`createTerrainDetailTexture()`) con ruido multifrecuencia, motas de grava, esquirlas de cuarzo y partículas minerales de tierra. Se generan coordenadas UV planares en `ChunkManager.geometryForLod()` (repetición cada 10 m), modulando los colores de vértice del terreno para erradicar la apariencia plana y artificial de 1995.
- **Pavimentos y calzadas (256×256):** Texturas procedurales enriquecidas con adoquines de granito con biseles de cincelado y llagas de mortero para calles del casco histórico (`stone`), losas de granito serradas con relieve para aceras (`sidewalk`), y asfalto granular con áridos para vías de ensanche y periferia.
- **Tejas curvas y sillería monumental:** Textura de tejados con sombreado cilíndrico tridimensional emulando la curvatura y solapes de las tejas árabes tradicionales de Cáceres; sillería de granito con hiladas regulares, juntas de mortero rehundidas y destellos minerales. Ventanas con reflejo oblicuo de cielo y repisas de granito biseladas.

## 2. Vegetación orgánica y mobiliario urbano histórico
- **Árboles mediterráneos:** Sustitución de los conos de 8 segmentos por mallas compuestas (`createTreeTrunkGeometry` y `createTreeFoliageGeometry`) fusionadas con `BufferGeometryUtils.mergeGeometries`: troncos ramificados con corteza leñosa y copas multirracimo de cinco volúmenes dodecaédricos orgánicos inspirados en encinas y pinos piñoneros ibéricos.
- **Farolas fernandinas de forja:** Sustitución de los cilindros simples por farolas históricas con base octogonal, fuste estriado, collar de capitel, jaula de linterna de cuatro caras y remate cónico, con emisión suave y proyección de sombras suaves en el suelo.

## 3. Renovación de vehículos y personajes
- **Pinturas automotrices realistas:** Sustitución del generador de colores HSL estridentes por una paleta curada de acabados de automoción (Blanco Nácar, Negro Profundo, Gris Grafito, Plata Metalizada, Azul Medianoche, Rojo Burdeos, Verde Bosque, Arena Ibérica, etc.).
- **Detallado vehicular 3D:** Llantas de aleación plateadas de 5 radios con discos de freno oscuros, ópticas de xenón delanteras (`emissive: 0xfffae8`, intensidad 1.2), pilotos traseros rojo rubí (`emissiveIntensity: 1.0`), tubos de escape dobles cromados en la zaga y matrículas delantera y trasera formato español/europeo con banda azul de la UE.
- **Patrullas policiales:** Librea lateral con franjas verde/azul inspirada en la Policía Local y Guardia Civil, puente de luces aerodinámico con estroboscopios azul/rojo y bocina central.
- **Diseño del protagonista:** Gafas de sol oscuras de acetato polarizado, cremallera metálica plateada con tirador dorado en la chaqueta, cinturón de cuero con hebilla dorada, reloj de pulsera en la muñeca izquierda y zapatillas urbanas con entresuela blanca y suela de caucho.
- **Peatones:** Paleta de prendas europeas sobrias, gafas de sol, bandoleras y bolsos cruzados de cuero, y zapatillas con suela blanca contrastada.

## 4. Iluminación cinematográfica, sol dorado y cúpula celeste
- **Ángulo solar de hora dorada:** Orientación de la luz solar a ~33° de elevación (`dx = -320, dy = 240, dz = 220`), generando sombras diagonales largas y estilizadas que realzan el relieve arquitectónico de torres, palacios y arcos.
- **Sol radiante y halo en el cielo:** Incorporación de un disco solar luminoso y corona cálida translúcida en la cúpula celeste que se desplazan sincronizados con el jugador.
- **Cúpula celeste ibérica:** Gradiente tricromático cálido con tono melocotón/ámbar en el horizonte, transición a azul celeste y cenit zafiro profundo, sincronizado con niebla atmosférica (`#c8d7df`) y exposición fílmica ACES a 1.14.
- **Ajustes de sombras:** Reducción de la distancia de cámara de sombras (`near: 50, far: 850`) y calibración de `normalBias = 0.035` para erradicar el *shadow acne* y maximizar la precisión de profundidad.

# Integración de estándares gamedev-skills (audio procedural, minimapa y game feel)

Siguiendo las metodologías y directrices del repositorio `gamedev-skills` (`sound-brief`, `design-system`, `game-arch` y `smoke-test`):

## 1. Arquitectura de audio procedural Web Audio API (`src/engine/audio-system.ts`)
- **Jerarquía de buses sin assets externos:** Para respetar la regla de no incorporar ficheros con copyright ni sobrecargar la red, todo el sonido se sintetiza en tiempo real mediante la Web Audio API estándar:
  - **Motor de vehículo:** Oscilador en diente de sierra modulado dinámicamente con filtro pasobajo. El tono sube de 42 Hz (ralentí) hasta 200 Hz según la velocidad y aceleración, con volumen continuo.
  - **Derrapes y frenadas:** Generador de ruido blanco procedural filtrado en paso banda (~850 Hz) que se activa suavemente al frenar con espacio o girar bruscamente a velocidad.
  - **Claxon europeo:** Oscilador bitonal armónico (420 Hz + 525 Hz) accionado con la tecla `H`.
  - **Sirena policial:** Oscilador sinusoidal modulado por un LFO a 1.1 Hz (barrido de 420 Hz a 780 Hz), cuyo volumen se atenúa proporcionalmente a la distancia de la patrulla más cercana al jugador.
  - **Pisadas:** Ráfagas cortas de ruido filtrado sincronizadas con el medio ciclo de zancada (`stepTriggered`) del personaje al caminar y correr.
  - **Impactos:** Golpe con caída exponencial de tono (140 Hz a 32 Hz) y crujido de baja frecuencia en choques y atropellos.
  - **Alertas y detención:** Arpegio ascendente al subir estrellas de calor y fanfarria descendente al ser detenido.
  - **Muteo accesible:** Tecla `M` conmuta el volumen maestro con aviso en pantalla. Desbloqueo automático tras primer clic/tecla.

## 2. Minimapa de radar táctico (`src/ui/minimap.ts`)
- Radar circular estilo mundo abierto en esquina inferior izquierda, renderizado sobre canvas 2D con rotación solidaria a la orientación de cámara y aguja indicadora de Norte ("N").
- Marcadores de posición (blips): flecha direccional del jugador, puntos ámbar para tráfico circundante, y estroboscopios parpadeantes azul/rojo para vehículos policiales en persecución.
- Borde dinámico con animación pulsante de persecución activa durante niveles de búsqueda.

## 3. Jugabilidad y respuesta cinemática de cámara (Trauma / Shake)
- Se incorpora el modelo matemático de trauma cuadrático en `CameraRig.addTrauma()`: en impactos de tráfico o atropellos, la cámara experimenta una sacudida proporcional amortiguada en 3 ejes, dotando a la conducción de peso y fisicidad.

- Las celdas de terreno conservan las alturas MDT originales y el mismo presupuesto de triángulos; la diagonal se elige según la menor diferencia vertical para reducir el error de interpolación local.

# Integración de los PR #11 y #14 - modelos CC0 locales (noviembre de 2026)

- El PR #14 resultó ser un superset del PR #11 y partía de una base antigua. Se integra resolviendo el merge sobre `main` para conservar las correcciones de `uv`, colisión, LOD, audio, minimapa y cámara ya aceptadas. El PR #11 se cierra como supersedido acreditando a `delgadomin`.
- Se incorporan tres GLB CC0 servidos desde `public/models/`: «Casual Walker» de Tevy (LOD0 para el jugador, LOD1 para la multitud) y «Graphite four-door sedan» de Innerscene para los vehículos manejables. Licencias y URLs en `ATTRIBUTION.md`. No se usa contenido de GTA/Rockstar ni se modifican los hashes de `public/world`.
- El jugador sustituye su malla procedural cuando termina de cargar el GLB y reproduce las animaciones `idle`/`walk` del asset; el disparo de pisadas sigue ligado a `stepTriggered`. La geometría original se oculta, no se elimina, para servir de fallback ante un fallo de carga.
- La multitud usa una pose `walk` horneada del LOD1 en un único `InstancedMesh`. Se descarta el teñido por instancia del PR porque coloreaba por igual piel y ropa; los coches ambientales y las patrullas siguen siendo geometría original instanciada.
- El sedán CC0 se agrupa por material al cargarlo para limitar las llamadas de dibujo. El chasis, el colisionador y la cota de spawn (`y + 0.82`) siguen siendo los de `main`; el modelo no altera la física.
- La cúpula procedural del PR #11 (`atmosphere.ts`) se descarta: `main` ya aporta gradiente ibérico, disco solar y corona con exposición ACES 1.14. Dos cielos simultáneos duplicarían dibujo y romperían la paleta actual.
- Coste: ~7,52 MB de GLB con texturas embebidas, cargados de forma diferida tras `prepareRenderer()`; dentro del objetivo de <25 MB de carga inicial y sin URIs externos en tiempo de ejecución.

# Adopción de la estrategia inspirada en «Badajoz: El Juego» y «gamedev-skills» (noviembre de 2026)

- Tras el análisis del videojuego extremeño «Badajoz: El Juego» (desarrollado por Alfredo Narváez con Godot 4, Catastro, OSM e IGN) y la integración de patrones de «gamedev-skills», se establece un cambio de paradigma para agilizar el desarrollo y elevar drásticamente la calidad visual y jugable:
  1. **Abandono de la construcción procedural geométrica en código:** Dejar de ensamblar coches, monumentos y mobiliario mediante primitivas (`BoxGeometry`, `CylinderGeometry`) en TypeScript. Se autoriza y prioriza la importación de modelos GLB optimizados (CC0/CC-BY de Kenney, Quaternius, Poly Haven y Blender) cargados mediante `AssetManager`.
  2. **Pipeline de datos abiertos oficiales (Catastro + OSM + IGN):** Cruzar OpenStreetMap con las capas vectoriales abiertas del Catastro de España para extraer alturas reales, nombres de vías y números de portal exactos, habilitando interacción residencial e inmobiliaria.
  3. **Desarrollo Gameplay-First con sabor cacereño:** En lugar de sobrecargar el motor con cinemáticas o sistemas complejos, se diseña un bucle de oficios locales (Autobús Urbano Líneas 1 y 8, Repartidor en la Judería, Guía Turístico patrimonial y Carreras urbanas) con economía en euros (€).
  4. **Presentación comercial:** Ocultar el panel de depuración F3 por defecto (activable solo con `?debug=1` o tecla F3), manteniendo en pantalla un HUD limpio con radar circular táctico, velocímetro y notificaciones.
- La estrategia al completo queda documentada de forma canónica en la carpeta `strategy/` (`NEW_STRATEGY.md`, `GAMEPLAY_AND_MISSIONS.md`, `ASSET_AND_DATA_PIPELINE.md` y `README.md`) y referenciada en `AGENTS.md`.

# Revisión y alineación global de fases 0 a 11 con AGENTS.md (noviembre de 2026)

- Se revisa exhaustivamente el estado de todas las fases (0 a 11) para certificar su cumplimiento con `AGENTS.md` y `strategy/`:
  - **Fases 0 a 3 (Base, motor, datos y terreno):** Verificados 900 chunks y 41.527 elementos sin inconsistencias. 60 FPS estables con bucle de paso fijo.
  - **Fases 4 a 7 (Viales, edificios e hitos):** 17/17 tests en verde. Geometría PBR y catálogo de hitos preservados.
  - **Fases 8 a 11 (Personaje, vehículos, tráfico y policía):**
    - Corregida la inestabilidad física del vehículo: se limita la velocidad vertical a ≤4,5 m/s y la velocidad angular a ≤3,0 rad/s para evitar que el chasis salga despedido al penetrar bordillos o uniones trimesh.
    - Preservación de color al cargar el modelo GLB: el vehículo reclamado/robado transfiere su color original al material de pintura (`paint`) del sedán GLB en `createMergedVehicleVisual`, erradicando el cambio brusco de color a gris al subir.
  - **Presentación comercial (HUD):** El panel de depuración F3 y los bordes de chunk se inicializan ocultos (`is-hidden`) por defecto, reservándose exclusivamente al parámetro `?debug=1` o a la tecla F3, ofreciendo un aspecto de juego comercial limpio con el minimapa táctico de radar activo.

# City kit GLB procedural (noviembre de 2026)

- Se genera un kit propio de 14 GLB (farola, árbol, semáforo, señal de stop, señal de cedaz, chimenea y balcón; LOD0/LOD1 de cada uno) con `tools/generate_citykit.py` ejecutado en Blender 5.2 headless. Toda la geometría y los materiales son originales y se publican como CC0-1.0; no hay descargas, texturas nilicencias de terceros.
- No se añaden dependencias npm: los GLB son pequeños (~159 KB en total) y no usan texturas, así que no necesitan `gltf-transform`, meshopt ni KTX2. `AssetManager` ya soporta GLB y el pipeline existente loader se reutiliza sin cambios.
- El kit está activo por defecto porque las pruebas de navegador confirmaron que no supera los presupuestos; `?citykit=0` restaura el mobiliario procedural de `RoadRenderer` para comparar. Con el kit activo, `CityKit` sustituye esas instancias por GLB y añade chimeneas en `roofAnchors` y balcones en `signSlots`. Todas las posiciones vienen de OSM ya procesado: no se inventa geografía.
- Si falla cualquiera de los 14 GLB, `CityKit.isReady` queda a `false` y se conserva el mobiliario procedural como fallback; no se rompe el arranque.
- Las geometrías GLB se marcan con `userData.sharedGeometry` para que `ChunkManager.unload()` no las destruya al descargar un chunk y puedan reutilizarse en otros. El LOD del kit se elige al crear cada chunk; el cambio de LOD dentro de un chunk ya cargado no reconstruye el mobiliario (mejora pendiente).
- La sustitución de los modelos CC0 de persona y coche queda para la siguiente tanda; el usuario eligió «mixto» (procedural para edificios/props, CC0 con atribución para personajes/coches) y «sustituir los actuales».
- Comparativa en navegador con cámara fija en Plaza Mayor y 5 chunks cargados en ambos casos: baseline 75 draw calls / 547.149 triángulos, kit 111 draw calls / 503.728 triángulos. Los 14 GLB responden HTTP 200 y no hay errores de consola. El incremento de llamadas viene de los materiales separados de cada GLB; sigue muy por debajo del límite de 300. El FPS de la prueba (1–2) no es representativo porque Chromium ejecuta WebGL por software en este entorno.
- El workflow de Pages ejecuta `format:check` antes de publicar. El único archivo del city kit que no seguía el estilo de Prettier era `src/world/city-kit.ts`; se formatea sin cambiar comportamiento. En Windows, `core.autocrlf=true` hace que `prettier --check` local marque los archivos con CRLF, pero los blobs de Git y el checkout de Actions usan LF, así que la comprobación relevante es la de CI.

# Sustitución de personaje y coche CC0 (noviembre de 2026)

- Se retiran los GLB de Tevy «Casual Walker» (1,79 MB + 0,67 MB) e Innerscene «Graphite sedan» (5,06 MB) y se sustituyen por dos derivados CC0 de Kenney: `caceres-pedestrian.glb` (230 KB) y `caceres-sedan.glb` (172 KB). La carga inicial de modelos baja de ~7,52 MB a ~0,40 MB, sin nuevas dependencias npm.
- El peatón se genera desde los FBX de Kenney con Blender 5.2 y `tools/generate_cc0_assets.py`: escala 0,5 para 1,88 m, textura `skaterMaleA` embebida y solo los clips `idle`/`walk`. Kenney no publica `walk.fbx`, así que el generador deriva la marcha del ciclo `run`: reduce las traslaciones de pose al 35 %, interpola las rotaciones hacia la identidad con `slerp` y estira los tiempos ×1,4 (0,96 s por ciclo). Un único archivo alimenta al jugador animado y a la multitud; `createDetailedPedestrianGeometry()` hornea la pose de marcha y sirve como LOD1 sin descargar un segundo GLB.
- Corrección tras el despliegue: el FBX de Kenney traía `Alpha=0` y mezcla `HASHED`, que glTF exportó como `baseColorFactor` con alfa 0 y hacía el personaje invisible; el generador fuerza `Alpha=1` y material opaco. Además, el exportador glTF ignoraba la escala del objeto armature y una pista de animación del nodo raíz restauraba la escala 1 en el primer frame; el generador parchea el GLB para escalar el nodo raíz a 0,5 y elimina solo esa pista de escala. La altura validada con `THREE.SkinnedMesh.computeBoundingBox()` es 1,882 m en reposo y durante `idle`/`walk`.
- El sedán de Kenney mide 1,5 × 1,15 × 2,55 m en glTF; se escala a 1,2 × 1,0 × 1,6 para ajustarse al chasis de 1,8 × 4,1 m y no se rota porque su eje largo ya es Z, igual que el controlador Rapier. Se descartan las cuatro ruedas del GLB para conservar las ruedas procedurales que giran y se elevan con la suspensión. El GLB original referenciaba `Textures/colormap.png`; el generador lo reexporta embebido para no depender de peticiones externas en tiempo de juego.
- El material `colormap` se clona y se tiñe con el color del vehículo requisado, manteniendo la variación de color del PR #11 sin añadir texturas ni materiales nuevos. La malla se agrupa por material para conservar pocas llamadas de dibujo.
- Las licencias y URLs se registran antes del código en `ASSETS_LICENSES.md` y `ATTRIBUTION.md`. No se toca `public/world`, no se descarga nada en tiempo de ejecución y se mantienen los fallbacks procedurales si un GLB no carga.

# Diferenciación arquitectónica de edificios y ampliación del City Kit GLB en Blender 5.2 (noviembre de 2026)

- **Problema identificado:** Los edificios de casco, ensanche y periferia compartían una única plantilla de ventana arqueada y tonos ocres similares, con un único panel repetido por planta, ausencia de aleros/petos y una presencia mínima del kit 3D (limitado a `roofAnchors` y `signSlots`).
- **Arquetipos derivados de OSM (`src/world/building-styles.ts`):** Sin inventar huellas ni alturas, cada edificio se clasifica en 12 arquetipos (`casco_palace`, `casco_lime`, `casco_ochre`, `casco_terracotta`, `ensanche_brick`, `ensanche_stucco`, `ensanche_cream`, `ensanche_modern`, `periferia_chalet`, `periferia_block`, `periferia_industrial`, `periferia_civic`) usando `zone`, `building`, `historic`, `commercial`, `name` y hash estable de ID OSM. Los unifamiliares/chalets (`house`, `terrace`, `detached`) y templos recuperan cubierta de teja con alero saliente (+0,34 m), mientras bloques modernos, oficinas y naves industriales reciben peto perimetral elevado (+0,50 m).
- **Atlas de fachadas 8×8 (`src/world/building-materials.ts`):** Se amplían los tres atlas (`casco_facade`, `ensanche_facade`, `periferia_facade`) a 1024×1024 (4 bandas arquitectónicas × planta baja/alta × 8 variaciones de vano y medianera ciega, más mapa emisivo sincronizado), sustituyendo las ventanas arqueadas genéricas de ensanche/periferia por ladrillo caravista con cajas de persiana, muro cortina y chapa acanalada con portones y lucernarios industriales.
- **Ampliación de `tools/generate_citykit.py` (44 GLB en Blender 5.2):** Todos los modelos del kit pasan a compartir un único material con atlas procedural embebido (`kit_atlas` 256×256 PNG escrito y empaquetado explícitamente para evitar empaquetado negro de buffers en memoria en Blender headless) y 1 única primitiva por GLB, manteniendo `InstancedMesh` a 1 llamada de dibujo por tipo y chunk. Se incorporan 17 módulos de fachada y cubierta con LOD0/LOD1: balcones histórico y moderno, ventanas de casco/ensanche/moderna, portadas de dovelas y portales residenciales, escaparates con toldo, portones industriales, sillares esquinales, buhardillas, casetas de ascensor, climatizadores HVAC, espadañas, matacanes de torres y escudos nobiliarios.
- **Detección de medianeras y LOD dinámico (`src/world/building-details.ts`, `city-kit.ts`, `chunk-manager.ts`):** Los tramos contiguos a otro edificio (<1,45 m) se marcan como medianeras ciegas (sin ventanas ni balcones solapados) y solo los tramos exteriores orientados a calle reciben portales, escaparates y vanos rítmicos. El `ChunkManager` separa detalles en `LOD0` (<230 m) y `LOD1` (<422 m) mediante `setLod()` sin reconstrucción al vuelo; `CityKit` comparte la instancia de material/textura `kit_atlas` entre los 44 GLB.
- **Medición en navegador (SwiftShader, `?debug=1`):** Con 14–15 chunks cargados, Plaza Mayor pasa a 112 draw calls / 375.151 triángulos / 90,0 MiB (frente a 128 / 345.766 / 109,7 MiB anteriores), Santa María 113 / 390.212 y Avenida de España/Cánovas 106 / 272.003, todos muy por debajo de los topes de 300 draw calls y 600.000 triángulos con cero errores de consola.
- **Cáceres GT (modelo jugable):** Se sustituye el sedán CC0 de Kenney por un cupé original construido en Blender 5.2; `build_car.py` genera la fuente editable y `export_car_glb.py` aplica LOD, fusiona la carrocería en 16 primitivas y agrupa cada rueda en un nodo centrado en su eje. El GLB resultante pesa 758.492 bytes y contiene 5 nodos / 20 materiales. `vehicle.ts` reutiliza los pivotes Rapier para steer/roll/suspensión y fondea el GLB con `mergeVehicleVisual(source, -0.42)`.
- El primer GLB incluía `KHR_materials_transmission` en el cristal, lo que obligaba a Three.js a renderizar toda la escena dos veces (504 draw calls / 846.818 triángulos en el coche visible). El exportador elimina el peso de transmisión y el cargador lo fuerza a cero como salvaguarda; con el GLB optimizado la escena con el coche queda en 178 draw calls / 505.275 triángulos, dentro del presupuesto.
- El coche inicial se crea antes de que el streaming publique la altura del chunk de `(8,8)`; `Vehicle.teleport()` recoloca el chasis en cuanto `groundHeightAt(8,8)` deja de ser `undefined`, evitando que caiga fuera del mundo. Si falla el GLB, `loadModel()` mantiene el coche procedural como fallback y avisa por consola.

# LOD instanciado del Cáceres GT para tráfico y policía (noviembre de 2026)

- `export_car_traffic_glb.py` deriva de la misma fuente Blender dos GLB de 1 nodo: `caceres-gt-traffic.glb` (98.460 bytes, 1.691 triángulos, 3 primitivas) y `caceres-gt-police.glb` (107.368 bytes, 1.775 triángulos, 6 primitivas con barra y franjas originales). La pintura base es neutra, no hay transmisión ni alpha y las ruedas quedan horneadas en la carrocería: cada GLB se convierte en un solo `InstancedMesh` con colores por vértice y teñido por instancia, sin añadir llamadas de dibujo.
- `createDetailedVehicleGeometry()` hornea las transformaciones y los colores de material, convierte las primitivas a geometría no indexada y aplica escala 0,85 para conservar el ancho de calzada de los agentes anteriores (1,98 × 4,06 m frente a 1,90 × 4,10 m). `setVehicleModel()` sustituye la geometría procedural en `NpcSystem` y `PoliceSystem`; si un GLB falla, se mantiene la malla procedural y se registra un aviso.
- Verificación en navegador con build fresco (`localhost:4182/?debug=1`): los tres GLB de vehículos responden `200`, no hay errores ni avisos de consola y las métricas fueron 166 draw calls. El LOD reduce el coste por instancia de 2.874 a 1.691 triángulos en tráfico y de 2.990 a 1.775 en patrullas (ahorro aproximado de 77.000 triángulos con 60 coches y 5 patrullas).
- El contador global marcó 1.182.172 triángulos, por encima del objetivo de 600.000, pero ese exceso procede del city kit ajeno presente en el árbol de trabajo (72 GLB / 6.508 triángulos de kit frente a 44 / 3.100 en `HEAD`) y del peatón instanciado, no de este cambio: los vehículos reducen el total. El test `phase1-specs` también falla por el desajuste entre el manifest del city kit ajeno y sus GLB regenerados; no se modifica ese trabajo.

# Conducción y ruedas del Cáceres GT (noviembre de 2026)

- Rapier aplica la fuerza de motor positiva sobre el eje local `-Z`, pero la carrocería del GT tiene el morro en `+Z`. `Vehicle.update()` invierte el signo (`W` → `-4000`, `S` → `+2000`) para que el coche avance por el morro. El giro no se toca: el ángulo positivo sigue girando hacia la izquierda de la marcha, por lo que `A`/`D` ya eran correctos.
- `wheelHardPoint()` devuelve coordenadas world-space; restar solo la traslación del grupo dejaba las ruedas desplazadas en cuanto el chasis giraba. Se guardan los puntos duros locales (`±0,75`, `-0,2`, `±1,3`) y cada rueda se coloca en `hardpoint.y - suspensionLength`, independiente de la rotación. Los pivotes pasan a orden `YXZ` para que la dirección no se mezcle con la rodadura.
- `CameraRig.setYaw()` alinea la cámara detrás del rumbo al montar (`heading + π`); sin esto, la cámara del peatón podía quedar delante del morro y hacer que los controles parecieran invertidos.
- Verificación: sonda con el `Vehicle` real (`W` → `+2,57 m` en Z, ruedas fijas en sus puntos locales con el chasis girado 90°) y navegador con build fresco (`E` monta, cámara a `-π` con rumbo ~0, `W` lleva de `z=9,24` a `z=18,03`), sin errores de consola. `lint` y `typecheck` siguen fallando solo por los archivos del city kit ajeno.

# Reconstrucción 3D Blender de 900 Chunks, Sombras Proxy y Auditoría Visual (feat/caceres-3d-reconstruction)

- **Biblioteca arquitectónica Blender bajo atlas compartido de 2 materiales:** Se abandona la extrusión procedural genérica como única fuente geométrica en favor de 8 modelos héroe (`01_casco_house` a `08_civic_equipment`) + 4 variantes anti-repetición (`07b_midrise_gabled`, `07c_midrise_attic`, `02b_modern_setback`, `05b_lowrise_village`) en Blender 5.2, todos horneados sobre exactamente los mismos 2 materiales compartidos (`CC_Atlas_Opaque`, `CC_Atlas_Glass`) con LOD0/LOD1/LOD2 en [`public/models/buildings/`](public/models/buildings/manifest.json).
- **Adaptación geográfica fiel sobre 900 chunks en staging (`cc-blender-staging`):** [`src/world/blender-geo-adapter.ts`](src/world/blender-geo-adapter.ts) adapta `19.080` módulos sobre `7.147 / 7.250` edificios únicos con muestreo de terreno de 9 puntos (`0` flotantes), recorte explícito de patios (`0` invasiones en `innerRings`), guardado antisolape, tintado determinista por 11 distritos, índice espacial de huellas de 16 m en `ChunkManager` (`cpuActorMs` 18 ms -> `0,1 ms`) y exclusión de `08_civic_equipment` en parcelas industriales.
- **Sombras y perfil por defecto:** El perfil `proxy` pasa a configuración recomendada manteniendo `balanced` y `wide` como alternativas y proxies LOD2 para sombras medias/lejanas sin recortar geometría visible en primer plano; la memoria geométrica GPU en Casco pasa de `437–457 MiB` en `cc-monumental` a `34–38 MiB`.
- **Respaldo GitHub e higiene:** Todo código, tests, documentación (`reports/caceres-final-visual-audit.md`, `reports/caceres-3d-reconstruction-recovery.md`), scripts Blender y GLBs (`7,90 MiB`) se versionan en `feat/caceres-3d-reconstruction` dejando `main` y [`public/world/cc-monumental/`](public/world/cc-monumental/manifest.json) intactos y manteniendo `data/raw/`, `data/staging/`, `cc-blender-staging/`, renders PNG y `*.blend1` en `.gitignore`.
- **Cierre pre-promoción (`sampleHillsideGroundFit`, `BatchedMesh` LOD2 y costuras de chunk):** En `src/world/blender-geo-adapter.ts` se ajusta la cota en ladera al zócalo de cada edificio sin alterar `[x, z]` (`0` flotantes, `0` tejados enterrados), se agrupan subpartes por `slotGroup` + contención mutua (`-44,0 %` `same-base`, `0` duplicados poligonales), se registra `handledBuildingIds` en fronteras internas (`|cx|,|cz| < 3840`) erradicando mallas procedurales residuales y se flexibiliza la escala vertical sana (`0,42..1,48`, `MAX_HEIGHT_STRETCH = 2,15`, `-72,8 %` discrepancias `2.116 -> 576`). En `blender-building-renderer.ts` y `chunk-manager.ts`, la fusión estática de `ShadowProxy` (`SHADOW_PROXY_LAYER = 1`), `THREE.BatchedMesh` para LOD2, la poda de sombras en vidrio y `MeshStandardMaterial` en LOD1/LOD2 llevan `wc-casco-panoramico-proxy` de `877` a `340` draw calls (`60/60 FPS` sostenidos) y elevan `CPU 4×` de `10` a `24 rAF FPS`.

# Simulación de vehículos, tráfico y acceso desde gameplay (noviembre de 2026)

- `VehicleSimulation` es el único dueño de `world.step()`: `Vehicle.update()` solo aplica controles y `Vehicle.postPhysics()` sincroniza los visuales y limita los contactos. Antes cada `Vehicle.update()` integraba el mundo, de modo que N coches producían N pasos Rapier por fotograma.
- La dirección se limita por velocidad (0,50 rad parado → 0,16 rad a 24 m/s) y se suaviza con `deltaSeconds * 9`; la aceleración se atenúa al aumentar la velocidad y el freno de mano añade deslizamiento trasero. El chasis usa CCD para evitar atravesar colisionadores a alta velocidad.
- El contrato público es `VehicleSimulationApi` (`docs/vehicle-simulation-api.md`): snapshots planos e inmutables, comandos `enterVehicle`/`exitVehicle` y ninguna referencia a Rapier, Three.js ni slots internos. Está marcado como **propuesto** y pendiente de revisión de Gemini B.
- `spawnServiceVehicle` no pertenece a la API de gameplay. Vive en la capa de integración y exige el símbolo `SPAWN_PERMISSION`; sin un descriptor GLB registrado devuelve `null` en vez de ensamblar un autobús o scooter con primitivas.
- `VehiclePose.stopped` usa histéresis (0,35 m/s durante 0,25 s) para que una misión de parada no parpadee con la oscilación de la suspensión.
- Las glorietas se detectan solo a partir de la topología OSM ya descargada: way cerrado de un solo sentido, 4–40 segmentos y 20–400 m. No se inventa una etiqueta ni una geometría nueva. Su velocidad de tráfico baja a 5,5 m/s y la cesión en intersección se aplica al acceso, no a cada segmento corto del anillo.
- Las consultas de proximidad de `NpcSystem` usan una rejilla uniforme de 12 m reconstruida por frame con reutilización de cubos, en lugar de comparar cada agente con todos los activos. El seguimiento calcula distancia longitudinal, con frenado proporcional al hueco; las métricas `followingBrakes` y `roundaboutExits` sirven para calibrar, no como dato geográfico.
- `main.ts` solo integra el contrato: `KeyE` delega en los comandos de la API y el modo debug expone snapshots y métricas. No se amplió la API con spawn ni con acceso al mundo físico.
- El coste propio medido en navegador fue 0,3–0,8 ms por paso con 1 chasis dinámico y 0 contactos estabilizados. Los 161 draw calls y ~2,33 M triángulos del contador global corresponden al árbol de trabajo ajeno (city kit), no a este subsistema; no se reduce geometría de otros agentes.
- No se añaden dependencias ni assets nuevos; no se modifica `public/world`, los sistemas de gameplay, la UI de oficios ni el sistema de delitos.
