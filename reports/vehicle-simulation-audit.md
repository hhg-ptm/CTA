# Auditoría de conducción, simulación y tráfico

Rama: `agent/opencode-vehicles`. Base: `98e257cb1f321ec19608cb0a545154ae89df2697`
(`integration/multiagent-base`). Fecha: noviembre de 2026.

## 1. Hallazgos de la auditoría inicial

| Problema                     | Evidencia                                                           | Consecuencia                                                                             |
| ---------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Un `world.step()` por coche  | `Vehicle.update()` integraba el mundo Rapier                        | Coste CPU creciente con el número de coches y orden de integración dependiente del array |
| Dirección y frenado lineales | Ángulo y fuerza constantes                                          | Maniobras bruscas a baja velocidad y deriva incontrolable a alta velocidad               |
| Comparación O(n²) de NPCs    | `blockedAhead()` recorría todos los agentes activos                 | Coste creciente con la población de tráfico y peatones                                   |
| Sin glorietas                | El grafo no distingue ways cerrados de un solo sentido              | Cada segmento corto se trataba como una intersección nueva                               |
| Sin API para misiones        | `main.ts` manipulaba el array de vehículos y la cámara directamente | Imposible separar consultas de comandos ni controlar el spawn                            |

La red real `public/world/cc-monumental/road-network.json` contiene 41.253 nodos,
46.812 segmentos y 74.592 conexiones; `oneWay` se reparte en 34.619 / 12.189 / 4
para `0` / `1` / `-1`. Hay 58 ways cerrados, de los cuales 5 cumplen la
condición de sentido único. La detección no inventa etiquetas: solo usa la
topología ya descargada de OSM.

## 2. Cambios implementados

### Conducción (`src/world/vehicle.ts`)

- CCD en el chasis para no atravesar colisionadores con saltos de velocidad.
- Límite de dirección dependiente de la velocidad: 0,50 rad parado, 0,16 rad a
  24 m/s y por encima; suavizado con `deltaSeconds * 9`.
- Taper de aceleración con la velocidad y rear-slip al usar el freno de mano.
- `update()` aplica controles; `postPhysics()` sincroniza ruedas/visuales y
  devuelve si ha tenido que limitar un contacto.
- `teleport()` reinicia el direccionamiento suavizado al recolocar el coche.

### Simulación (`src/world/vehicle-simulation.ts`)

- Un único `world.step()` por fotograma para todos los chasis dinámicos.
- Métricas: `steps`, `simulatedVehicles`, `clampedContacts`, `lastStepMs`.
- `isStopped()` con histéresis de 0,35 m/s durante 0,25 s; un coche recién
  creado se considera detenido.
- Eventos `entered` / `exited` con snapshots, nunca con referencias vivas.
- `registerVehicleModel()` y `spawnServiceVehicle()` con permiso de integración.
  Sin descriptor GLB registrado, el spawn devuelve `null`: no se fabrica
  geometría procedural de autobús ni scooter.

### API (`src/world/vehicle-simulation-api.ts`, `docs/vehicle-simulation-api.md`)

- Consultas de solo lectura: `getControlledVehicle()`, `getVehicle(id)`,
  `listVehicles(filter)` y `subscribe(listener)`.
- Comandos: `enterVehicle(options)` y `exitVehicle(options)`.
- Sin `World`, `RigidBody`, `Object3D`, `InstancedMesh` ni slots internos.
- Contrato marcado como propuesto, pendiente de revisión de Gemini B.

### Grafo y tráfico (`src/world/road-graph.ts`, `src/world/npc-system.ts`)

- Un way es glorieta si es cerrado, de un solo sentido, tiene 4–40 segmentos y
  mide 20–400 m. Los segmentos resultantes se marcan `roundabout` y su
  velocidad objetivo baja a 5,5 m/s.
- La cesión en intersección se aplica al acceso, no a cada tramo del anillo;
  `roundaboutExits` contabiliza las salidas para calibración.
- Rejilla espacial de 12 m reconstruida por frame con pool de cubos; la
  distancia al frente usa solo las celdas vecinas, con límite lateral de 1,8 m
  para vehículos y 0,8 m para peatones.
- `followingBrakes` cuenta los frenados por distancia al coche precedente.

### Integración (`src/main.ts`)

- `KeyE` llama a los comandos de la API en vez de duplicar la lógica de
  entrada/salida.
- El bucle llama a `vehicleSimulation.step(...)`; ya no hay otros
  `world.step()` en `src/`.
- Debug expone `vehicleApi` y añade `vehicleSimulation` y `trafficEvents` al
  snapshot. No se amplía la API de gameplay con spawn ni con física.

## 3. Verificación

### Estática y unitaria

| Comando                                   | Resultado                                        |
| ----------------------------------------- | ------------------------------------------------ |
| `npx prettier --check --end-of-line auto` | OK                                               |
| `npm run lint`                            | OK                                               |
| `npm run typecheck`                       | OK                                               |
| `npm test`                                | 17 suites / 75 pruebas OK                        |
| `npm run build`                           | OK (bundles Rapier/Three sin cambios relevantes) |

El script `format:check` del repo no pasa `--end-of-line auto` y en Windows marca
los 114 archivos del checkout por CRLF; es un comportamiento previo y no se ha
modificado para no tocar la configuración ajena.

### Navegador real

- Servidor: `vite preview` en `127.0.0.1:4173`, URL
  `/?debug=1&world=cc-monumental`, build de producción.
- Carga correcta, título «Cáceres Criminal — prototipo» y cero errores de
  consola.
- `__CTA_DEBUG__.vehicleApi` disponible; `getControlledVehicle()` devuelve
  `null` antes de entrar y un snapshot `role: 'player'` después de `E`.
- `E` entró y salió del GT sin excepciones; `W` incrementó la velocidad de
  1,40 a 3,59 m/s durante la sesión.
- Métricas propias: `steps` 20 → 44, `simulatedVehicles` 1,
  `lastStepMs` 0,3–0,8 ms, `clampedContacts` 0, `followingBrakes` 16 → 106,
  `roundaboutExits` 0 en esta zona de prueba.
- Contadores globales: 161 draw calls, 2.333.431 triángulos y ~450 MiB de heap.
  El exceso de triángulos respecto al objetivo de 600.000 procede del city kit
  ajeno presente en el árbol de trabajo; este cambio no añade geometría ni
  reduce la de otros sistemas.

**Limitación:** Chromium ejecuta WebGL por software en este entorno (≈1 FPS),
por lo que los 8 pasos registrados en 8 s no permiten afirmar nada sobre la
sensación de conducción a 60 FPS. Los valores válidos son los del subsistema
(`lastStepMs`, contactos y eventos); el juicio de _game feel_ queda pendiente
de una prueba con GPU.

## 4. Riesgos y revisión posterior

- El contrato es propuesto: Gemini B debe confirmarlo antes de que misiones u
  oficios lo consuman.
- `spawnServiceVehicle` devuelve `null` para autobús y scooter hasta que se
  registren modelos GLB CC0 con licencia y atribución explícitas. Los modelos
  disponibles actualmente están documentados en `docs/vehicle-simulation-api.md#7-limitaciones-y-pendientes`.
- La detección de glorietas depende de que el way OSM esté cerrado y sea de un
  solo sentido; las glorietas de dos sentidos no se detectan intencionalmente
  para no inventar circulación.
- No se han tocado `src/gameplay/**`, `src/ui/jobs/**`, `src/ui/economy/**`,
  `src/world/building*.ts`, `public/world/**` ni el sistema de delitos.
