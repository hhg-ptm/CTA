import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';
import type { World } from '@dimforge/rapier3d-compat';
import { EventBus } from '../engine/event-bus';
import { AssetManager } from '../engine/asset-manager';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { buildChunkBorderGeometry } from './chunk-debug';
import { ChunkDebugOverlays } from './debug-overlays';
import { BuildingRenderer } from './building-renderer';
import { CityKit } from './city-kit';
import { sampleHeight } from './road-geometry';
import { RoadRenderer } from './road-renderer';
import { RoadHeightIndex } from './road-height-index';
import { createStork, updateStork } from './stork';
import { createTerrainDetailTexture } from './materials';
import { TerrainColliders } from './terrain-physics';
import type {
  BuiltTerrainChunk,
  ChunkEntry,
  TerrainChunkEvents,
  TerrainLodData,
  WorldManifest,
} from './types';

type ChunkState = 'queued' | 'loading' | 'loaded' | 'error';

interface ChunkRecord {
  readonly entry: ChunkEntry;
  state: ChunkState;
  distance: number;
  lod: number;
  result?: BuiltTerrainChunk;
  meshes?: THREE.Mesh[];
  buildingMeshes?: THREE.Mesh[][];
  buildingDetailMeshes?: THREE.Mesh[][];
  decorationMeshes?: THREE.Mesh[];
  landmarkObjects?: THREE.Object3D[];
  storks?: THREE.Group[];
  signs?: THREE.Mesh[];
  debugBorder?: THREE.LineSegments;
  memoryBytes: number;
  debugMemoryBytes: number;
  hasCollider: boolean;
}

interface WorkerResponse {
  readonly id: string;
  readonly result?: BuiltTerrainChunk;
  readonly error?: string;
}

interface CompletedChunk {
  readonly id: string;
  readonly result: BuiltTerrainChunk;
}

const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const GEOMETRY_BUDGET_MS = 5;
const MAX_ATTACHMENTS_PER_FRAME = 1;
const SCHEDULE_INTERVAL_MS = 100;

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

function distanceToCenter(x: number, z: number, entry: ChunkEntry): number {
  const centerX = (entry.bounds.minX + entry.bounds.maxX) / 2;
  const centerZ = (entry.bounds.minZ + entry.bounds.maxZ) / 2;
  return Math.hypot(x - centerX, z - centerZ);
}

function geometryForLod(
  level: TerrainLodData,
  result: BuiltTerrainChunk,
  chunkMeters: number,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(level.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(level.normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(level.colors, 3));
  const vertexCount = level.positions.length / 3;
  const uvs = new Float32Array(vertexCount * 2);
  for (let i = 0; i < vertexCount; i += 1) {
    uvs[i * 2] = (level.positions[i * 3] ?? 0) / 10;
    uvs[i * 2 + 1] = (level.positions[i * 3 + 2] ?? 0) / 10;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(level.indices, 1));
  const half = chunkMeters / 2;
  const verticalRadius = (result.maximumHeight - result.minimumHeight) / 2 + 4;
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, (result.maximumHeight + result.minimumHeight) / 2, 0),
    Math.hypot(half, half, verticalRadius),
  );
  return geometry;
}

function byteSize(meshes: readonly THREE.Mesh[]): number {
  let total = 0;
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    for (const attribute of Object.values(geometry.attributes)) total += attribute.array.byteLength;
    if (geometry.index) total += geometry.index.array.byteLength;
    if (mesh instanceof THREE.InstancedMesh) total += mesh.instanceMatrix.array.byteLength;
  }
  return total;
}

function objectByteSize(object: THREE.Object3D): number {
  let bytes = 0;
  object.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const geometry = node.geometry;
    for (const name of Object.keys(geometry.attributes))
      bytes += geometry.getAttribute(name).array.byteLength;
    if (geometry.index) bytes += geometry.index.array.byteLength;
  });
  return bytes;
}

