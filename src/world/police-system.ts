import * as THREE from 'three';
import type { Camera } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { AgentColliderSink } from './agent-colliders';
import type { RoadGraph } from './road-graph';
import type { NpcWorld } from './npc-system';
import {
  createDetailedVehicleGeometry,
  createPoliceMesh,
  disposeAgentMesh,
  replaceInstancedModel,
} from './npc-models';

const CAPACITY = 5;
const MAX_ROUTE = 64;
const SPAWN_MIN_METERS = 70;
const SPAWN_MAX_METERS = 180;
const DESPAWN_METERS = 420;
const REROUTE_SECONDS = 1.5;
const YIELD_SECONDS = 1.8;

/** Five pooled patrol cars that chase the player along the real road graph. */
export class PoliceSystem {
  readonly group = new THREE.Group();
  private readonly graph: RoadGraph;
  private readonly colliders: AgentColliderSink | undefined;
  private readonly colliderIds: Int32Array;
  private readonly mesh: THREE.InstancedMesh;
  private readonly active = new Uint8Array(CAPACITY);
  private readonly x = new Float32Array(CAPACITY);
  private readonly y = new Float32Array(CAPACITY);
  private readonly z = new Float32Array(CAPACITY);
  private readonly heading = new Float32Array(CAPACITY);
  private readonly speed = new Float32Array(CAPACITY);
  private readonly edge = new Int32Array(CAPACITY);
  private readonly progress = new Float32Array(CAPACITY);
  private readonly checkedMid = new Uint8Array(CAPACITY);
  private readonly route = new Int32Array(CAPACITY * MAX_ROUTE);
  private readonly routeLength = new Uint8Array(CAPACITY);
  private readonly routeIndex = new Uint8Array(CAPACITY);
  private readonly intersectionOwner = new Int32Array(0);
  private readonly claimTime = new Float32Array(0);
  private readonly free: number[] = [];
  private readonly palette = [new THREE.Color(0x1d4f91), new THREE.Color(0xe8e9e4)];
  private readonly dummy = new THREE.Object3D();
  private readonly cameraDirection = new THREE.Vector3();
  private randomState = 0x85ebca6b;
  private elapsed = 0;
  private spawnCooldown = 0;
  private rerouteCooldown = 0;
  private activeCount = 0;

  constructor(graph: RoadGraph, colliders?: AgentColliderSink) {
    this.graph = graph;
    this.colliders = colliders;
    this.colliderIds = new Int32Array(CAPACITY).fill(-1);
    this.mesh = createPoliceMesh(CAPACITY);
    this.group.add(this.mesh);
    this.intersectionOwner = new Int32Array(graph.nodeCount);
    this.claimTime = new Float32Array(graph.nodeCount);
    for (let slot = 0; slot < CAPACITY; slot += 1) this.free.push(slot);
  }

  /** Replace the built-in patrol cars with the instanced Caceres GT police LOD. */
  setVehicleModel(gltf: GLTF): void {
    replaceInstancedModel(this.mesh, createDetailedVehicleGeometry(gltf));
  }

  get count(): number {
    return this.activeCount;
  }

  getPatrolPositions(result: { x: number; z: number }[]): void {
    result.length = 0;
    for (let slot = 0; slot < CAPACITY; slot += 1) {
      if (this.active[slot] === 1) {
        result.push({ x: this.x[slot] ?? 0, z: this.z[slot] ?? 0 });
      }
    }
  }

  nearestDistance(target: THREE.Vector3): number {
    let nearest = Infinity;
    for (let slot = 0; slot < CAPACITY; slot += 1) {
      if (this.active[slot] !== 1) continue;
      const dx = (this.x[slot] ?? 0) - target.x;
      const dz = (this.z[slot] ?? 0) - target.z;
      nearest = Math.min(nearest, Math.hypot(dx, dz));
    }
    return nearest;
  }

