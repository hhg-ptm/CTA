/**
 * GPU-instanced Three.js renderer for System A Blender building GLBs (FASE B + FASE C).
 *
 * Shares at most 2 global PBR materials across the entire 8-building library (CC_Atlas_Opaque
 * + CC_Atlas_Glass), rendering each chunk's placements in 3x3 subcells (~85m) with dynamic
 * tiered LOD0 -> LOD1 -> LOD2 switching plus dedicated LOD2 shadow-caster proxies.
 */

import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type {
  BlenderBuildingPlacement,
  BlenderModelKey,
  BuiltBuildingChunk,
  ProjectedBounds,
} from './types';

export const SHADOW_PROXY_LAYER = 1;

export type BlenderShadowMode = 'none' | 'lod0' | 'lod1' | 'lod2' | 'proxy';

type LoadModel = (url: string, priority?: number) => Promise<GLTF>;

interface ManifestModelEntry {
  readonly key: BlenderModelKey;
  readonly centerOffsetX?: number;
  readonly centerOffsetZ?: number;
}

interface ManifestPayload {
  readonly models: readonly ManifestModelEntry[];
  readonly variants?: readonly ManifestModelEntry[];
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
  readonly halfExtentX: number;
  readonly halfExtentZ: number;
  readonly lods: readonly [THREE.Mesh[], THREE.Mesh[], THREE.Mesh[]];
  readonly shadowProxies: THREE.Mesh[];
  activeLod: -1 | 0 | 1 | 2;
  activeShadowMode: BlenderShadowMode;
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

