import * as THREE from 'three';
import type { Camera } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { AgentColliderSink } from './agent-colliders';
import { RoadGraph } from './road-graph';
import type { AgentMode } from './road-graph';
import {
  createDetailedPedestrianGeometry,
  createDetailedVehicleGeometry,
  createPedestrianMesh,
  createVehicleMesh,
  disposeAgentMesh,
  replaceInstancedModel,
} from './npc-models';

export interface NpcWorld {
  groundHeightAt(x: number, z: number): number | undefined;
  collidesWithBuilding(x: number, z: number, radius?: number): boolean;
}

export interface NpcCounts {
  readonly pedestrians: number;
  readonly vehicles: number;
}

export interface ClaimedVehicle {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly color: number;
}

const MAX_ROUTE = 24;
const SPAWN_MIN_METERS = 45;
const DESPAWN_METERS = 330;
const INTERSECTION_YIELD_SECONDS = 2.5;
// Distant agents keep their footprint and collider but advance less often.
const LOD_NEAR_METERS = 90;
const LOD_MID_METERS = 210;
const NEIGHBOR_CELL_METERS = 12;

/**
 * Ambient pedestrians and traffic driven by the OSM-derived road graph.
 * All agent state lives in typed arrays and instances are pooled, so the hot
 * loop performs no per-agent allocations and stays at two draw calls.
 */