  /** Keeps a scripted on-foot player outside patrol car footprints. */
  resolveCollision(position: THREE.Vector3, radius = 0.4): void {
    const minimum = 1.1 + radius;
    for (let slot = 0; slot < CAPACITY; slot += 1) {
      if (this.active[slot] !== 1) continue;
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

  update(
    deltaSeconds: number,
    stars: number,
    target: THREE.Vector3,
    camera: Camera,
    world: NpcWorld,
  ): void {
    const dt = Math.min(Math.max(deltaSeconds, 0), 0.05);
    this.elapsed += dt;
    this.cameraDirection.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const wanted = stars > 0 ? Math.min(CAPACITY, Math.max(2, stars)) : 0;

    for (let slot = 0; slot < CAPACITY; slot += 1) {
      if (this.active[slot] !== 1) continue;
      const dx = (this.x[slot] ?? 0) - target.x;
      const dz = (this.z[slot] ?? 0) - target.z;
      if (wanted === 0 || dx * dx + dz * dz > DESPAWN_METERS * DESPAWN_METERS) this.release(slot);
    }

    this.rerouteCooldown -= dt;
    if (this.rerouteCooldown <= 0) {
      this.rerouteCooldown = REROUTE_SECONDS;
      for (let slot = 0; slot < CAPACITY; slot += 1) {
        if (this.active[slot] === 1) this.setRoute(slot, this.edgeStart(slot), target);
      }
    }

    this.spawnCooldown -= dt;
    if (this.spawnCooldown <= 0) {
      this.spawnCooldown = 0.35;
      for (let attempt = 0; attempt < 2 && this.activeCount < wanted; attempt += 1) {
        this.spawn(target, world);
      }
    }

    let instance = 0;
    for (let slot = 0; slot < CAPACITY; slot += 1) {
      if (this.active[slot] !== 1) continue;
      this.advance(slot, dt, world);
      if (this.active[slot] !== 1) continue;
      this.render(slot, instance);
      instance += 1;
    }
    this.mesh.count = instance;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (let slot = 0; slot < CAPACITY; slot += 1) {
      if (this.active[slot] === 1) this.release(slot);
    }
    this.group.remove(this.mesh);
    disposeAgentMesh(this.mesh);
  }

  private spawn(target: THREE.Vector3, world: NpcWorld): void {
    const slot = this.free.pop();
    if (slot === undefined) return;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const angle = this.random() * Math.PI * 2;
      const radius = SPAWN_MIN_METERS + this.random() * (SPAWN_MAX_METERS - SPAWN_MIN_METERS);
      const x = target.x + Math.cos(angle) * radius;
      const z = target.z + Math.sin(angle) * radius;
      const towardX = x - target.x;
      const towardZ = z - target.z;
      if (
        towardX * (this.cameraDirection.x ?? 0) + towardZ * (this.cameraDirection.z ?? 0) >
        -radius * 0.15
      )
        continue;
      const height = world.groundHeightAt(x, z);
      if (height === undefined || world.collidesWithBuilding(x, z, 1)) continue;
      const start = this.graph.nearestNode(x, z, 'vehicle');
      if (start < 0) continue;
      const edges = this.graph.outgoingEdges(start, 'vehicle');
      const first = edges[Math.floor(this.random() * edges.length)];
      if (first === undefined) continue;
      this.active[slot] = 1;
      this.x[slot] = x;
      this.y[slot] = height;
      this.z[slot] = z;
      this.heading[slot] = Math.atan2(towardX, towardZ);
      this.speed[slot] = 0;
      this.edge[slot] = first;
      this.progress[slot] = 0;
      this.checkedMid[slot] = 0;
      this.activeCount += 1;
      this.colliderIds[slot] =
        this.colliders?.create('vehicle', x, height, z, this.heading[slot] ?? 0) ?? -1;
      this.setRoute(slot, start, target);
      return;
    }
    this.free.push(slot);
  }

  private setRoute(slot: number, start: number, target: THREE.Vector3): void {
    let targetNode = this.graph.nearestNode(target.x, target.z, 'vehicle');
    let path = targetNode >= 0 ? this.graph.route(start, targetNode, 'vehicle') : [];
    if (path.length < 2) {
      // One-way streets can make the exact target node unreachable; aim nearby.
      targetNode = this.graph.nearestNode(
        target.x + (this.random() - 0.5) * 80,
        target.z + (this.random() - 0.5) * 80,
        'vehicle',
      );
      if (targetNode >= 0) path = this.graph.route(start, targetNode, 'vehicle');
    }
    const limit = Math.min(path.length, MAX_ROUTE);
    for (let i = 0; i < limit; i += 1) this.route[slot * MAX_ROUTE + i] = path[i] ?? -1;
    this.routeLength[slot] = limit;
    this.routeIndex[slot] = 1;
  }

  private advance(slot: number, dt: number, world: NpcWorld): void {
    const edge = this.edge[slot] ?? -1;
    const info = this.graph.segments[this.graph.edgeSegment(edge)];
    if (!info) {
      this.release(slot);
      return;
    }
    const forward = (edge & 1) === 0;
    const toNode = forward ? info.to : info.from;
    let desired = Math.min(info.speed * 1.25, 18);

    if ((this.progress[slot] ?? 0) > 0.92) {
      const owner = this.intersectionOwner[toNode] ?? 0;
      if (
        owner !== 0 &&
        owner !== slot + 1 &&
        this.elapsed - (this.claimTime[toNode] ?? 0) < YIELD_SECONDS
      )
        desired = 0;
      else {
        this.intersectionOwner[toNode] = slot + 1;
        this.claimTime[toNode] = this.elapsed;
      }
    }

    const currentSpeed = this.speed[slot] ?? 0;
    const nextSpeed = currentSpeed + (desired - currentSpeed) * Math.min(1, dt * 4);
    this.speed[slot] = nextSpeed;
    let progress = (this.progress[slot] ?? 0) + (nextSpeed * dt) / info.length;
    if (progress >= 1) {
      const nextEdge = this.selectNextEdge(slot, toNode);
      if (nextEdge < 0) {
        this.release(slot);
        return;
      }
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
    const mid = progress >= 0.5 ? 1 : 0;
    if (mid !== (this.checkedMid[slot] ?? 0)) {
      this.checkedMid[slot] = mid;
      if (world.collidesWithBuilding(this.x[slot] ?? 0, this.z[slot] ?? 0, 0.5)) {
        this.release(slot);
        return;
      }
    }
    this.y[slot] = height;
    if (nextSpeed > 0.05) this.heading[slot] = Math.atan2(bx - ax, bz - az);
    this.colliders?.move(
      this.colliderIds[slot] ?? -1,
      this.x[slot] ?? 0,
      this.y[slot] ?? 0,
      this.z[slot] ?? 0,
      this.heading[slot] ?? 0,
    );
  }

  private edgeStart(slot: number): number {
    const info = this.graph.segments[this.graph.edgeSegment(this.edge[slot] ?? -1)];
    if (!info) return -1;
    return (this.edge[slot] ?? -1) & 1 ? info.to : info.from;
  }

  private selectNextEdge(slot: number, node: number): number {
    const index = this.routeIndex[slot] ?? 0;
    const target =
      index < (this.routeLength[slot] ?? 0) ? (this.route[slot * MAX_ROUTE + index] ?? -1) : -1;
    const edges = this.graph.outgoingEdges(node, 'vehicle');
    for (const edge of edges) {
      if (this.graph.edgeDestination(edge) !== target) continue;
      this.routeIndex[slot] = index + 1;
      return edge;
    }
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

  private render(slot: number, instance: number): void {
    this.dummy.position.set(this.x[slot] ?? 0, this.y[slot] ?? 0, this.z[slot] ?? 0);
    this.dummy.rotation.set(0, this.heading[slot] ?? 0, 0);
    this.dummy.scale.setScalar(1);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(instance, this.dummy.matrix);
    const color = this.palette[slot % this.palette.length] ?? this.palette[0];
    if (color) this.mesh.setColorAt(instance, color);
  }

  private release(slot: number): void {
    if (this.active[slot] !== 1) return;
    this.active[slot] = 0;
    const colliderId = this.colliderIds[slot] ?? -1;
    if (colliderId >= 0) this.colliders?.remove(colliderId);
    this.colliderIds[slot] = -1;
    this.activeCount -= 1;
    this.free.push(slot);
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
