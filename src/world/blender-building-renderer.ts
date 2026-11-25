/**
 * GPU-instanced Three.js renderer for System A Blender building GLBs (FASE B + FASE C).
 *
 * Shares at most 2 global PBR materials across the entire 8-building library (CC_Atlas_Opaque
 * + CC_Atlas_Glass), rendering each chunk's placements in 2x2 sub-quadrants with dynamic
 * LOD0 (< 95m) -> LOD1 (< 205m) -> LOD2 (>= 205m) InstancedMesh switching.
 */

import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type {
  BlenderBuildingPlacement,
  BlenderModelKey,
  BuiltBuildingChunk,
  ProjectedBounds,
} from './types';

type LoadModel = (url: string, priority?: number) => Promise<GLTF>;

interface ManifestModelEntry {
  readonly key: BlenderModelKey;
  readonly centerOffsetX?: number;
  readonly centerOffsetZ?: number;
}

interface ManifestPayload {
  readonly models: readonly ManifestModelEntry[];
}

interface ModelPart {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
}

interface LoadedModelLods {
  readonly lod0: readonly ModelPart[];
  readonly lod1: readonly ModelPart[];
  readonly lod2: readonly ModelPart[];
}

export interface BlenderQuadrantCell {
  readonly centerX: number;
  readonly centerZ: number;
  readonly lods: readonly [THREE.Mesh[], THREE.Mesh[], THREE.Mesh[]];
  activeLod: -1 | 0 | 1 | 2;
}

export class BlenderBuildingRenderer {
  private readonly baseUrl: URL;
  private readonly models = new Map<BlenderModelKey, LoadedModelLods>();
  private readonly sharedMaterials = new Map<string, THREE.Material>();
  private ready = false;
  private preparePromise: Promise<void> | undefined;

  constructor(worldBaseUrl: URL) {
    this.baseUrl = new URL('models/buildings/', worldBaseUrl);
  }

  get isReady(): boolean {
    return this.ready;
  }

  get sharedMaterialCount(): number {
    return this.sharedMaterials.size;
  }

  async prepare(loadModel: LoadModel): Promise<void> {
    if (this.preparePromise) return this.preparePromise;
    this.preparePromise = this.loadLibrary(loadModel);
    return this.preparePromise;
  }

  private async loadLibrary(loadModel: LoadModel): Promise<void> {
    const manifestUrl = new URL('manifest.json', this.baseUrl).href;
    const response = await fetch(manifestUrl);
    if (!response.ok)
      throw new Error(`No se pudo cargar manifest.json de edificios Blender (${response.status}).`);
    const manifest = (await response.json()) as ManifestPayload;

    this.sharedMaterials.clear();
    const lod0Parts = new Map<BlenderModelKey, ModelPart[]>();
    const lod1Parts = new Map<BlenderModelKey, ModelPart[]>();
    const lod2Parts = new Map<BlenderModelKey, ModelPart[]>();
    const tasks: Promise<void>[] = [];

    for (const entry of manifest.models) {
      const cx = entry.centerOffsetX ?? 0;
      const cz = entry.centerOffsetZ ?? 0;
      tasks.push(
        loadModel(new URL(`${entry.key}-lod0.glb`, this.baseUrl).href, 35).then((gltf) => {
          lod0Parts.set(entry.key, this.extractSharedParts(gltf, cx, cz));
        }),
        loadModel(new URL(`${entry.key}-lod1.glb`, this.baseUrl).href, 35).then((gltf) => {
          lod1Parts.set(entry.key, this.extractSharedParts(gltf, cx, cz));
        }),
        loadModel(new URL(`${entry.key}-lod2.glb`, this.baseUrl).href, 35).then((gltf) => {
          lod2Parts.set(entry.key, this.extractSharedParts(gltf, cx, cz));
        }),
      );
    }

    await Promise.all(tasks);
    this.models.clear();
    for (const entry of manifest.models) {
      this.models.set(entry.key, {
        lod0: lod0Parts.get(entry.key) ?? [],
        lod1: lod1Parts.get(entry.key) ?? [],
        lod2: lod2Parts.get(entry.key) ?? [],
      });
    }
    this.ready = this.models.size > 0;
  }