function createBrandSign(slot: {
  readonly name: string;
  readonly position: readonly [number, number, number];
  readonly heading: number;
  readonly width: number;
}): THREE.Mesh {
  const name = slot.name || 'Tienda';
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#2a2520';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#f2e6c9';
    context.font = 'bold 26px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, canvas.width / 2, canvas.height / 2);
    context.strokeStyle = '#f2e6c9';
    context.lineWidth = 2;
    context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const geometry = new THREE.PlaneGeometry(Math.max(1.2, slot.width), 0.55);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(
    slot.position[0] + Math.sin(slot.heading) * 0.24,
    slot.position[1],
    slot.position[2] + Math.cos(slot.heading) * 0.24,
  );
  mesh.rotation.y = slot.heading;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function pointInPolygon(
  x: number,
  z: number,
  points: readonly (readonly [number, number])[],
): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i]?.[0] ?? 0;
    const zi = points[i]?.[1] ?? 0;
    const xj = points[j]?.[0] ?? 0;
    const zj = points[j]?.[1] ?? 0;
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distancePointToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  const cx = ax + dx * t;
  const cz = az + dz * t;
  return Math.hypot(px - cx, pz - cz);
}

export class ChunkManager {
  readonly events = new EventBus<TerrainChunkEvents>();
  readonly worker: Worker;
  private readonly scene: THREE.Scene;
  private readonly world: World;
  private readonly colliders: TerrainColliders;
  private readonly material = new THREE.MeshStandardMaterial({
    map: createTerrainDetailTexture(),
    vertexColors: true,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  private readonly roadRenderer = new RoadRenderer();
  private readonly buildingRenderer = new BuildingRenderer();
  private readonly cityKit: CityKit | undefined;
  private readonly debugOverlays: ChunkDebugOverlays;
  private readonly debugBorderMaterial = new THREE.LineBasicMaterial({
    color: '#f06d4e',
    depthTest: true,
    toneMapped: false,
  });
  private readonly records = new Map<string, ChunkRecord>();
  private readonly roadHeights = new Map<string, RoadHeightIndex>();
  private readonly completed: CompletedChunk[] = [];
  private manifest: WorldManifest | undefined;
  private assets: AssetManager | undefined;
  private manifestUrl: URL;
  private worldBaseUrl: URL;
  private readonly loadQueue: string[] = [];
  private workerBusy = false;
  private lastSchedule = 0;
  private memoryBytes = 0;
  private errorCount = 0;
  private closed = false;
  private debugBordersVisible = false;

  constructor(
    scene: THREE.Scene,
    physicsWorld: World,
    manifestUrl: URL,
    worldBaseUrl: URL,
    cityKitEnabled = false,
  ) {
    this.scene = scene;
    this.world = physicsWorld;
    this.cityKit = cityKitEnabled ? new CityKit(worldBaseUrl) : undefined;
    this.debugOverlays = new ChunkDebugOverlays(scene);
    this.colliders = new TerrainColliders(physicsWorld);
    this.manifestUrl = manifestUrl;
    this.worldBaseUrl = worldBaseUrl;
    this.worker = new Worker(new URL('./chunk-worker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', this.handleWorkerMessage);
  }

  async initialize(): Promise<void> {
    const response = await fetch(this.manifestUrl);
    if (!response.ok) throw new Error(`Could not load world manifest (${response.status}).`);
    const manifest = (await response.json()) as WorldManifest;
    if (manifest.schemaVersion !== 1 || !manifest.chunks.length || manifest.chunkMeters <= 0)
      throw new Error('World manifest is invalid or empty.');
    this.manifest = manifest;
  }

  async prepareRenderer(renderer: THREE.WebGLRenderer, camera: THREE.Camera): Promise<void> {
    this.assets = new AssetManager(renderer);
    await Promise.all([
      this.roadRenderer.prepare(renderer, this.scene, camera, this.material),
      this.buildingRenderer.prepare(renderer, this.scene, camera, this.material),
    ]);
    if (this.cityKit) await this.cityKit.prepare((url, priority) => this.loadModel(url, priority));
  }

  loadModel(url: string, priority = 0): Promise<GLTF> {
    if (!this.assets)
      return Promise.reject(new Error('The renderer must be prepared before loading models.'));
    return this.assets.loadModel(url, priority);
  }

  update(camera: THREE.Camera, now: number): void {
    if (this.closed || !this.manifest) return;
    this.processCompleted();
    for (const record of this.records.values()) {
      for (const stork of record.storks ?? []) updateStork(stork, camera.position, now);
    }
    if (now - this.lastSchedule < SCHEDULE_INTERVAL_MS) return;
    this.lastSchedule = now;
    const nextQueue: string[] = [];
    const x = camera.position.x;
    const z = camera.position.z;
    const loadRadius = this.manifest.chunkMeters * 2;
    const unloadRadius = this.manifest.chunkMeters * 2.4;
    const colliderRadius = this.manifest.chunkMeters * 0.75;
    for (const entry of this.manifest.chunks) {
      const distance = distanceToCenter(x, z, entry);
      let record = this.records.get(entry.id);
      if (record && distance > unloadRadius) {
        this.unload(record);
        this.records.delete(entry.id);
        record = undefined;
      }
      if (!record && distance <= loadRadius) {
        record = {
          entry,
          state: 'queued',
          distance,
          lod: this.lodForDistance(distance),
          memoryBytes: 0,
          debugMemoryBytes: 0,
          hasCollider: false,
        };
        this.records.set(entry.id, record);
      }
      if (!record) continue;
      record.distance = distance;
      if (record.state === 'queued' && distance <= unloadRadius) nextQueue.push(entry.id);
      if (record.state !== 'loaded') continue;
      this.setLod(record, this.lodForDistance(distance));
      const needsCollider = distance <= colliderRadius;
      if (needsCollider && !record.hasCollider && record.result) {
        this.addColliders(record);
      } else if (!needsCollider && record.hasCollider) {
        this.colliders.remove(entry.id);
        record.hasCollider = false;
        this.syncDebugOverlays(record);
      }
    }
    nextQueue.sort(
      (left, right) =>
        (this.records.get(left)?.distance ?? Infinity) -
        (this.records.get(right)?.distance ?? Infinity),
    );
    this.loadQueue.length = 0;
    this.loadQueue.push(...nextQueue);
    this.dispatchNext();
  }

  get loadedCount(): number {
    let count = 0;
    for (const record of this.records.values()) if (record.state === 'loaded') count += 1;
    return count;
  }

  get pendingCount(): number {
    let count = 0;
    for (const record of this.records.values())
      if (record.state === 'queued' || record.state === 'loading') count += 1;
    return count;
  }

  get colliderCount(): number {
    return this.colliders.count;
  }

  /** Keeps Rapier scene queries in sync before camera/vehicle raycasts. */
  refreshPhysicsQueries(): void {
    this.colliders.refreshQueries();
  }

  get memoryMiB(): number {
    return this.memoryBytes / (1024 * 1024);
  }

  get failures(): number {
    return this.errorCount;
  }

  collidesWithBuilding(x: number, z: number, radius = 0.4): boolean {
    for (const record of this.records.values()) {
      if (record.state !== 'loaded' || !record.result?.buildings) continue;
      for (const pts of record.result.buildings.footprints) {
        if (pts.length < 3) continue;
        if (pointInPolygon(x, z, pts)) return true;
        for (let i = 0; i < pts.length; i += 1) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          if (!a || !b) continue;
          if (distancePointToSegment(x, z, a[0], a[1], b[0], b[1]) < radius) return true;
        }
      }
    }
    return false;
  }

  cameraOcclusion(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    let best = maxDist;
    // Chunks may have been attached since the previous frame; castRay only sees
    // new colliders after the query pipeline has been rebuilt.
    this.colliders.refreshQueries();
    // Physics raycasts at several heights to catch walls of different heights.
    for (const yOffset of [0.4, 1.4, 2.6]) {
      const ray = new RAPIER.Ray(
        { x: origin.x, y: origin.y + yOffset, z: origin.z },
        { x: dir.x, y: dir.y, z: dir.z },
      );
      const hit = this.world.castRay(ray, maxDist, true);
      if (hit && hit.toi < best) best = hit.toi;
    }
    // Fallback: walk along the ray and stop when entering a building footprint.
    const steps = 24;
    for (let s = 1; s <= steps; s += 1) {
      const t = (s / steps) * maxDist;
      if (t >= best) break;
      const x = origin.x + dir.x * t;
      const z = origin.z + dir.z * t;
      if (this.collidesWithBuilding(x, z, 0.35)) {
        if (t < best) best = t;
        break;
      }
    }
    return best;
  }

  groundHeightAt(x: number, z: number): number | undefined {
    let height: number | undefined;
    for (const record of this.records.values()) {
      if (record.state !== 'loaded' || !record.result) continue;
      const bounds = record.entry.bounds;
      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) continue;
      height = sampleHeight(record.result, x, z);
      break;
    }
    if (height === undefined) return undefined;
    for (const record of this.records.values()) {
      if (record.state !== 'loaded') continue;
      const bounds = record.entry.bounds;
      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) continue;
      const roadHeight = this.roadHeights.get(record.entry.id)?.heightAt(x, z);
      if (roadHeight !== undefined && roadHeight > height) height = roadHeight;
    }
    return height;
  }

