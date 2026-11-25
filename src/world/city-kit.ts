import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type {
  BuildingDetailKind,
  BuiltBuildingChunk,
  BuiltRoadChunk,
  RoadPropBatch,
} from './types';

type LoadModel = (url: string, priority?: number) => Promise<GLTF>;

interface KitPart {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
}

interface KitModel {
  readonly lod0: readonly KitPart[];
  readonly lod1: readonly KitPart[];
}

interface Placement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly scale: number;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

const ROAD_KIT_NAMES: Record<RoadPropBatch['kind'], string> = {
  street_lamp: 'street-lamp',
  street_lamp_modern: 'street-lamp-modern',
  tree: 'tree',
  tree_deciduous: 'tree-deciduous',
  tree_oak: 'tree-oak',
  tree_pine: 'tree-pine',
  tree_palm: 'tree-palm',
  tree_cypress: 'tree-cypress',
  shrub: 'shrub',
  hedge: 'hedge',
  bus_shelter: 'bus-shelter',
  bench: 'park-bench',
  waste_basket: 'waste-bin',
  fountain: 'fountain',
  traffic_signals: 'traffic-signals',
  stop: 'stop-sign',
  give_way: 'give-way-sign',
};

const BUILDING_KIT_NAMES: Record<BuildingDetailKind, string> = {
  balcony: 'balcony',
  balcony_modern: 'balcony-modern',
  window_casco: 'window-casco',
  window_ensanche: 'window-ensanche',
  window_modern: 'window-modern',
  window_awning: 'window-awning',
  portal_casco: 'portal-casco',
  portal_modern: 'portal-modern',
  shopfront_awning: 'shopfront-awning',
  industrial_door: 'industrial-door',
  pilaster_corner: 'pilaster-corner',
  chimney: 'chimney',
  dormer_roof: 'dormer-roof',
  rooftop_penthouse: 'rooftop-penthouse',
  rooftop_hvac: 'rooftop-hvac',
  rooftop_solar: 'rooftop-solar',
  bell_gable: 'bell-gable',
  corner_turret: 'corner-turret',
  heraldic_crest: 'heraldic-crest',
};

const KIT_NAMES = [...Object.values(ROAD_KIT_NAMES), ...Object.values(BUILDING_KIT_NAMES)] as const;

function partsFromGltf(gltf: GLTF, sharedMaterials: Map<string, THREE.Material>): KitPart[] {
  gltf.scene.updateMatrixWorld(true);
  const parts: KitPart[] = [];
  gltf.scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const source = Array.isArray(node.material) ? node.material[0] : node.material;
    if (!source) return;
    let material = source;
    if (source.name.startsWith('kit_atlas')) {
      const existing = sharedMaterials.get('kit_atlas');
      if (existing) {
        material = existing;
      } else {
        if (source instanceof THREE.MeshStandardMaterial && source.map) {
          source.map.magFilter = THREE.NearestFilter;
          source.map.minFilter = THREE.LinearFilter;
          source.map.generateMipmaps = false;
          source.map.needsUpdate = true;
        }
        sharedMaterials.set('kit_atlas', source);
      }
    }
    const geometry = node.geometry.clone();
    geometry.applyMatrix4(node.matrixWorld);
    geometry.userData.sharedGeometry = true;
    parts.push({ geometry, material });
  });
  return parts;
}

function hashId(id: string): number {
  let hash = 7;
  for (let index = 0; index < id.length; index += 1)
    hash = (hash * 31 + (id.charCodeAt(index) | 0)) >>> 0;
  return hash;
}

const LOD1_ROAD_PROP_KINDS = new Set<string>([
  'tree',
  'tree_deciduous',
  'tree_oak',
  'tree_pine',
  'tree_palm',
  'tree_cypress',
  'bus_shelter',
  'fountain',
]);

const SHADOW_CASTING_KINDS = new Set<string>([
  'rooftop_penthouse',
  'chimney',
  'bell_gable',
  'corner_turret',
  'tree',
  'tree_deciduous',
  'tree_oak',
  'tree_pine',
  'tree_palm',
  'tree_cypress',
  'bus_shelter',
  'fountain',
]);