  private extractSharedParts(gltf: GLTF, offsetX: number, offsetZ: number): ModelPart[] {
    gltf.scene.updateMatrixWorld(true);
    const parts: ModelPart[] = [];
    gltf.scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const srcMat = Array.isArray(node.material) ? node.material[0] : node.material;
      if (!srcMat) return;
      const sharedMat = this.internSharedAtlasMaterial(srcMat);
      const geometry = node.geometry.clone();
      geometry.applyMatrix4(node.matrixWorld);
      if (offsetX !== 0 || offsetZ !== 0) geometry.translate(-offsetX, 0, -offsetZ);
      geometry.computeBoundingSphere();
      geometry.userData.sharedGeometry = true;
      parts.push({ geometry, material: sharedMat });
    });
    return parts;
  }

  private internSharedAtlasMaterial(source: THREE.Material): THREE.Material {
    const key = source.name.startsWith('CC_Atlas_Glass') ? 'CC_Atlas_Glass' : 'CC_Atlas_Opaque';
    const existing = this.sharedMaterials.get(key);
    if (existing) return existing;

    if (source instanceof THREE.MeshStandardMaterial) {
      for (const tex of [
        source.map,
        source.roughnessMap,
        source.metalnessMap,
        source.emissiveMap,
      ]) {
        if (!tex) continue;
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
      }
      if (key === 'CC_Atlas_Glass') {
        source.emissiveIntensity = 0.45;
      }
    }
    this.sharedMaterials.set(key, source);
    return source;
  }

  setNight(enabled: boolean): void {
    const glass = this.sharedMaterials.get('CC_Atlas_Glass');
    if (glass instanceof THREE.MeshStandardMaterial) {
      glass.emissiveIntensity = enabled ? 1.45 : 0.45;
    }
  }

  /**
   * Partition a chunk's placed buildings into 2x2 spatial quadrants so only the quadrant(s)
   * within close proximity render full LOD0 detail, keeping total scene triangles <= 600k.
   */
  createQuadrantCells(
    buildings: BuiltBuildingChunk | undefined,
    bounds: ProjectedBounds,
  ): BlenderQuadrantCell[] {
    const placements = buildings?.blenderPlacements;
    if (!this.ready || !placements || placements.length === 0) return [];

    const midX = (bounds.minX + bounds.maxX) * 0.5;
    const midZ = (bounds.minZ + bounds.maxZ) * 0.5;
    const quadSpan = (bounds.maxX - bounds.minX) * 0.25;

    const buckets: BlenderBuildingPlacement[][] = [[], [], [], []];
    for (const p of placements) {
      const qx = p.x >= midX ? 1 : 0;
      const qz = p.z >= midZ ? 1 : 0;
      buckets[qz * 2 + qx]?.push(p);
    }

    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const cells: BlenderQuadrantCell[] = [];

    for (let idx = 0; idx < 4; idx += 1) {
      const list = buckets[idx];
      if (!list || list.length === 0) continue;
      const qx = idx % 2;
      const qz = idx >> 1;
      const cellCx = midX + (qx === 0 ? -quadSpan : quadSpan);
      const cellCz = midZ + (qz === 0 ? -quadSpan : quadSpan);

      const byModel = new Map<BlenderModelKey, BlenderBuildingPlacement[]>();
      for (const p of list) {
        const group = byModel.get(p.modelKey);
        if (group) group.push(p);
        else byModel.set(p.modelKey, [p]);
      }

      const lod0Meshes: THREE.Mesh[] = [];
      const lod1Meshes: THREE.Mesh[] = [];
      const lod2Meshes: THREE.Mesh[] = [];

      for (const [key, items] of byModel) {
        const loaded = this.models.get(key);
        if (!loaded) continue;

        const buildInstances = (
          parts: readonly ModelPart[],
          castShadow: boolean,
          out: THREE.Mesh[],
        ): void => {
          for (const part of parts) {
            const mesh = new THREE.InstancedMesh(part.geometry, part.material, items.length);
            for (let i = 0; i < items.length; i += 1) {
              const item = items[i];
              if (!item) continue;
              pos.set(item.x, item.y, item.z);
              quat.setFromAxisAngle(yAxis, item.heading);
              scale.set(item.scaleX, item.scaleY, item.scaleZ);
              matrix.compose(pos, quat, scale);
              mesh.setMatrixAt(i, matrix);
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.computeBoundingSphere();
            mesh.castShadow = castShadow;
            mesh.receiveShadow = true;
            mesh.visible = false;
            out.push(mesh);
          }
        };

        buildInstances(loaded.lod0, true, lod0Meshes);
        buildInstances(loaded.lod1, false, lod1Meshes);
        buildInstances(loaded.lod2, false, lod2Meshes);
      }

      cells.push({
        centerX: cellCx,
        centerZ: cellCz,
        lods: [lod0Meshes, lod1Meshes, lod2Meshes],
        activeLod: -1,
      });
    }

    return cells;
  }

  dispose(): void {
    for (const loaded of this.models.values()) {
      for (const part of [...loaded.lod0, ...loaded.lod1, ...loaded.lod2]) part.geometry.dispose();
    }
    for (const mat of this.sharedMaterials.values()) {
      if (mat instanceof THREE.MeshStandardMaterial) {
        mat.map?.dispose();
        mat.roughnessMap?.dispose();
        mat.metalnessMap?.dispose();
        mat.emissiveMap?.dispose();
      }
      mat.dispose();
    }
    this.models.clear();
    this.sharedMaterials.clear();
    this.ready = false;
    this.preparePromise = undefined;
  }
}
