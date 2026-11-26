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

/** Immutable snapshot. No Three.js or Rapier object ever crosses this boundary. */
export interface VehiclePose {
  readonly id: number;
  readonly kind: VehicleKind;
  readonly role: VehicleRole;
  readonly position: Vec3;
  readonly heading: number;
  readonly forward: Vec2;
  readonly speed: number;
  readonly velocity: Vec3;
  readonly motion: VehicleMotion;
  readonly stopped: boolean;
  readonly occupancy: number;
  readonly capacity: number;
}

export type VehicleEvent =
  | { readonly type: 'entered'; readonly vehicle: VehiclePose }
  | { readonly type: 'exited'; readonly vehicle: VehiclePose }
  | { readonly type: 'stateChanged'; readonly vehicle: VehiclePose };

/** Read-only surface for gameplay systems such as missions. */
export interface VehicleQueries {
  getControlledVehicle(): VehiclePose | null;
  getVehicle(id: number): VehiclePose | null;
  listVehicles(filter?: {
    readonly kind?: VehicleKind;
    readonly role?: VehicleRole;
  }): readonly VehiclePose[];
  subscribe(listener: (event: VehicleEvent) => void): () => void;
}

/** State-changing commands that represent explicit player actions. */
export interface VehicleCommands {
  enterVehicle(options?: {
    readonly id?: number;
    readonly position?: Vec2;
    readonly maxDistance?: number;
  }): boolean;

  exitVehicle(options?: { readonly side?: 'left' | 'right' }): boolean;
}

export interface VehicleSimulationApi extends VehicleQueries, VehicleCommands {}

export interface VehicleSimulationApiSources {
  readonly queries: VehicleQueries;
  readonly commands: VehicleCommands;
}

/** The only object handed to gameplay. It intentionally has no spawn method. */
export function createVehicleSimulationApi(
  sources: VehicleSimulationApiSources,
): VehicleSimulationApi {
  return {
    getControlledVehicle: () => sources.queries.getControlledVehicle(),
    getVehicle: (id) => sources.queries.getVehicle(id),
    listVehicles: (filter) => sources.queries.listVehicles(filter),
    subscribe: (listener) => sources.queries.subscribe(listener),
    enterVehicle: (options) => sources.commands.enterVehicle(options),
    exitVehicle: (options) => sources.commands.exitVehicle(options),
  };
}