export class NpcSystem {
  readonly group = new THREE.Group();
  private readonly graph: RoadGraph;
  private readonly colliders: AgentColliderSink | undefined;
  private readonly colliderIds: Int32Array;
  private readonly pedestrianMesh: THREE.InstancedMesh;
  private readonly vehicleMesh: THREE.InstancedMesh;
  private readonly pedestrianCapacity: number;
  private readonly vehicleCapacity: number;
  private readonly active: Uint8Array;
  private readonly kind: Uint8Array;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly z: Float32Array;
  private readonly heading: Float32Array;
  private readonly speed: Float32Array;
  private readonly accumulatedUpdateSeconds: Float32Array;
  private readonly scale: Float32Array;
  private readonly edge: Int32Array;
  private readonly progress: Float32Array;
  private readonly route: Int32Array;
  private readonly routeLength: Uint8Array;
  private readonly routeIndex: Uint8Array;
  private readonly stuckTime: Float32Array;
  private readonly checkedMid: Uint8Array;
  private readonly reroutes: Uint8Array;
  private readonly claimTime: Float32Array;
  private readonly intersectionOwner: Int32Array;
  private readonly colorIndex: Uint8Array;
  private readonly fleeTime: Float32Array;
  private readonly fleeX: Float32Array;
  private readonly fleeZ: Float32Array;
  private readonly freePedestrians: number[] = [];
  private readonly freeVehicles: number[] = [];
  private readonly pedestrianColors: THREE.Color[] = [];
  private readonly vehicleColors: THREE.Color[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly cameraDirection = new THREE.Vector3();
  private readonly temporaryColor = new THREE.Color();
  private readonly agentCells = new Map<number, number[]>();
  private readonly cellPool: number[][] = [];
  private randomState = 0x9e3779b9;
  private elapsed = 0;
  private spawnCooldown = 0;
  private activePedestrians = 0;
  private activeVehicles = 0;
  private totalReroutes = 0;
  private totalDespawns = 0;
  private followingBrakes = 0;
  private roundaboutExits = 0;
  private updateFrame = 0;
  private readonly lodPopulation: [number, number, number] = [0, 0, 0];

  constructor(graph: RoadGraph, counts: NpcCounts, colliders?: AgentColliderSink) {
    this.graph = graph;
    this.colliders = colliders;
    this.pedestrianCapacity = Math.max(1, counts.pedestrians);
    this.vehicleCapacity = Math.max(1, counts.vehicles);
    const capacity = this.pedestrianCapacity + this.vehicleCapacity;
    this.colliderIds = new Int32Array(capacity).fill(-1);
    this.pedestrianMesh = createPedestrianMesh(this.pedestrianCapacity);
    this.vehicleMesh = createVehicleMesh(this.vehicleCapacity);
    this.group.add(this.pedestrianMesh, this.vehicleMesh);
    this.active = new Uint8Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.heading = new Float32Array(capacity);
    this.speed = new Float32Array(capacity);
    this.accumulatedUpdateSeconds = new Float32Array(capacity);
    this.scale = new Float32Array(capacity);
    this.edge = new Int32Array(capacity);
    this.progress = new Float32Array(capacity);
    this.route = new Int32Array(capacity * MAX_ROUTE);
    this.routeLength = new Uint8Array(capacity);
    this.routeIndex = new Uint8Array(capacity);
    this.stuckTime = new Float32Array(capacity);
    this.checkedMid = new Uint8Array(capacity);
    this.reroutes = new Uint8Array(capacity);
    this.claimTime = new Float32Array(graph.nodeCount);
    this.intersectionOwner = new Int32Array(graph.nodeCount);
    this.colorIndex = new Uint8Array(capacity);
    this.fleeTime = new Float32Array(capacity);
    this.fleeX = new Float32Array(capacity);
    this.fleeZ = new Float32Array(capacity);
    for (let slot = this.pedestrianCapacity - 1; slot >= 0; slot -= 1)
      this.freePedestrians.push(slot);
    for (let slot = capacity - 1; slot >= this.pedestrianCapacity; slot -= 1)
      this.freeVehicles.push(slot);
    // Curated European pedestrian palettes: earthy tones, denims, leathers and jackets
    const PEDESTRIAN_COLORS = [
      0x384a5c, 0x5a4638, 0x2d3439, 0x6a7568, 0x85684e, 0x423b4e, 0x314241, 0x68584a, 0x2c3138,
      0x763f38, 0x485869, 0x505050, 0x866e51, 0x3a483e, 0x5e4758, 0x494e55, 0x755e44, 0x243036,
      0x7d4f3e, 0x3a4650,
    ];
    for (const hex of PEDESTRIAN_COLORS) this.pedestrianColors.push(new THREE.Color(hex));
    // Curated realistic automotive paint finishes (metallic pearl, graphite, navy, burgundy, champagne)
    const AUTOMOTIVE_PAINTS = [
      0xf0f3f6, 0x1c1d20, 0x383c42, 0x9da3a8, 0x8b1e22, 0x1c3258, 0x274332, 0xb29b7c, 0x325a88,
      0x592332, 0x4a463d, 0xd94432, 0x5c6970, 0x252a30,
    ];
    for (const hex of AUTOMOTIVE_PAINTS) this.vehicleColors.push(new THREE.Color(hex));
  }

  get counts(): NpcCounts {
    return { pedestrians: this.activePedestrians, vehicles: this.activeVehicles };
  }

  /** Ambient-agent counts for the near, middle and far simulation tiers. */
  get lodCounts(): readonly [number, number, number] {
    return this.lodPopulation;
  }

  get diagnostics(): {
    readonly reroutes: number;
    readonly despawns: number;
    readonly followingBrakes: number;
    readonly roundaboutExits: number;
  } {
    return {
      reroutes: this.totalReroutes,
      despawns: this.totalDespawns,
      followingBrakes: this.followingBrakes,
      roundaboutExits: this.roundaboutExits,
    };
  }

  getVehiclePositions(result: { x: number; z: number }[]): void {
    result.length = 0;
    const capacity = this.pedestrianCapacity + this.vehicleCapacity;
    for (let slot = this.pedestrianCapacity; slot < capacity; slot += 1) {
      if (this.active[slot] === 1) {
        result.push({ x: this.x[slot] ?? 0, z: this.z[slot] ?? 0 });
      }
    }
  }

  /** Replace the low-poly crowd with one baked walk pose from the CC0 rigged asset. */
  setPedestrianModel(gltf: GLTF): void {
    replaceInstancedModel(this.pedestrianMesh, createDetailedPedestrianGeometry(gltf));
  }

  /** Replace the built-in sedans with the instanced Caceres GT traffic LOD. */
  setVehicleModel(gltf: GLTF): void {
    replaceInstancedModel(this.vehicleMesh, createDetailedVehicleGeometry(gltf));
  }

  /** Pedestrians within the radius run away and avoid the threat at junctions. */
  alarm(x: number, z: number, radius = 65): number {
    const squared = radius * radius;
    let alarmed = 0;
    for (let slot = 0; slot < this.pedestrianCapacity; slot += 1) {
      if (this.active[slot] !== 1 || this.kind[slot] !== 0) continue;
      const dx = (this.x[slot] ?? 0) - x;
      const dz = (this.z[slot] ?? 0) - z;
      if (dx * dx + dz * dz > squared) continue;
      this.fleeTime[slot] = 6;
      this.fleeX[slot] = x;
      this.fleeZ[slot] = z;
      alarmed += 1;
    }
    return alarmed;
  }

  /** Removes the closest ambient car so the player can drive it away. */
  claimVehicle(position: THREE.Vector3, maxDistance = 4): ClaimedVehicle | undefined {
    let chosen = -1;
    let bestSquared = maxDistance * maxDistance;
    const capacity = this.pedestrianCapacity + this.vehicleCapacity;
    for (let slot = this.pedestrianCapacity; slot < capacity; slot += 1) {
      if (this.active[slot] !== 1) continue;
      const dx = (this.x[slot] ?? 0) - position.x;
      const dz = (this.z[slot] ?? 0) - position.z;
      const squared = dx * dx + dz * dz;
      if (squared >= bestSquared) continue;
      bestSquared = squared;
      chosen = slot;
    }
    if (chosen < 0) return undefined;
    const colorObj = this.vehicleColors[this.colorIndex[chosen] ?? 0] ?? this.vehicleColors[0];
    const color = colorObj ? colorObj.getHex() : 0xc94a3a;
    const claimed: ClaimedVehicle = {
      x: this.x[chosen] ?? 0,
      y: this.y[chosen] ?? 0,
      z: this.z[chosen] ?? 0,
      heading: this.heading[chosen] ?? 0,
      color,
    };
    this.release(chosen);
    return claimed;
  }

  /** True when a pedestrian is inside the impact radius of the player's car. */
  checkVehicleImpact(position: THREE.Vector3, radius = 2.4): boolean {
    const squared = radius * radius;
    for (let slot = 0; slot < this.pedestrianCapacity; slot += 1) {
      if (this.active[slot] !== 1 || this.kind[slot] !== 0) continue;
      const dx = (this.x[slot] ?? 0) - position.x;
      const dz = (this.z[slot] ?? 0) - position.z;
      if (dx * dx + dz * dz <= squared) return true;
    }
    return false;
  }

  /** Pushes an on-foot player out of agent footprints (Rapier handles the car). */
  resolveCollision(position: THREE.Vector3, radius = 0.4): void {
    const capacity = this.pedestrianCapacity + this.vehicleCapacity;
    for (let slot = 0; slot < capacity; slot += 1) {
      if (this.active[slot] !== 1) continue;
      const minimum = (this.kind[slot] === 0 ? 0.32 : 1.1) + radius;
      const dx = position.x - (this.x[slot] ?? 0);
      const dz = position.z - (this.z[slot] ?? 0);
      const distance = Math.hypot(dx, dz);
      if (distance >= minimum) continue;
      if (distance < 1e-4) {
        position.x += minimum;
        continue;
      }
      const push = (minimum - distance) / distance;
      position.x += dx * push;
      position.z += dz * push;
    }
  }

  update(deltaSeconds: number, player: THREE.Vector3, camera: Camera, world: NpcWorld): void {
    const dt = Math.min(Math.max(deltaSeconds, 0), 0.05);
    this.elapsed += dt;
    this.updateFrame += 1;
    this.lodPopulation[0] = 0;
    this.lodPopulation[1] = 0;
    this.lodPopulation[2] = 0;
    this.cameraDirection.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.maintainPopulation(dt, player, world);
    this.rebuildSpatialIndex();
    for (let slot = 0; slot < this.active.length; slot += 1) {
      if (this.active[slot] !== 1) continue;
      const dx = (this.x[slot] ?? 0) - player.x;
      const dz = (this.z[slot] ?? 0) - player.z;
      const squared = dx * dx + dz * dz;
      const lod: 0 | 1 | 2 =
        squared < LOD_NEAR_METERS * LOD_NEAR_METERS
          ? 0
          : squared < LOD_MID_METERS * LOD_MID_METERS
            ? 1
            : 2;
      this.lodPopulation[lod] = (this.lodPopulation[lod] ?? 0) + 1;
      // Stagger updates across frames so far agents cost a quarter of the work.
      const cadence = lod === 0 ? 1 : lod === 1 ? 2 : 4;
      this.accumulatedUpdateSeconds[slot] = (this.accumulatedUpdateSeconds[slot] ?? 0) + dt;
      if (this.updateFrame % cadence === slot % cadence) {
        // A single advance must not skip a short segment, so discard spare time.
        const updateSeconds = Math.min(this.accumulatedUpdateSeconds[slot] ?? dt, 0.05);
        this.accumulatedUpdateSeconds[slot] = 0;
        this.advance(slot, updateSeconds, player, world);
      }
      // Redraw every frame: a pooled instance must not show the previous agent.
      if (this.active[slot] === 1) this.render(slot);
    }
    this.pedestrianMesh.count = this.activePedestrians;
    this.vehicleMesh.count = this.activeVehicles;
    this.pedestrianMesh.instanceMatrix.needsUpdate = true;
    this.vehicleMesh.instanceMatrix.needsUpdate = true;
    if (this.pedestrianMesh.instanceColor) this.pedestrianMesh.instanceColor.needsUpdate = true;
    if (this.vehicleMesh.instanceColor) this.vehicleMesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (let slot = 0; slot < this.active.length; slot += 1) {
      if (this.active[slot] === 1) this.release(slot);
    }
    this.group.remove(this.pedestrianMesh, this.vehicleMesh);
    disposeAgentMesh(this.pedestrianMesh);
    disposeAgentMesh(this.vehicleMesh);
  }

  private maintainPopulation(dt: number, player: THREE.Vector3, world: NpcWorld): void {
    this.spawnCooldown -= dt;
    if (this.spawnCooldown > 0) return;
    this.spawnCooldown = 0.25;
    const despawnSquared = DESPAWN_METERS * DESPAWN_METERS;
    for (let slot = 0; slot < this.active.length; slot += 1) {
      if (this.active[slot] !== 1) continue;
      const dx = (this.x[slot] ?? 0) - player.x;
      const dz = (this.z[slot] ?? 0) - player.z;
      if (dx * dx + dz * dz > despawnSquared) this.release(slot);
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (this.activePedestrians < this.pedestrianCapacity) this.spawn(0, player, world);
      if (this.activeVehicles < this.vehicleCapacity) this.spawn(1, player, world);
    }
  }

  private spawn(kind: number, player: THREE.Vector3, world: NpcWorld): void {
    const pool = kind === 0 ? this.freePedestrians : this.freeVehicles;
    const slot = pool.pop();
    if (slot === undefined) return;
    const mode: AgentMode = kind === 0 ? 'pedestrian' : 'vehicle';
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const angle = this.random() * Math.PI * 2;
      const radius = SPAWN_MIN_METERS + this.random() * (DESPAWN_METERS - SPAWN_MIN_METERS - 40);
      const x = player.x + Math.cos(angle) * radius;
      const z = player.z + Math.sin(angle) * radius;
      const towardX = x - player.x;
      const towardZ = z - player.z;
      // Stricter filter: agents only spawn well behind the camera so the player
      // never catches a pop-in.
      if (
        towardX * (this.cameraDirection.x ?? 0) + towardZ * (this.cameraDirection.z ?? 0) >
        -radius * 0.4
      )
        continue;
      const height = world.groundHeightAt(x, z);
      if (height === undefined || world.collidesWithBuilding(x, z, 1)) continue;
      const start = this.graph.nearestNode(x, z, mode);
      if (start < 0) continue;
      const edges = this.graph.outgoingEdges(start, mode);
      if (edges.length === 0) continue;
      const first = edges[Math.floor(this.random() * edges.length)] ?? -1;
      if (first < 0) continue;
      this.active[slot] = 1;
      this.kind[slot] = kind;
      this.x[slot] = x;
      this.y[slot] = height;
      this.z[slot] = z;
      this.scale[slot] = kind === 0 ? 0.88 + this.random() * 0.24 : 0.92 + this.random() * 0.16;
      this.speed[slot] = 0;
      this.accumulatedUpdateSeconds[slot] = 0;
      this.edge[slot] = first;
      this.progress[slot] = 0;
      this.routeLength[slot] = 0;
      this.routeIndex[slot] = 0;
      this.stuckTime[slot] = 0;
      this.checkedMid[slot] = 0;
      this.reroutes[slot] = 0;
      this.fleeTime[slot] = 0;
      this.colorIndex[slot] = Math.floor(
        this.random() * (kind === 0 ? this.pedestrianColors.length : this.vehicleColors.length),
      );
      if (kind === 0) this.activePedestrians += 1;
      else this.activeVehicles += 1;
      this.colliderIds[slot] = this.colliders?.create(mode, x, height, z, 0) ?? -1;
      this.setRoute(slot, start, mode);
      return;
    }
    pool.push(slot);
  }