  setDebugBorders(visible: boolean): void {
    if (this.closed || this.debugBordersVisible === visible) return;
    this.debugBordersVisible = visible;
    for (const record of this.records.values()) {
      if (visible) this.addDebugBorder(record);
      else this.removeDebugBorder(record);
    }
  }

  setDebugColliders(visible: boolean): void {
    this.debugOverlays.setColliders(visible);
  }

  setDebugRoadSurfaces(visible: boolean): void {
    this.debugOverlays.setRoadSurfaces(visible);
  }

  setDebugLodBounds(visible: boolean): void {
    this.debugOverlays.setLodBounds(visible);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.removeEventListener('message', this.handleWorkerMessage);
    this.worker.terminate();
    for (const record of this.records.values()) this.unload(record, false);
    this.records.clear();
    this.colliders.clear();
    this.material.map?.dispose();
    this.material.dispose();
    this.roadRenderer.dispose();
    this.buildingRenderer.dispose();
    this.cityKit?.dispose();
    this.assets?.dispose();
    this.debugBorderMaterial.dispose();
    this.debugOverlays.dispose();
    this.events.clear();
    this.world.free();
  }

  private lodForDistance(distance: number): number {
    const chunkMeters = this.manifest?.chunkMeters ?? 256;
    return distance < chunkMeters * 0.68 ? 0 : distance < chunkMeters * 1.38 ? 1 : 2;
  }

