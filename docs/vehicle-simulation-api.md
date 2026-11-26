# Contrato técnico del subsistema de vehículos y simulación

> Estado: **propuesto**. Pendiente de revisión por Gemini B. Este contrato se
> documenta antes de cualquier integración con misiones. El sistema de misiones
> solo recibe `VehicleSimulationApi`; nunca recibe `VehicleSimulation`, Rapier ni
> objetos de Three.js.

## 1. Principios

1. **Separación estricta:** las consultas (`VehicleQueries`) son de solo lectura
   y devuelven snapshots planos. Los comandos (`VehicleCommands`) son las únicas
   operaciones que cambian el estado del juego.
2. **Sin acceso directo al motor:** no se exponen `RigidBody`, `World`,
   `THREE.Object3D`, `InstancedMesh` ni índices de slot internos.
3. **Vehículos nuevos por GLB:** todo modelo se registra mediante un descriptor
   con URL de GLB. No se ensamblan vehículos con primitivas en TypeScript.
4. **Spawn controlado:** `spawnServiceVehicle` no forma parte de la API pública.
   Requiere un permiso explícito del nivel de integración.

## 2. Consultas de solo lectura

```ts
export type VehicleKind = 'car' | 'bus' | 'scooter';
export type VehicleRole = 'player' | 'traffic' | 'service';
export type VehicleMotion = 'stopped' | 'moving';

export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export interface Vec3 extends Vec2 {
  readonly y: number;
}

export interface VehiclePose {
  readonly id: number;
  readonly kind: VehicleKind;
  readonly role: VehicleRole;
  readonly position: Vec3; // centro del chasis, metros
  readonly heading: number; // radianes sobre +Y; 0 = morro hacia +Z
  readonly forward: Vec2; // { x: sin(heading), z: cos(heading) }
  readonly speed: number; // m/s, no negativo
  readonly velocity: Vec3; // m/s, con signo
  readonly motion: VehicleMotion;
  readonly stopped: boolean; // < 0.35 m/s sostenido 0.25 s
  readonly occupancy: number;
  readonly capacity: number;
}

export interface VehicleQueries {
  getControlledVehicle(): VehiclePose | null;
  getVehicle(id: number): VehiclePose | null;
  listVehicles(filter?: {
    readonly kind?: VehicleKind;
    readonly role?: VehicleRole;
  }): readonly VehiclePose[];
  subscribe(listener: (event: VehicleEvent) => void): () => void;
}
```

### Convenciones

- `heading` coincide con el getter actual de `Vehicle`: giro alrededor de `+Y`,
  con el morro del GT apuntando a `+Z` cuando `heading = 0`.
- `position.y` es el centro del chasis. Para marcadores en el suelo, usar `x/z`
  y el contrato de altura del mundo; no RESTar una altura de rueda inventada.
- `stopped` usa histéresis para evitar parpadeos por oscilación de suspensión.
  Es el estado que debe consumir una misión de parada de autobús.
- `subscribe()` emite `entered`, `exited` y `stateChanged` con snapshots, nunca
  con referencias vivas.

## 3. Comandos de estado del jugador

```ts
export interface VehicleCommands {
  enterVehicle(options?: {
    readonly id?: number;
    readonly position?: Vec2;
    readonly maxDistance?: number;
  }): boolean;

  exitVehicle(options?: { readonly side?: 'left' | 'right' }): boolean;
}

export interface VehicleSimulationApi extends VehicleQueries, VehicleCommands {}
```

`enterVehicle` y `exitVehicle` son comandos permitidos para gameplay porque
representan acciones del jugador. El módulo de misiones debe llamarlos a través
de esta interfaz; no debe manipular el array de vehículos ni la cámara.

## 4. Spawn de vehículos de servicio (no público)

`spawnServiceVehicle` vive en `VehicleSimulation`, que solo posee la capa de
integración (`main.ts`). La API pública no lo expone. Además requiere un permiso
explícito:

```ts
export function grantVehicleSpawnPermission(): VehicleSpawnPermission;
spawnServiceVehicle(
  permission: VehicleSpawnPermission,
  kind: 'bus' | 'scooter',
  pose: { readonly x: number; readonly y: number; readonly z: number; readonly heading: number },
): number | null;
```

El permiso se concede solo en el arranque de la simulación. Un consumidor de
gameplay que reciba `VehicleSimulationApi` no puede invocarlo ni importarlo desde
la interfaz pública. Si no hay un descriptor GLB registrado para ese tipo, el
spawn devuelve `null` en lugar de crear geometría procedural.

## 5. Descriptor de modelos nuevos

```ts
export interface VehicleModelDescriptor {
  readonly id: string;
  readonly kind: VehicleKind;
  readonly role: 'traffic' | 'service';
  readonly modelUrl: string; // GLB obligatorio
  readonly lod?: readonly {
    readonly minDistance: number;
    readonly modelUrl: string;
  }[];
  readonly collider: {
    readonly halfWidth: number;
    readonly halfHeight: number;
    readonly halfLength: number;
    readonly massKg: number;
  };
  readonly wheels: readonly {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly radius: number;
  }[];
  readonly suspension: {
    readonly stiffness: number;
    readonly travel: number;
    readonly compression: number;
    readonly relaxation: number;
  };
  readonly limits: {
    readonly maxSpeedMps: number;
    readonly engineForce: number;
    readonly brakeForce: number;
    readonly steeringAngle: number;
  };
  readonly capacity: number;
  readonly audioProfile: 'car' | 'bus' | 'scooter';
}

export function registerVehicleModel(descriptor: VehicleModelDescriptor): void;
```

Los modelos actuales (`caceres-gt.glb`, `caceres-gt-traffic.glb`,
`caceres-gt-police.glb`) quedan como base y fallback. Los fallbacks procedurales
solo se conservan para el GT mientras se carga su GLB.

## 6. Métricas de la simulación

La capa de integración puede exponer, sin ampliar la API de gameplay:

- `steps`: pasos físicos ejecutados (debe ser uno por fotograma con coche activo).
- `simulatedVehicles`: coches dinámicos integrados en el paso.
- `clampedContacts`: contactos estabilizados por límites de velocidad.
- `lastStepMs`: coste CPU del paso de vehículos.
- `followingBrakes` y `roundaboutExits`: eventos de tráfico para calibración.

Estas métricas son del subsistema. No implican cambiar el objetivo global de
600.000 triángulos ni de 300 draw calls; Gemini A mantiene la medición global.