  private advance(slot: number, dt: number, player: THREE.Vector3, world: NpcWorld): void {
    const edge = this.edge[slot] ?? -1;
    const segment = this.graph.edgeSegment(edge);
    const info = this.graph.segments[segment];
    if (!info) {
      this.release(slot);
      return;
    }
    const forward = (edge & 1) === 0;
    const toNode = forward ? info.to : info.from;
    const mode: AgentMode = this.kind[slot] === 0 ? 'pedestrian' : 'vehicle';
    const onRoundabout = mode === 'vehicle' && info.roundabout;
    let desired = mode === 'pedestrian' ? 1.5 : Math.min(info.speed, 14);
    desired *=
      this.kind[slot] === 0
        ? 0.85 + (this.scale[slot] ?? 1) * 0.2
        : 0.75 + (this.scale[slot] ?? 1) * 0.25;
    if (this.kind[slot] === 0 && (this.fleeTime[slot] ?? 0) > 0) {
      this.fleeTime[slot] = Math.max(0, (this.fleeTime[slot] ?? 0) - dt);
      desired = Math.max(desired, 3.6);
    }

    const gap = this.distanceAhead(slot, player);
    if (gap < Infinity) {
      if (mode === 'vehicle') {
        const followingSpeed = Math.max(0, gap - 3) * 1.3;
        if (followingSpeed < desired - 0.2) this.followingBrakes += 1;
        desired = Math.min(desired, followingSpeed);
      } else if (gap < 2.4) {
        desired = 0;
      }
    }
    // Circulating traffic must not claim the junction at every short segment.
    // Cars still yield before entering a roundabout from an approach road.
    if (!onRoundabout && (this.progress[slot] ?? 0) > 0.94) {
      const owner = this.intersectionOwner[toNode] ?? 0;
      if (
        owner !== 0 &&
        owner !== slot + 1 &&
        this.elapsed - (this.claimTime[toNode] ?? 0) < INTERSECTION_YIELD_SECONDS
      )
        desired = 0;
      else {
        this.intersectionOwner[toNode] = slot + 1;
        this.claimTime[toNode] = this.elapsed;
      }
    }

    const currentSpeed = this.speed[slot] ?? 0;
    // Accelerate gently, decelerate more decisively — cars and people look more
    // natural when they ease into motion but stop with purpose.
    const ramp = desired > currentSpeed ? dt * 2.0 : dt * 5.0;
    const nextSpeed = currentSpeed + (desired - currentSpeed) * Math.min(1, ramp);
    this.speed[slot] = nextSpeed;
    if (nextSpeed < 0.2) this.stuckTime[slot] = (this.stuckTime[slot] ?? 0) + dt;
    else this.stuckTime[slot] = 0;
    if ((this.stuckTime[slot] ?? 0) > 3) this.handleStuck(slot, toNode, mode);
    if (this.active[slot] !== 1) return;

    let progress = (this.progress[slot] ?? 0) + (nextSpeed * dt) / info.length;
    if (progress >= 1) {
      const nextEdge = this.selectNextEdge(slot, toNode, mode);
      if (nextEdge < 0) {
        this.release(slot);
        return;
      }
      if (
        mode === 'vehicle' &&
        this.graph.isRoundaboutEdge(edge) &&
        !this.graph.isRoundaboutEdge(nextEdge)
      )
        this.roundaboutExits += 1;
      this.edge[slot] = nextEdge;
      this.checkedMid[slot] = 0;
      progress -= 1;
    }
    this.progress[slot] = progress;
    const current = this.edge[slot] ?? edge;
    const currentInfo = this.graph.segments[this.graph.edgeSegment(current)];
    if (!currentInfo) {
      this.release(slot);
      return;
    }
    const currentForward = (current & 1) === 0;
    const ax = this.graph.nodeX[currentForward ? currentInfo.from : currentInfo.to] ?? 0;
    const az = this.graph.nodeZ[currentForward ? currentInfo.from : currentInfo.to] ?? 0;
    const bx = this.graph.nodeX[currentForward ? currentInfo.to : currentInfo.from] ?? 0;
    const bz = this.graph.nodeZ[currentForward ? currentInfo.to : currentInfo.from] ?? 0;
    this.x[slot] = ax + (bx - ax) * progress;
    this.z[slot] = az + (bz - az) * progress;
    const height = world.groundHeightAt(this.x[slot] ?? 0, this.z[slot] ?? 0);
    if (height === undefined) {
      this.release(slot);
      return;
    }
    // Footprint tests walk all nearby chunks, so sample once per half segment.
    const mid = progress >= 0.5 ? 1 : 0;
    if (mid !== (this.checkedMid[slot] ?? 0)) {
      this.checkedMid[slot] = mid;
      if (world.collidesWithBuilding(this.x[slot] ?? 0, this.z[slot] ?? 0, 0.5)) {
        this.release(slot);
        return;
      }
    }
    this.y[slot] = height;
    if (this.kind[slot] === 0 && (this.fleeTime[slot] ?? 0) > 0) {
      const awayX = (this.x[slot] ?? 0) - (this.fleeX[slot] ?? 0);
      const awayZ = (this.z[slot] ?? 0) - (this.fleeZ[slot] ?? 0);
      if (Math.hypot(awayX, awayZ) > 0.2) {
        const fleeHeading = Math.atan2(awayX, awayZ);
        let fleeDelta = fleeHeading - (this.heading[slot] ?? 0);
        if (fleeDelta > Math.PI) fleeDelta -= Math.PI * 2;
        if (fleeDelta < -Math.PI) fleeDelta += Math.PI * 2;
        this.heading[slot] = (this.heading[slot] ?? 0) + fleeDelta * Math.min(1, dt * 10);
      }
    } else if (nextSpeed > 0.05) {
      // Smooth angular interpolation so agents turn gradually instead of
      // snapping to the new edge direction.
      const targetHeading = Math.atan2(bx - ax, bz - az);
      let headingDelta = targetHeading - (this.heading[slot] ?? 0);
      if (headingDelta > Math.PI) headingDelta -= Math.PI * 2;
      if (headingDelta < -Math.PI) headingDelta += Math.PI * 2;
      const turnRate = this.kind[slot] === 0 ? 8 : 5;
      this.heading[slot] = (this.heading[slot] ?? 0) + headingDelta * Math.min(1, dt * turnRate);
    }
    this.colliders?.move(
      this.colliderIds[slot] ?? -1,
      this.x[slot] ?? 0,
      this.y[slot] ?? 0,
      this.z[slot] ?? 0,
      this.heading[slot] ?? 0,
    );
  }