  private setLod(record: ChunkRecord, lod: number): void {
    if (record.lod === lod) return;
    const current = record.meshes?.[record.lod];
    if (current) {
      current.visible = false;
      this.scene.remove(current);
    }
    for (const mesh of record.buildingMeshes?.[record.lod] ?? []) {
      mesh.visible = false;
      this.scene.remove(mesh);
    }
    for (const mesh of record.buildingDetailMeshes?.[record.lod] ?? []) {
      mesh.visible = false;
      this.scene.remove(mesh);
    }
    record.lod = lod;
    const next = record.meshes?.[lod];
    if (next) {
      next.visible = true;
      this.scene.add(next);
    }
    for (const mesh of record.buildingMeshes?.[lod] ?? []) {
      mesh.visible = true;
      this.scene.add(mesh);
    }
    for (const mesh of record.buildingDetailMeshes?.[lod] ?? []) {
      mesh.visible = true;
      this.scene.add(mesh);
    }
    for (const stork of record.storks ?? []) stork.visible = lod === 0;
    for (const sign of record.signs ?? []) sign.visible = lod === 0;
    this.syncDebugOverlays(record);
  }

  private processCompleted(): void {
    const start = performance.now();
    let attachments = 0;
    while (
      this.completed.length > 0 &&
      attachments < MAX_ATTACHMENTS_PER_FRAME &&
      performance.now() - start < GEOMETRY_BUDGET_MS
    ) {
      const item = this.completed.shift();
      if (!item) return;
      const record = this.records.get(item.id);
      if (!record || record.state !== 'loading' || !this.manifest) continue;
      const centerX = (record.entry.bounds.minX + record.entry.bounds.maxX) / 2;
      const centerZ = (record.entry.bounds.minZ + record.entry.bounds.maxZ) / 2;
      const meshes = item.result.levels.map((level) => {
        const mesh = new THREE.Mesh(
          geometryForLod(level, item.result, this.manifest?.chunkMeters ?? 256),
          this.material,
        );
        mesh.position.set(centerX, 0, centerZ);
        mesh.visible = level.level === record.lod;
        mesh.receiveShadow = true;
        return mesh;
      });
      const activeMesh = meshes[record.lod];
      if (activeMesh) this.scene.add(activeMesh);
      const kitActive = this.cityKit?.isReady === true;
      const decorationMeshes = this.roadRenderer.createMeshes(
        item.result.roads,
        centerX,
        centerZ,
        !kitActive,
      );
      if (kitActive && this.cityKit) {
        decorationMeshes.push(
          ...this.cityKit.createRoadPropMeshes(item.result.roads, centerX, centerZ, record.lod),
        );
      }
      for (const mesh of decorationMeshes) this.scene.add(mesh);
      const buildingDetailMeshes =
        kitActive && this.cityKit
          ? this.cityKit.createBuildingDetailMeshesByLod(item.result.buildings, centerX, centerZ)
          : [[], [], []];
      for (const mesh of buildingDetailMeshes[record.lod] ?? []) {
        mesh.visible = true;
        this.scene.add(mesh);
      }
      const buildingMeshes = this.buildingRenderer.createMeshes(
        item.result.buildings,
        centerX,
        centerZ,
      );
      for (const mesh of buildingMeshes[record.lod] ?? []) {
        mesh.visible = true;
        this.scene.add(mesh);
      }
      record.result = item.result;
      if (item.result.roads)
        this.roadHeights.set(item.id, new RoadHeightIndex(item.result.roads, record.entry.bounds));
      record.meshes = meshes;
      record.buildingMeshes = buildingMeshes;
      record.buildingDetailMeshes = buildingDetailMeshes;
      record.decorationMeshes = decorationMeshes;
      record.storks = (item.result.buildings?.storks ?? []).map((instance) => {
        const stork = createStork();
        stork.position.set(instance.position[0], instance.position[1], instance.position[2]);
        stork.rotation.y = ((instance.buildingId.length % 8) * Math.PI) / 4;
        stork.visible = record.lod === 0;
        this.scene.add(stork);
        return stork;
      });
      record.signs = (item.result.buildings?.signSlots ?? []).map((slot) => {
        const mesh = createBrandSign(slot);
        mesh.visible = record.lod === 0;
        this.scene.add(mesh);
        return mesh;
      });
      const roadBuffers = item.result.roads;
      const roadDataBytes = roadBuffers
        ? roadBuffers.colliderPositions.byteLength +
          roadBuffers.colliderIndices.byteLength +
          roadBuffers.props.reduce(
            (sum, prop) => sum + prop.positions.byteLength + prop.headings.byteLength,
            0,
          )
        : 0;
      const buildingDataBytes = item.result.buildings
        ? item.result.buildings.colliderPositions.byteLength +
          item.result.buildings.colliderIndices.byteLength
        : 0;
      record.memoryBytes =
        byteSize([...meshes, ...decorationMeshes, ...buildingMeshes.flat()]) +
        item.result.heights.byteLength +
        roadDataBytes +
        buildingDataBytes;
      record.state = 'loaded';
      this.memoryBytes += record.memoryBytes;
      this.addDebugBorder(record);
      this.syncDebugOverlays(record);
      this.events.emit('chunkLoaded', {
        id: item.id,
        lod: record.lod,
        memoryBytes: record.memoryBytes,
      });
      this.syncCollider(record);
      this.loadLandmarkModels(record, item.result);
      attachments += 1;
    }
  }