    const allEntries = [...manifest.models, ...(manifest.variants ?? [])];
    for (const entry of allEntries) {
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
    for (const entry of allEntries) {
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

  private getShadowProxyMaterial(): THREE.Material {
    let mat = this.sharedMaterials.get('CC_Shadow_Proxy');
    if (!mat) {
      mat = new THREE.MeshBasicMaterial();
      this.sharedMaterials.set('CC_Shadow_Proxy', mat);
    }
    return mat;
  }

  private appendModelInstancedMeshes(
    parts: readonly ModelPart[],
    items: readonly BlenderBuildingPlacement[],
    overrideMaterial: THREE.Material | null,
    shadowOnlyLayer: boolean,
    out: THREE.Mesh[],
  ): void {
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const tintColor = new THREE.Color();

    for (const part of parts) {
      part.geometry.userData.sharedGeometry = true;
      const mat = overrideMaterial ?? part.material;
      const useTint = !shadowOnlyLayer && !mat.transparent;
      const mesh = new THREE.InstancedMesh(part.geometry, mat, items.length);
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (!item) continue;
        pos.set(item.x, item.y, item.z);
        quat.setFromAxisAngle(yAxis, item.heading);
        scale.set(item.scaleX, item.scaleY, item.scaleZ);
        matrix.compose(pos, quat, scale);
        mesh.setMatrixAt(i, matrix);
        if (useTint) {
          tintColor.setHex(item.tint ?? 0xffffff);
          mesh.setColorAt(i, tintColor);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (useTint && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = shadowOnlyLayer;
      mesh.receiveShadow = !shadowOnlyLayer;
      mesh.visible = false;
      if (shadowOnlyLayer) {
        mesh.layers.set(SHADOW_PROXY_LAYER);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
      }
      out.push(mesh);
    }
  }

  /**
   * Partition a chunk's placed buildings into 3x3 spatial subcells (~85m each) so only
   * foreground blocks render LOD0 detail while mid-ground blocks can use lightweight LOD2
   * shadow-caster proxies.
   */
  createQuadrantCells(
    buildings: BuiltBuildingChunk | undefined,
    bounds: ProjectedBounds,
  ): BlenderQuadrantCell[] {
    const placements = buildings?.blenderPlacements;
    if (!this.ready || !placements || placements.length === 0) return [];

    const SUBCELL_DIVS = 3;
    const spanX = bounds.maxX - bounds.minX;
    const spanZ = bounds.maxZ - bounds.minZ;
    const cellSpanX = spanX / SUBCELL_DIVS;
    const cellSpanZ = spanZ / SUBCELL_DIVS;
    const halfExtentX = cellSpanX * 0.5;
    const halfExtentZ = cellSpanZ * 0.5;

    const buckets: BlenderBuildingPlacement[][] = Array.from(
      { length: SUBCELL_DIVS * SUBCELL_DIVS },
      () => [],
    );
    for (const p of placements) {
      const qx = Math.min(
        SUBCELL_DIVS - 1,
        Math.max(0, Math.floor((p.x - bounds.minX) / cellSpanX)),
      );
      const qz = Math.min(
        SUBCELL_DIVS - 1,
        Math.max(0, Math.floor((p.z - bounds.minZ) / cellSpanZ)),
      );
      buckets[qz * SUBCELL_DIVS + qx]?.push(p);
    }

    const proxyMaterial = this.getShadowProxyMaterial();
    const cells: BlenderQuadrantCell[] = [];

    for (let idx = 0; idx < SUBCELL_DIVS * SUBCELL_DIVS; idx += 1) {
      const list = buckets[idx];
      if (!list || list.length === 0) continue;
      const qx = idx % SUBCELL_DIVS;
      const qz = Math.floor(idx / SUBCELL_DIVS);
      const cellCx = bounds.minX + (qx + 0.5) * cellSpanX;
      const cellCz = bounds.minZ + (qz + 0.5) * cellSpanZ;

      const byModel = new Map<BlenderModelKey, BlenderBuildingPlacement[]>();
      for (const p of list) {
        const group = byModel.get(p.modelKey);
        if (group) group.push(p);
        else byModel.set(p.modelKey, [p]);
      }

      const lod0Meshes: THREE.Mesh[] = [];
      const lod1Meshes: THREE.Mesh[] = [];
      const lod2Meshes: THREE.Mesh[] = [];
      const shadowProxies: THREE.Mesh[] = [];

      for (const [key, items] of byModel) {
        const loaded = this.models.get(key);
        if (!loaded) continue;

        this.appendModelInstancedMeshes(loaded.lod0, items, null, false, lod0Meshes);
        this.appendModelInstancedMeshes(loaded.lod1, items, null, false, lod1Meshes);
        this.appendModelInstancedMeshes(loaded.lod2, items, null, false, lod2Meshes);

        const opaqueLod2 = loaded.lod2.filter((part) => !part.material.transparent);
        const proxyParts = opaqueLod2.length > 0 ? opaqueLod2 : loaded.lod2.slice(0, 1);
        this.appendModelInstancedMeshes(proxyParts, items, proxyMaterial, true, shadowProxies);
      }

      cells.push({
        centerX: cellCx,
        centerZ: cellCz,
        halfExtentX,
        halfExtentZ,
        lods: [lod0Meshes, lod1Meshes, lod2Meshes],
        shadowProxies,
        activeLod: -1,
        activeShadowMode: 'none',
      });
    }

    return cells;
  }

  /**
   * Build one chunk-wide InstancedMesh batch per archetype at LOD2 so distant all-LOD2
   * chunks coalesce ~9 subcell batches down into 1 batch per model without sacrificing 3x3 precision nearby.
   */
  createChunkLod2Meshes(buildings: BuiltBuildingChunk | undefined): THREE.Mesh[] {
    const placements = buildings?.blenderPlacements;
    if (!this.ready || !placements || placements.length === 0) return [];

    const byModel = new Map<BlenderModelKey, BlenderBuildingPlacement[]>();
    for (const p of placements) {
      const group = byModel.get(p.modelKey);
      if (group) group.push(p);
      else byModel.set(p.modelKey, [p]);
    }

    const out: THREE.Mesh[] = [];
    for (const [key, items] of byModel) {
      const loaded = this.models.get(key);
      if (!loaded) continue;
      this.appendModelInstancedMeshes(loaded.lod2, items, null, false, out);
    }

    return out;
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
