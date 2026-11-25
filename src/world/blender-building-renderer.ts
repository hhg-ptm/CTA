/**
 * GPU-instanced Three.js renderer for System A Blender building GLBs (FASE B + FASE C).
 *
 * Shares at most 2 global PBR materials across the entire 8-building library (CC_Atlas_Opaque
 * + CC_Atlas_Glass), rendering each chunk's placements in 3x3 subcells (~85m) with dynamic
 * tiered LOD0 -> LOD1 -> LOD2 switching plus dedicated LOD2 shadow-caster proxies.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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

export interface BlenderChunkLod2Group {
  readonly mesh: THREE.BatchedMesh;
  readonly noShadowCast: boolean;
  readonly cellInstanceIds: readonly (readonly number[])[];
}

export interface BlenderChunkLod2Batch {
  readonly meshes: THREE.Mesh[];
  readonly groups: readonly BlenderChunkLod2Group[];
  lastMask: number;
  lastShadowMask: number;
}

export interface BlenderQuadrantCell {
  readonly cellIndex: number;
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
          lod0Parts.set(entry.key, this.extractSharedParts(gltf, cx, cz, false));
        }),
        loadModel(new URL(`${entry.key}-lod1.glb`, this.baseUrl).href, 35).then((gltf) => {
          lod1Parts.set(entry.key, this.extractSharedParts(gltf, cx, cz, true));
        }),
        loadModel(new URL(`${entry.key}-lod2.glb`, this.baseUrl).href, 35).then((gltf) => {
          lod2Parts.set(entry.key, this.extractSharedParts(gltf, cx, cz, true));
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

  private extractSharedParts(
    gltf: GLTF,
    offsetX: number,
    offsetZ: number,
    forLod2: boolean,
  ): ModelPart[] {
    gltf.scene.updateMatrixWorld(true);
    const parts: ModelPart[] = [];
    gltf.scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const srcMat = Array.isArray(node.material) ? node.material[0] : node.material;
      if (!srcMat) return;
      const sharedMat = this.internSharedAtlasMaterial(srcMat, forLod2);
      const geometry = node.geometry.clone();
      geometry.applyMatrix4(node.matrixWorld);
      if (offsetX !== 0 || offsetZ !== 0) geometry.translate(-offsetX, 0, -offsetZ);
      if (forLod2) {
        if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
        if (!geometry.getAttribute('uv')) {
          const count = geometry.getAttribute('position')?.count ?? 0;
          geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
        }
        for (const attr of Object.keys(geometry.attributes)) {
          if (attr !== 'position' && attr !== 'normal' && attr !== 'uv') {
            geometry.deleteAttribute(attr);
          }
        }
        if (!geometry.getIndex()) {
          const count = geometry.getAttribute('position')?.count ?? 0;
          const seq = Array.from({ length: count }, (_, i) => i);
          geometry.setIndex(seq);
        }
      }
      geometry.computeBoundingSphere();
      geometry.userData.sharedGeometry = true;
      parts.push({ geometry, material: sharedMat });
    });
    return parts;
  }

  private internSharedAtlasMaterial(source: THREE.Material, forLod2 = false): THREE.Material {
    const baseKey = source.name.startsWith('CC_Atlas_Glass') ? 'CC_Atlas_Glass' : 'CC_Atlas_Opaque';
    const key = forLod2 ? `${baseKey}_LOD2` : baseKey;
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
      if (forLod2) {
        // Lightweight Standard PBR at LOD1/LOD2 preserves full atlas PBR maps without physical shader branches.
        const lite = new THREE.MeshStandardMaterial({
          name: source.name,
          map: source.map,
          roughnessMap: source.roughnessMap,
          metalnessMap: source.metalnessMap,
          roughness: source.roughness,
          metalness: source.metalness,
          emissive: source.emissive,
          emissiveMap: source.emissiveMap,
          emissiveIntensity: baseKey === 'CC_Atlas_Glass' ? 0.45 : source.emissiveIntensity,
        });
        lite.userData.noShadowCast = baseKey === 'CC_Atlas_Glass';
        this.sharedMaterials.set(key, lite);
        return lite;
      }
      if (baseKey === 'CC_Atlas_Glass') {
        source.emissiveIntensity = 0.45;
        source.userData.noShadowCast = true;
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
      const noShadowCast = mat.userData.noShadowCast === true;
      const useTint = !shadowOnlyLayer && !mat.transparent && !noShadowCast;
      const mesh = new THREE.InstancedMesh(part.geometry, mat, items.length);
      mesh.userData.noShadowCast = noShadowCast;
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
      mesh.castShadow = shadowOnlyLayer && !noShadowCast;
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
    const proxyMatrix = new THREE.Matrix4();
    const proxyPos = new THREE.Vector3();
    const proxyQuat = new THREE.Quaternion();
    const proxyScale = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);

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
      const proxyGeos: THREE.BufferGeometry[] = [];

      for (const [key, items] of byModel) {
        const loaded = this.models.get(key);
        if (!loaded) continue;

        this.appendModelInstancedMeshes(loaded.lod0, items, null, false, lod0Meshes);
        this.appendModelInstancedMeshes(loaded.lod1, items, null, false, lod1Meshes);
        this.appendModelInstancedMeshes(loaded.lod2, items, null, false, lod2Meshes);

        const opaqueLod2 = loaded.lod2.filter(
          (part) => !part.material.transparent && part.material.userData.noShadowCast !== true,
        );
        const proxyParts = opaqueLod2.length > 0 ? opaqueLod2 : loaded.lod2.slice(0, 1);
        for (const part of proxyParts) {
          const baseNonIndexed = part.geometry.index
            ? part.geometry.toNonIndexed()
            : part.geometry.clone();
          for (const attr of Object.keys(baseNonIndexed.attributes)) {
            if (attr !== 'position' && attr !== 'normal') baseNonIndexed.deleteAttribute(attr);
          }
          if (!baseNonIndexed.getAttribute('normal')) baseNonIndexed.computeVertexNormals();
          for (const item of items) {
            proxyPos.set(item.x, item.y, item.z);
            proxyQuat.setFromAxisAngle(yAxis, item.heading);
            proxyScale.set(item.scaleX, item.scaleY, item.scaleZ);
            proxyMatrix.compose(proxyPos, proxyQuat, proxyScale);
            const g = baseNonIndexed.clone();
            g.applyMatrix4(proxyMatrix);
            proxyGeos.push(g);
          }
          baseNonIndexed.dispose();
        }
      }

      if (proxyGeos.length > 0) {
        const merged = mergeGeometries(proxyGeos, false);
        for (const g of proxyGeos) g.dispose();
        if (merged) {
          merged.computeBoundingSphere();
          const proxyMesh = new THREE.Mesh(merged, proxyMaterial);
          proxyMesh.castShadow = true;
          proxyMesh.receiveShadow = false;
          proxyMesh.visible = false;
          proxyMesh.layers.set(SHADOW_PROXY_LAYER);
          proxyMesh.matrixAutoUpdate = false;
          proxyMesh.updateMatrix();
          shadowProxies.push(proxyMesh);
        }
      }

      cells.push({
        cellIndex: cells.length,
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
   * Build at most two chunk-wide BatchedMesh drawers (Opaque + Glass at LOD2) partitioned by subcell
   * so all active LOD2 subcells across every building archetype render in 1-2 draw calls per chunk.
   */
  createChunkLod2Batch(
    buildings: BuiltBuildingChunk | undefined,
    bounds: ProjectedBounds,
  ): BlenderChunkLod2Batch | undefined {
    const placements = buildings?.blenderPlacements;
    if (!this.ready || !placements || placements.length === 0) return undefined;

    const SUBCELL_DIVS = 3;
    const spanX = bounds.maxX - bounds.minX;
    const spanZ = bounds.maxZ - bounds.minZ;
    const cellSpanX = spanX / SUBCELL_DIVS;
    const cellSpanZ = spanZ / SUBCELL_DIVS;

    const rawBuckets: BlenderBuildingPlacement[][] = Array.from(
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
      rawBuckets[qz * SUBCELL_DIVS + qx]?.push(p);
    }

    const activeCellPlacements = rawBuckets.filter((b) => b.length > 0);
    if (activeCellPlacements.length === 0) return undefined;

    interface BatchAcc {
      material: THREE.Material;
      noShadowCast: boolean;
      useTint: boolean;
      uniqueGeos: THREE.BufferGeometry[];
      partGeoIndex: Map<THREE.BufferGeometry, number>;
      maxInstances: number;
      maxVertices: number;
      maxIndices: number;
      itemsByCell: Array<Array<{ item: BlenderBuildingPlacement; geo: THREE.BufferGeometry }>>;
    }

    const accumulators = new Map<THREE.Material, BatchAcc>();
    for (let cellIdx = 0; cellIdx < activeCellPlacements.length; cellIdx += 1) {
      const list = activeCellPlacements[cellIdx]!;
      for (const p of list) {
        const loaded = this.models.get(p.modelKey);
        if (!loaded) continue;
        for (const part of loaded.lod2) {
          let acc = accumulators.get(part.material);
          if (!acc) {
            const noShadowCast = part.material.userData.noShadowCast === true;
            acc = {
              material: part.material,
              noShadowCast,
              useTint: !part.material.transparent && !noShadowCast,
              uniqueGeos: [],
              partGeoIndex: new Map(),
              maxInstances: 0,
              maxVertices: 0,
              maxIndices: 0,
              itemsByCell: Array.from({ length: activeCellPlacements.length }, () => []),
            };
            accumulators.set(part.material, acc);
          }
          if (!acc.partGeoIndex.has(part.geometry)) {
            acc.partGeoIndex.set(part.geometry, acc.uniqueGeos.length);
            acc.uniqueGeos.push(part.geometry);
            acc.maxVertices += part.geometry.getAttribute('position')?.count ?? 0;
            acc.maxIndices +=
              part.geometry.getIndex()?.count ?? part.geometry.getAttribute('position')?.count ?? 0;
          }
          acc.maxInstances += 1;
          acc.itemsByCell[cellIdx]!.push({ item: p, geo: part.geometry });
        }
      }
    }

    const meshes: THREE.Mesh[] = [];
    const groups: BlenderChunkLod2Group[] = [];
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const tintColor = new THREE.Color();
    const chunkCenter = new THREE.Vector3(
      (bounds.minX + bounds.maxX) * 0.5,
      440,
      (bounds.minZ + bounds.maxZ) * 0.5,
    );
    const chunkRadius = Math.hypot(spanX * 0.5, spanZ * 0.5, 160);

    for (const acc of accumulators.values()) {
      if (acc.maxInstances === 0 || acc.uniqueGeos.length === 0) continue;
      const batched = new THREE.BatchedMesh(
        acc.maxInstances,
        Math.max(3, acc.maxVertices),
        Math.max(3, acc.maxIndices),
        acc.material,
      );
      batched.perObjectFrustumCulled = false;
      batched.sortObjects = false;
      batched.userData.noShadowCast = acc.noShadowCast;
      batched.receiveShadow = true;
      batched.castShadow = false;
      batched.visible = false;
      batched.boundingSphere = new THREE.Sphere(chunkCenter.clone(), chunkRadius);

      const geoIds = new Map<THREE.BufferGeometry, number>();
      for (const g of acc.uniqueGeos) {
        geoIds.set(g, batched.addGeometry(g));
      }

      const cellInstanceIds: number[][] = [];
      for (let cellIdx = 0; cellIdx < acc.itemsByCell.length; cellIdx += 1) {
        const entries = acc.itemsByCell[cellIdx]!;
        const ids: number[] = [];
        for (const { item, geo } of entries) {
          const gid = geoIds.get(geo);
          if (gid === undefined) continue;
          const instId = batched.addInstance(gid);
          pos.set(item.x, item.y, item.z);
          quat.setFromAxisAngle(yAxis, item.heading);
          scale.set(item.scaleX, item.scaleY, item.scaleZ);
          matrix.compose(pos, quat, scale);
          batched.setMatrixAt(instId, matrix);
          if (acc.useTint) {
            tintColor.setHex(item.tint ?? 0xffffff);
            batched.setColorAt(instId, tintColor);
          }
          batched.setVisibleAt(instId, false);
          ids.push(instId);
        }
        cellInstanceIds.push(ids);
      }

      meshes.push(batched);
      groups.push({
        mesh: batched,
        noShadowCast: acc.noShadowCast,
        cellInstanceIds,
      });
    }

    return { meshes, groups, lastMask: -1, lastShadowMask: -1 };
  }

  updateChunkLod2Batch(
    batch: BlenderChunkLod2Batch | undefined,
    lod2Mask: number,
    castShadow: boolean,
  ): void {
    if (!batch) return;
    const shadowFlag = castShadow ? 1 : 0;
    const prevMask = batch.lastMask === -1 ? 0 : batch.lastMask;
    if (batch.lastMask === lod2Mask && batch.lastShadowMask === shadowFlag) return;
    const changedMask = batch.lastMask === -1 ? ~0 : prevMask ^ lod2Mask;
    batch.lastMask = lod2Mask;
    batch.lastShadowMask = shadowFlag;

    for (const group of batch.groups) {
      if (changedMask !== 0) {
        for (let c = 0; c < group.cellInstanceIds.length; c += 1) {
          if ((changedMask & (1 << c)) === 0) continue;
          const show = (lod2Mask & (1 << c)) !== 0;
          for (const instId of group.cellInstanceIds[c]!) {
            group.mesh.setVisibleAt(instId, show);
          }
        }
      }
      group.mesh.visible = lod2Mask !== 0;
      group.mesh.castShadow = lod2Mask !== 0 && castShadow && !group.noShadowCast;
    }
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