  private syncCollider(record: ChunkRecord): void {
    if (!record.result || !this.manifest) return;
    if (record.distance <= this.manifest.chunkMeters * 0.75 && !record.hasCollider)
      this.addColliders(record);
  }

  private addColliders(record: ChunkRecord): void {
    if (!record.result || !this.manifest || record.hasCollider) return;
    this.colliders.add(
      record.entry.id,
      record.entry.bounds,
      this.manifest.chunkMeters,
      record.result.heights,
      record.result.samples,
    );
    const centerX = (record.entry.bounds.minX + record.entry.bounds.maxX) / 2;
    const centerZ = (record.entry.bounds.minZ + record.entry.bounds.maxZ) / 2;
    const roads = record.result.roads;
    if (roads)
      this.colliders.addRoads(
        record.entry.id,
        centerX,
        centerZ,
        roads.colliderPositions,
        roads.colliderIndices,
      );
    const buildings = record.result.buildings;
    if (buildings)
      this.colliders.addBuildings(
        record.entry.id,
        centerX,
        centerZ,
        buildings.colliderPositions,
        buildings.colliderIndices,
      );
    record.hasCollider = true;
    this.syncDebugOverlays(record);
  }

  private syncDebugOverlays(record: ChunkRecord): void {
    if (!record.result) return;
    this.debugOverlays.updateChunk({
      entry: record.entry,
      result: record.result,
      terrainGeometry: record.meshes?.[record.lod]?.geometry,
      lod: record.lod,
      hasCollider: record.hasCollider,
    });
  }

