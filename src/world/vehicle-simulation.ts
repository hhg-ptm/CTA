import type { World } from '@dimforge/rapier3d-compat';
import { NEUTRAL_DRIVE_INPUT, Vehicle, type VehicleDriveInput } from './vehicle';
import {
  createVehicleSimulationApi,
  type VehicleCommands,
  type VehicleEvent,
  type VehicleKind,
  type VehiclePose,
  type VehicleRole,
  type VehicleSimulationApi,
} from './vehicle-simulation-api';

const STOPPED_SPEED = 0.35;
const STOPPED_HYSTERESIS_SECONDS = 0.25;
const DEFAULT_CAPACITY = 5;

export interface VehicleModelDescriptor {
  readonly id: string;
  readonly kind: VehicleKind;
  readonly role: 'traffic' | 'service';
  readonly modelUrl: string;
  readonly lod?: readonly { readonly minDistance: number; readonly modelUrl: string }[];
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

const SPAWN_PERMISSION = Symbol('vehicle-spawn');
export type VehicleSpawnPermission = typeof SPAWN_PERMISSION;

/** Granted only by the integration layer, never handed to gameplay systems. */
export function grantVehicleSpawnPermission(): VehicleSpawnPermission {
  return SPAWN_PERMISSION;
}

export interface VehicleSimulationMetrics {
  readonly steps: number;
  readonly simulatedVehicles: number;
  readonly clampedContacts: number;
  readonly lastStepMs: number;
}

interface MutableMetrics {
  steps: number;
  simulatedVehicles: number;
  clampedContacts: number;
  lastStepMs: number;
}

/**
 * Owns the single physics step for every dynamic vehicle. Keeping the step here
 * prevents one world.step() per car and makes CPU cost measurable per subsystem.
 */
export class VehicleSimulation {
  readonly vehicles: Vehicle[];
  private readonly world: World;
  private readonly stoppedSeconds = new WeakMap<Vehicle, number>();
  private readonly listeners = new Set<(event: VehicleEvent) => void>();
  private readonly descriptors = new Map<string, VehicleModelDescriptor>();
  private readonly metricsData: MutableMetrics = {
    steps: 0,
    simulatedVehicles: 0,
    clampedContacts: 0,
    lastStepMs: 0,
  };

  constructor(world: World, vehicles: Vehicle[]) {
    this.world = world;
    this.vehicles = vehicles;
  }

  get metrics(): VehicleSimulationMetrics {
    return { ...this.metricsData };
  }

  step(deltaSeconds: number, controlled: Vehicle | null, input: VehicleDriveInput | null): void {
    if (this.vehicles.length === 0) return;
    const started = performance.now();
    for (const vehicle of this.vehicles)
      vehicle.update(deltaSeconds, vehicle === controlled && input ? input : NEUTRAL_DRIVE_INPUT);

    // One integration step for chassis, terrain, buildings and kinematic agents.
    this.world.step();

    for (const vehicle of this.vehicles) {
      if (vehicle.postPhysics()) this.metricsData.clampedContacts += 1;
      const stopped =
        vehicle.speed < STOPPED_SPEED ? (this.stoppedSeconds.get(vehicle) ?? 0) + deltaSeconds : 0;
      this.stoppedSeconds.set(vehicle, stopped);
    }
    this.metricsData.steps += 1;
    this.metricsData.simulatedVehicles = this.vehicles.length;
    this.metricsData.lastStepMs = performance.now() - started;
  }

  isStopped(vehicle: Vehicle): boolean {
    if (vehicle.speed >= STOPPED_SPEED) return false;
    const elapsed = this.stoppedSeconds.get(vehicle);
    // A freshly spawned car is already parked; a moving car needs sustained low
    // speed before the API flips to stopped.
    return elapsed === undefined || elapsed >= STOPPED_HYSTERESIS_SECONDS;
  }

  poseOf(vehicle: Vehicle, role: VehicleRole): VehiclePose {
    const position = vehicle.position;
    const velocity = vehicle.chassisBody.linvel();
    const heading = vehicle.heading;
    const stopped = this.isStopped(vehicle);
    return {
      id: Math.max(0, this.vehicles.indexOf(vehicle)),
      kind: 'car',
      role,
      position: { x: position.x, y: position.y, z: position.z },
      heading,
      forward: { x: Math.sin(heading), z: Math.cos(heading) },
      speed: vehicle.speed,
      velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
      motion: stopped ? 'stopped' : 'moving',
      stopped,
      occupancy: role === 'player' ? 1 : 0,
      capacity: DEFAULT_CAPACITY,
    };
  }

  controlledPose(vehicle: Vehicle | null): VehiclePose | null {
    return vehicle ? this.poseOf(vehicle, 'player') : null;
  }

  listPoses(): readonly VehiclePose[] {
    return this.vehicles.map((vehicle, index) =>
      this.poseOf(vehicle, index === this.controlledIndex ? 'player' : 'traffic'),
    );
  }

  private controlledIndex = -1;

  setControlledIndex(index: number): void {
    this.controlledIndex = index;
  }

  subscribe(listener: (event: VehicleEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyEntered(vehicle: Vehicle): void {
    this.controlledIndex = this.vehicles.indexOf(vehicle);
    this.emit({ type: 'entered', vehicle: this.poseOf(vehicle, 'player') });
  }

  notifyExited(vehicle: Vehicle): void {
    this.emit({ type: 'exited', vehicle: this.poseOf(vehicle, 'traffic') });
    this.controlledIndex = -1;
  }

  /** Registers an GLB-only vehicle contract. No primitive geometry is created. */
  registerVehicleModel(descriptor: VehicleModelDescriptor): void {
    this.descriptors.set(descriptor.id, descriptor);
  }

  hasVehicleModel(id: string): boolean {
    return this.descriptors.has(id);
  }

  /**
   * Integration-only command. Gameplay receives createApi(...) instead and
   * therefore cannot reach this method or forge the permission symbol.
   */
  spawnServiceVehicle(
    permission: VehicleSpawnPermission,
    kind: 'bus' | 'scooter',
    pose: { readonly x: number; readonly y: number; readonly z: number; readonly heading: number },
  ): number | null {
    if (permission !== SPAWN_PERMISSION) throw new Error('Vehicle spawn permission required.');
    if (![pose.x, pose.y, pose.z, pose.heading].every(Number.isFinite)) return null;
    const descriptor = [...this.descriptors.values()].find((item) => item.kind === kind);
    if (!descriptor) return null;
    // Model loading is supplied by the integration layer; until a GLB-backed
    // descriptor is registered we refuse to fabricate procedural geometry.
    return null;
  }

  createApi(commands: VehicleCommands, controlled: () => Vehicle | null): VehicleSimulationApi {
    return createVehicleSimulationApi({
      queries: {
        getControlledVehicle: () => this.controlledPose(controlled()),
        getVehicle: (id) => {
          const vehicle = this.vehicles[id];
          return vehicle
            ? this.poseOf(vehicle, id === this.controlledIndex ? 'player' : 'traffic')
            : null;
        },
        listVehicles: (filter) => {
          const poses = this.listPoses();
          return filter
            ? poses.filter(
                (pose) =>
                  (filter.kind === undefined || pose.kind === filter.kind) &&
                  (filter.role === undefined || pose.role === filter.role),
              )
            : poses;
        },
        subscribe: (listener) => this.subscribe(listener),
      },
      commands,
    });
  }

  private emit(event: VehicleEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