function instanceParts(
  parts: readonly KitPart[],
  placements: readonly Placement[],
  centerX: number,
  centerZ: number,
  localCoordinates: boolean,
  castShadow: boolean,
): THREE.Mesh[] {
  if (placements.length === 0) return [];
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const meshes: THREE.Mesh[] = [];
  for (const part of parts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, placements.length);
    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index];
      if (!placement) continue;
      rotation.setFromAxisAngle(Y_AXIS, placement.heading);
      scale.setScalar(placement.scale);
      position.set(
        placement.x + (localCoordinates ? centerX : 0),
        placement.y,
        placement.z + (localCoordinates ? centerZ : 0),
      );
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  return meshes;
}

/** GLB-based street furniture and architectural building details for the Cáceres city kit. */
export class CityKit {
  private readonly baseUrl: URL;
  private readonly models = new Map<string, KitModel>();
  private readonly sharedMaterials = new Map<string, THREE.Material>();
  private ready = false;

  constructor(worldBaseUrl: URL) {
    this.baseUrl = new URL('models/citykit/', worldBaseUrl);
  }

  get isReady(): boolean {
    return this.ready;
  }

  async prepare(load: LoadModel): Promise<void> {
    const lod0Parts = new Map<string, KitPart[]>();
    const lod1Parts = new Map<string, KitPart[]>();
    const requests: Promise<void>[] = [];
    this.sharedMaterials.clear();
    for (const name of KIT_NAMES) {
      requests.push(
        load(this.url(name, 0), 20).then((gltf) => {
          lod0Parts.set(name, partsFromGltf(gltf, this.sharedMaterials));
        }),
        load(this.url(name, 1), 20).then((gltf) => {
          lod1Parts.set(name, partsFromGltf(gltf, this.sharedMaterials));
        }),
      );
    }
    const results = await Promise.allSettled(requests);
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0)
      console.warn(`[citykit] ${failures.length} model(s) failed to load; using baseline props.`);
    this.models.clear();
    for (const name of KIT_NAMES) {
      this.models.set(name, {
        lod0: lod0Parts.get(name) ?? [],
        lod1: lod1Parts.get(name) ?? [],
      });
    }
    this.ready = failures.length === 0;
  }

  createRoadPropMeshes(
    roads: BuiltRoadChunk | undefined,
    centerX: number,
    centerZ: number,
    lod: number,
  ): THREE.Mesh[] {
    if (!this.ready || !roads || lod >= 2) return [];
    const meshes: THREE.Mesh[] = [];
    for (const batch of roads.props) {
      if (lod === 1 && !LOD1_ROAD_PROP_KINDS.has(batch.kind)) continue;
      const name = ROAD_KIT_NAMES[batch.kind];
      const model = this.models.get(name);
      if (!model) continue;
      const placements = this.placementsFromBatch(batch, lod === 0 ? model.lod0 : model.lod1);
      const castShadow = lod === 0 && SHADOW_CASTING_KINDS.has(batch.kind);
      meshes.push(
        ...instanceParts(
          placements.parts,
          placements.positions,
          centerX,
          centerZ,
          true,
          castShadow,
        ),
      );
    }
    return meshes;
  }

  createBuildingDetailMeshesByLod(
    buildings: BuiltBuildingChunk | undefined,
    centerX: number,
    centerZ: number,
    castExtraShadows = false,
  ): THREE.Mesh[][] {
    if (!this.ready || !buildings) return [[], [], []];
    if (!buildings.detailBatches || buildings.detailBatches.length === 0) {
      return [
        this.createLegacyDetailMeshes(buildings, centerX, centerZ, 0),
        this.createLegacyDetailMeshes(buildings, centerX, centerZ, 1),
        [],
      ];
    }
    const lod0Meshes: THREE.Mesh[] = [];
    const lod1Meshes: THREE.Mesh[] = [];
    for (const batch of buildings.detailBatches) {
      const name = BUILDING_KIT_NAMES[batch.kind];
      const model = this.models.get(name);
      if (!model) continue;
      const count = Math.min(
        batch.positions.length / 3,
        batch.headings.length,
        batch.scales.length,
      );
      if (count === 0) continue;
      const placements: Placement[] = [];
      for (let i = 0; i < count; i += 1) {
        const offset = i * 3;
        placements.push({
          x: batch.positions[offset] ?? 0,
          y: batch.positions[offset + 1] ?? 0,
          z: batch.positions[offset + 2] ?? 0,
          heading: batch.headings[i] ?? 0,
          scale: batch.scales[i] ?? 1,
        });
      }
      const castShadow =
        SHADOW_CASTING_KINDS.has(batch.kind) ||
        (castExtraShadows &&
          (batch.kind === 'balcony' ||
            batch.kind === 'balcony_modern' ||
            batch.kind === 'shopfront_awning' ||
            batch.kind === 'portal_casco' ||
            batch.kind === 'portal_modern' ||
            batch.kind === 'dormer_roof'));
      lod0Meshes.push(
        ...instanceParts(model.lod0, placements, centerX, centerZ, false, castShadow),
      );
      if (batch.maxLod >= 1) {
        lod1Meshes.push(...instanceParts(model.lod1, placements, centerX, centerZ, false, false));
      }
    }
    return [lod0Meshes, lod1Meshes, []];
  }

  createBuildingDetailMeshes(
    buildings: BuiltBuildingChunk | undefined,
    centerX: number,
    centerZ: number,
    lod: number,
  ): THREE.Mesh[] {
    return this.createBuildingDetailMeshesByLod(buildings, centerX, centerZ)[lod] ?? [];
  }

  dispose(): void {
    for (const model of this.models.values()) {
      for (const part of [...model.lod0, ...model.lod1]) part.geometry.dispose();
    }
    for (const mat of this.sharedMaterials.values()) {
      if (mat instanceof THREE.MeshStandardMaterial) mat.map?.dispose();
      mat.dispose();
    }
    this.models.clear();
    this.sharedMaterials.clear();
    this.ready = false;
  }

  private createLegacyDetailMeshes(
    buildings: BuiltBuildingChunk,
    centerX: number,
    centerZ: number,
    lod: number,
  ): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    const chimneys = this.models.get('chimney');
    if (chimneys) {
      const parts = lod === 0 ? chimneys.lod0 : chimneys.lod1;
      const placements: Placement[] = [];
      for (const anchor of buildings.roofAnchors) {
        const hash = hashId(anchor.buildingId);
        if (hash % 3 === 0) continue;
        placements.push({
          x: anchor.position[0],
          y: anchor.position[1],
          z: anchor.position[2],
          heading: (hash % 8) * (Math.PI / 4),
          scale: 0.85 + ((hash >>> 5) % 4) * 0.1,
        });
      }
      meshes.push(...instanceParts(parts, placements, centerX, centerZ, false, lod === 0));
    }
    const balconies = this.models.get('balcony');
    if (balconies) {
      const parts = lod === 0 ? balconies.lod0 : balconies.lod1;
      const placements: Placement[] = buildings.signSlots.map((slot) => ({
        x: slot.position[0],
        y: slot.position[1] - 1.1,
        z: slot.position[2],
        heading: slot.heading,
        scale: THREE.MathUtils.clamp(slot.width / 1.3, 0.75, 1.5),
      }));
      meshes.push(...instanceParts(parts, placements, centerX, centerZ, false, lod === 0));
    }
    return meshes;
  }

  private url(name: string, lod: number): string {
    return new URL(`${name}-lod${lod}.glb`, this.baseUrl).href;
  }

  private placementsFromBatch(
    batch: RoadPropBatch,
    parts: readonly KitPart[],
  ): { parts: readonly KitPart[]; positions: Placement[] } {
    const count = Math.min(batch.positions.length / 3, batch.headings.length);
    const positions: Placement[] = [];
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      const x = batch.positions[offset];
      const y = batch.positions[offset + 1];
      const z = batch.positions[offset + 2];
      if (x === undefined || y === undefined || z === undefined) continue;
      const isTree = batch.kind.startsWith('tree');
      const vary = isTree
        ? 0.8 + ((index * 37) % 6) * 0.08
        : batch.kind === 'shrub'
          ? 0.78 + ((index * 23) % 5) * 0.11
          : 1;
      const heading =
        isTree || batch.kind === 'shrub'
          ? (index * 1.618) % (Math.PI * 2)
          : (batch.headings[index] ?? 0);
      positions.push({
        x,
        y,
        z,
        heading,
        scale: vary,
      });
    }
    return { parts, positions };
  }
}