  private loadLandmarkModels(record: ChunkRecord, result: BuiltTerrainChunk): void {
    const models = result.buildings?.landmarkModels ?? [];
    if (!this.assets || models.length === 0) return;
    for (const instance of models) {
      if (!/^landmarks\/w\d+\.glb$/.test(instance.path)) continue;
      const url = new URL(instance.path, this.worldBaseUrl);
      void this.assets
        .loadModel(url.href, 10)
        .then((gltf: GLTF) => {
          if (
            this.closed ||
            this.records.get(record.entry.id) !== record ||
            record.state !== 'loaded'
          )
            return;
          const object = gltf.scene.clone(true);
          object.position.set(instance.position[0], instance.position[1], instance.position[2]);
          object.traverse((node) => {
            if (node instanceof THREE.Mesh) {
              node.castShadow = true;
              node.receiveShadow = true;
            }
          });
          this.scene.add(object);
          record.landmarkObjects ??= [];
          record.landmarkObjects.push(object);
          const bytes = objectByteSize(object);
          record.memoryBytes += bytes;
          this.memoryBytes += bytes;
        })
        .catch((error: unknown) => {
          this.errorCount += 1;
          console.error(`Could not load landmark model ${instance.path}.`, error);
        });
    }
  }

  private addDebugBorder(record: ChunkRecord): void {
    if (!this.debugBordersVisible || !record.result || record.debugBorder) return;
    const geometry = buildChunkBorderGeometry(record.result);
    const border = new THREE.LineSegments(geometry, this.debugBorderMaterial);
    this.scene.add(border);
    record.debugBorder = border;
    record.debugMemoryBytes = geometry.attributes.position?.array.byteLength ?? 0;
    this.memoryBytes += record.debugMemoryBytes;
  }

  private removeDebugBorder(record: ChunkRecord): void {
    if (!record.debugBorder) return;
    this.scene.remove(record.debugBorder);
    record.debugBorder.geometry.dispose();
    record.debugBorder = undefined;
    this.memoryBytes = Math.max(0, this.memoryBytes - record.debugMemoryBytes);
    record.debugMemoryBytes = 0;
  }

