import type { World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RoadGraph } from '../src/world/road-graph';
import { NEUTRAL_DRIVE_INPUT, steeringLimitForSpeed, type Vehicle } from '../src/world/vehicle';
import {
  createVehicleSimulationApi,
  type VehicleCommands,
  type VehiclePose,
} from '../src/world/vehicle-simulation-api';
import {
  grantVehicleSpawnPermission,
  VehicleSimulation,
  type VehicleModelDescriptor,
} from '../src/world/vehicle-simulation';
import { buildRoadNetwork } from '../tools/road-network.mjs';

function pose(id: number): VehiclePose {
  return {
    id,
    kind: 'car',
    role: 'player',
    position: { x: 0, y: 0, z: 0 },
    heading: 0,
    forward: { x: 0, z: 1 },
    speed: 0,
    velocity: { x: 0, y: 0, z: 0 },
    motion: 'stopped',
    stopped: true,
    occupancy: 1,
    capacity: 5,
  };
}

describe('vehicle drive model', () => {
  it('narrows steering as speed rises and never inverts the input', () => {
    expect(steeringLimitForSpeed(0)).toBeCloseTo(0.5);
    expect(steeringLimitForSpeed(12)).toBeLessThan(0.5);
    expect(steeringLimitForSpeed(12)).toBeGreaterThan(0.16);
    expect(steeringLimitForSpeed(24)).toBeCloseTo(0.16);
    expect(steeringLimitForSpeed(80)).toBeCloseTo(0.16);
    expect(steeringLimitForSpeed(-5)).toBeCloseTo(0.5);
    expect(NEUTRAL_DRIVE_INPUT.forward).toBe(false);
  });

  it('exposes only snapshots and player commands to gameplay', () => {
    const events: string[] = [];
    const api = createVehicleSimulationApi({
      queries: {
        getControlledVehicle: () => pose(1),
        getVehicle: (id) => (id === 1 ? pose(id) : null),
        listVehicles: () => [pose(1)],
        subscribe: (listener) => {
          listener({ type: 'entered', vehicle: pose(1) });
          return () => events.push('unsubscribed');
        },
      },
      commands: {
        enterVehicle: () => true,
        exitVehicle: () => true,
      } satisfies VehicleCommands,
    });

    expect(api).not.toHaveProperty('spawnServiceVehicle');
    expect(api.getControlledVehicle()?.stopped).toBe(true);
    expect(api.getVehicle(2)).toBeNull();
    expect(api.listVehicles()).toHaveLength(1);
    expect(api.enterVehicle()).toBe(true);
    expect(api.exitVehicle()).toBe(true);
    const unsubscribe = api.subscribe((event) => events.push(event.type));
    expect(events).toEqual(['entered']);
    unsubscribe();
    expect(events).toEqual(['entered', 'unsubscribed']);
  });

  it('requires an integration permission before accepting a service spawn', () => {
    const simulation = new VehicleSimulation({} as unknown as World, []);
    const spawnPose = { x: 0, y: 0, z: 0, heading: 0 };
    expect(() =>
      simulation.spawnServiceVehicle(Symbol('forged') as never, 'bus', spawnPose),
    ).toThrow('Vehicle spawn permission required.');
    expect(
      simulation.spawnServiceVehicle(grantVehicleSpawnPermission(), 'bus', spawnPose),
    ).toBeNull();

    const descriptor: VehicleModelDescriptor = {
      id: 'caceres-bus',
      kind: 'bus',
      role: 'service',
      modelUrl: 'models/vehicles/caceres-bus.glb',
      collider: { halfWidth: 1.2, halfHeight: 1.6, halfLength: 5, massKg: 9000 },
      wheels: [{ x: 1, y: 0, z: 1, radius: 0.5 }],
      suspension: { stiffness: 30, travel: 0.3, compression: 4, relaxation: 2 },
      limits: { maxSpeedMps: 16, engineForce: 4000, brakeForce: 60, steeringAngle: 0.35 },
      capacity: 40,
      audioProfile: 'bus',
    };
    simulation.registerVehicleModel(descriptor);
    expect(simulation.hasVehicleModel('caceres-bus')).toBe(true);
    // No GLB-backed factory is registered yet, so even a valid permission must
    // refuse to fabricate a procedural bus.
    expect(
      simulation.spawnServiceVehicle(grantVehicleSpawnPermission(), 'bus', spawnPose),
    ).toBeNull();
  });

  it('steps the physics world once for every dynamic vehicle', () => {
    const calls = { steps: 0, updates: 0, postPhysics: 0 };
    const world = {
      step: () => {
        calls.steps += 1;
      },
    } as unknown as World;
    const makeVehicle = (): Vehicle =>
      ({
        update: () => {
          calls.updates += 1;
        },
        postPhysics: () => {
          calls.postPhysics += 1;
          return false;
        },
        speed: 0,
        position: new THREE.Vector3(),
        heading: 0,
        chassisBody: { linvel: () => ({ x: 0, y: 0, z: 0 }) },
      }) as unknown as Vehicle;
    const vehicles = [makeVehicle(), makeVehicle(), makeVehicle()];
    const simulation = new VehicleSimulation(world, vehicles);

    simulation.step(1 / 60, vehicles[0] ?? null, NEUTRAL_DRIVE_INPUT);

    expect(calls).toEqual({ steps: 1, updates: 3, postPhysics: 3 });
    expect(simulation.metrics.steps).toBe(1);
    expect(simulation.metrics.simulatedVehicles).toBe(3);
  });

  it('reports a freshly parked vehicle as stopped', () => {
    const chassisBody = { linvel: () => ({ x: 0, y: 0, z: 0 }) };
    const vehicle = {
      position: new THREE.Vector3(1, 2, 3),
      heading: 0,
      speed: 0,
      chassisBody,
    } as unknown as Vehicle;
    const simulation = new VehicleSimulation({} as unknown as World, [vehicle]);
    const snapshot = simulation.poseOf(vehicle, 'player');
    expect(snapshot.stopped).toBe(true);
    expect(snapshot.motion).toBe('stopped');
    expect(snapshot.forward).toEqual({ x: 0, z: 1 });
    expect(snapshot.position).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe('roundabout detection', () => {
  it('marks a short one-way closed OSM way and lowers its traffic speed', () => {
    const network = buildRoadNetwork([
      {
        id: 'w-ring',
        highway: 'service',
        oneway: 1,
        nodeIds: [1, 2, 3, 4, 1],
        points: [
          [0, 0],
          [12, 0],
          [12, 12],
          [0, 12],
          [0, 0],
        ],
      },
    ]);
    const graph = new RoadGraph(network);
    expect(graph.segments).toHaveLength(4);
    expect(graph.segments.every((segment) => segment.roundabout)).toBe(true);
    expect(graph.roundaboutNodes.every((value) => value === 1)).toBe(true);
    expect(graph.segments.every((segment) => segment.speed <= 5.5)).toBe(true);
    const edge = graph.outgoingEdges(0, 'vehicle')[0];
    expect(edge).toBeDefined();
    expect(graph.isRoundaboutEdge(edge ?? -1)).toBe(true);
    expect(graph.isRoundaboutNode(0)).toBe(true);
  });

  it('does not classify a two-way closed loop as a roundabout', () => {
    const network = buildRoadNetwork([
      {
        id: 'w-block',
        highway: 'service',
        oneway: 0,
        nodeIds: [1, 2, 3, 4, 1],
        points: [
          [0, 0],
          [12, 0],
          [12, 12],
          [0, 12],
          [0, 0],
        ],
      },
    ]);
    const graph = new RoadGraph(network);
    expect(graph.segments.every((segment) => !segment.roundabout)).toBe(true);
  });
});