  /** Rebuilds a uniform grid once per frame so neighbor checks are not O(n²). */
  private rebuildSpatialIndex(): void {
    for (const bucket of this.agentCells.values()) {
      bucket.length = 0;
      this.cellPool.push(bucket);
    }
    this.agentCells.clear();
    for (let slot = 0; slot < this.active.length; slot += 1) {
      if (this.active[slot] !== 1) continue;
      const key = this.cellKey(this.x[slot] ?? 0, this.z[slot] ?? 0);
      let bucket = this.agentCells.get(key);
      if (!bucket) {
        bucket = this.cellPool.pop() ?? [];
        this.agentCells.set(key, bucket);
      }
      bucket.push(slot);
    }
  }

  private cellKey(x: number, z: number): number {
    const cellX = Math.floor(x / NEIGHBOR_CELL_METERS);
    const cellZ = Math.floor(z / NEIGHBOR_CELL_METERS);
    return (cellX + 4096) * 8192 + cellZ + 4096;
  }

  /** Forward clearance to the closest agent in the same lane. */
  private distanceAhead(slot: number, player: THREE.Vector3): number {
    const x = this.x[slot] ?? 0;
    const z = this.z[slot] ?? 0;
    const heading = this.heading[slot] ?? 0;
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    const isPedestrian = this.kind[slot] === 0;
    const reach = isPedestrian ? 2.4 : 12;
    const lateralLimit = isPedestrian ? 0.8 : 1.8;
    const baseX = Math.floor(x / NEIGHBOR_CELL_METERS);
    const baseZ = Math.floor(z / NEIGHBOR_CELL_METERS);
    let nearest = Infinity;

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const key = (baseX + dx + 4096) * 8192 + baseZ + dz + 4096;
        for (const other of this.agentCells.get(key) ?? []) {
          if (other === slot || this.active[other] !== 1) continue;
          const offsetX = (this.x[other] ?? 0) - x;
          const offsetZ = (this.z[other] ?? 0) - z;
          const along = offsetX * forwardX + offsetZ * forwardZ;
          if (along <= 0 || along > reach) continue;
          const lateral = Math.abs(offsetX * forwardZ - offsetZ * forwardX);
          if (lateral > lateralLimit) continue;
          nearest = Math.min(nearest, along);
        }
      }
    }
    if (isPedestrian) {
      const offsetX = player.x - x;
      const offsetZ = player.z - z;
      const along = offsetX * forwardX + offsetZ * forwardZ;
      if (along > 0 && along < 3 && Math.abs(offsetX * forwardZ - offsetZ * forwardX) < 0.8) {
        nearest = Math.min(nearest, along);
      }
    }
    return nearest;
  }

  private handleStuck(slot: number, node: number, mode: AgentMode): void {
    this.stuckTime[slot] = 0;
    this.reroutes[slot] = (this.reroutes[slot] ?? 0) + 1;
    this.totalReroutes += 1;
    if ((this.reroutes[slot] ?? 0) > 2) {
      this.totalDespawns += 1;
      this.release(slot);
      return;
    }
    this.setRoute(slot, node, mode);
    const edges = this.graph.outgoingEdges(node, mode);
    const next = edges[Math.floor(this.random() * edges.length)];
    if (next !== undefined) this.edge[slot] = next;
    this.checkedMid[slot] = 0;
    this.progress[slot] = 0;
  }

  private setRoute(slot: number, start: number, mode: AgentMode): void {
    // Long cross-city searches would spike a frame; keep ambient trips local.
    let destination = -1;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = Math.floor(this.random() * this.graph.nodeCount);
      const dx = (this.graph.nodeX[candidate] ?? 0) - (this.graph.nodeX[start] ?? 0);
      const dz = (this.graph.nodeZ[candidate] ?? 0) - (this.graph.nodeZ[start] ?? 0);
      const squared = dx * dx + dz * dz;
      if (squared > 80 * 80 && squared < 520 * 520) {
        destination = candidate;
        break;
      }
    }
    const path = destination >= 0 ? this.graph.route(start, destination, mode) : [];
    const limit = Math.min(path.length, MAX_ROUTE);
    for (let i = 0; i < limit; i += 1) this.route[slot * MAX_ROUTE + i] = path[i] ?? -1;
    this.routeLength[slot] = limit;
    this.routeIndex[slot] = 1;
  }

  private selectNextEdge(slot: number, node: number, mode: AgentMode): number {
    const index = this.routeIndex[slot] ?? 0;
    const target =
      index < (this.routeLength[slot] ?? 0) ? (this.route[slot * MAX_ROUTE + index] ?? -1) : -1;
    const edges = this.graph.outgoingEdges(node, mode);
    if (mode === 'pedestrian' && (this.fleeTime[slot] ?? 0) > 0) {
      let bestEdge = -1;
      let bestDistance = -Infinity;
      for (const edge of edges) {
        const destination = this.graph.edgeDestination(edge);
        const dx = (this.graph.nodeX[destination] ?? 0) - (this.fleeX[slot] ?? 0);
        const dz = (this.graph.nodeZ[destination] ?? 0) - (this.fleeZ[slot] ?? 0);
        const distance = dx * dx + dz * dz;
        if (distance <= bestDistance) continue;
        bestDistance = distance;
        bestEdge = edge;
      }
      if (bestEdge >= 0) return bestEdge;
    }
    for (const edge of edges) {
      if (this.graph.edgeDestination(edge) === target) {
        this.routeIndex[slot] = index + 1;
        return edge;
      }
    }
    if (index >= (this.routeLength[slot] ?? 0)) this.setRoute(slot, node, mode);
    // Pick a different street when the planned turn is unavailable; avoid a U-turn.
    let alternatives = 0;
    for (const edge of edges) if (this.graph.edgeDestination(edge) !== node) alternatives += 1;
    if (alternatives === 0) return edges[0] ?? -1;
    let pick = Math.floor(this.random() * alternatives);
    for (const edge of edges) {
      if (this.graph.edgeDestination(edge) === node) continue;
      if (pick === 0) return edge;
      pick -= 1;
    }
    return edges[0] ?? -1;
  }

  private render(slot: number): void {
    const mesh = this.kind[slot] === 0 ? this.pedestrianMesh : this.vehicleMesh;
    const instance = this.kind[slot] === 0 ? slot : slot - this.pedestrianCapacity;
    // Taller bob, offset by slot index to break the unison.
    const walkSpeed = this.speed[slot] ?? 0;
    const bob =
      this.kind[slot] === 0
        ? Math.sin(this.elapsed * 9.5 + slot * 2.3) * Math.min(walkSpeed / 3, 0.12)
        : 0;
    const pitch = this.kind[slot] === 0 ? Math.min(walkSpeed / 25, 0.12) : 0;
    this.dummy.position.set(this.x[slot] ?? 0, (this.y[slot] ?? 0) + bob, this.z[slot] ?? 0);
    this.dummy.rotation.set(pitch, this.heading[slot] ?? 0, 0);
    this.dummy.scale.setScalar(this.scale[slot] ?? 1);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(instance, this.dummy.matrix);
    const palette = this.kind[slot] === 0 ? this.pedestrianColors : this.vehicleColors;
    const color = palette[this.colorIndex[slot] ?? 0] ?? palette[0];
    // Crowd vertex colors already separate skin, clothing and shoes. Applying
    // one instance tint to the whole person colored every face and garment.
    if (color && this.kind[slot] !== 0) mesh.setColorAt(instance, this.temporaryColor.copy(color));
  }

  private release(slot: number): void {
    if (this.active[slot] !== 1) return;
    this.active[slot] = 0;
    this.accumulatedUpdateSeconds[slot] = 0;
    const colliderId = this.colliderIds[slot] ?? -1;
    if (colliderId >= 0) this.colliders?.remove(colliderId);
    this.colliderIds[slot] = -1;

    // Immediately remove/hide the released agent instance matrix so no ghost stays behind.
    const isPedestrian = this.kind[slot] === 0;
    const instance = isPedestrian ? slot : slot - this.pedestrianCapacity;
    const mesh = isPedestrian ? this.pedestrianMesh : this.vehicleMesh;
    this.dummy.position.set(0, -9999, 0);
    this.dummy.scale.set(0, 0, 0);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(instance, this.dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;

    if (isPedestrian) {
      this.activePedestrians -= 1;
      this.freePedestrians.push(slot);
    } else {
      this.activeVehicles -= 1;
      this.freeVehicles.push(slot);
    }
  }

  private random(): number {
    let state = this.randomState;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.randomState = state >>> 0;
    return this.randomState / 0x100000000;
  }
}