  private dispatchNext(): void {
    if (this.workerBusy || this.loadQueue.length === 0 || !this.manifest || this.closed) return;
    const id = this.loadQueue.shift();
    const record = id ? this.records.get(id) : undefined;
    if (!id || !record || record.state !== 'queued') {
      this.dispatchNext();
      return;
    }
    this.workerBusy = true;
    record.state = 'loading';
    void this.fetchAndSend(record);
  }

  private async fetchAndSend(record: ChunkRecord): Promise<void> {
    try {
      if (record.entry.path !== `${record.entry.id}.bin` || record.entry.bytes > MAX_CHUNK_BYTES)
        throw new Error(`Unsafe chunk path or size: ${record.entry.id}`);
      const url = new URL(`world/${this.manifest?.region}/${record.entry.path}`, this.worldBaseUrl);
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`Could not load chunk ${record.entry.id} (${response.status}).`);
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength !== record.entry.bytes || buffer.byteLength > MAX_CHUNK_BYTES)
        throw new Error(`Chunk ${record.entry.id} size check failed.`);
      const actualHash = toHex(await crypto.subtle.digest('SHA-256', buffer));
      if (actualHash !== record.entry.sha256)
        throw new Error(`Chunk ${record.entry.id} integrity check failed.`);
      this.worker.postMessage({ id: record.entry.id, buffer }, [buffer]);
    } catch (error) {
      this.workerBusy = false;
      record.state = 'error';
      this.errorCount += 1;
      console.error(error);
      this.dispatchNext();
    }
  }

  private readonly handleWorkerMessage = (event: MessageEvent<WorkerResponse>): void => {
    this.workerBusy = false;
    const record = this.records.get(event.data.id);
    if (event.data.result && record?.state === 'loading')
      this.completed.push({ id: event.data.id, result: event.data.result });
    else if (event.data.error && record) {
      record.state = 'error';
      this.errorCount += 1;
      console.error(event.data.error);
    }
    this.dispatchNext();
  };

  private unload(record: ChunkRecord, emit = true): void {
    this.roadHeights.delete(record.entry.id);
    this.removeDebugBorder(record);
    this.debugOverlays.removeChunk(record.entry.id);
    if (record.hasCollider) this.colliders.remove(record.entry.id);
    if (record.meshes) {
      for (const mesh of record.meshes) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
      }
      this.memoryBytes = Math.max(0, this.memoryBytes - record.memoryBytes);
    }
    if (record.decorationMeshes) {
      for (const mesh of record.decorationMeshes) {
        this.scene.remove(mesh);
        // CityKit instances reuse geometry across chunks; only procedural meshes own it.
        if (mesh.geometry.userData.sharedGeometry !== true) mesh.geometry.dispose();
      }
    }
    if (record.buildingMeshes) {
      for (const level of record.buildingMeshes) {
        for (const mesh of level) {
          this.scene.remove(mesh);
          mesh.geometry.dispose();
        }
      }
    }
    if (record.buildingDetailMeshes) {
      for (const level of record.buildingDetailMeshes) {
        for (const mesh of level) {
          this.scene.remove(mesh);
          if (mesh.geometry.userData.sharedGeometry !== true) mesh.geometry.dispose();
        }
      }
    }
    if (record.landmarkObjects)
      for (const object of record.landmarkObjects) this.scene.remove(object);
    if (record.storks) for (const stork of record.storks) this.scene.remove(stork);
    if (record.signs)
      for (const sign of record.signs) {
        this.scene.remove(sign);
        (sign.material as THREE.Material).dispose();
        sign.geometry.dispose();
        (sign.material as { map?: THREE.Texture }).map?.dispose();
      }
    if (emit && record.state === 'loaded')
      this.events.emit('chunkUnloaded', { id: record.entry.id });
  }
}
