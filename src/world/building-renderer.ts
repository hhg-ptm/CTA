import * as THREE from 'three';
import { createBuildingMaterials } from './building-materials';
import type { BuiltBuildingChunk, BuildingSurfaceGeometry } from './types';

function buildingGeometry(surface: BuildingSurfaceGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(surface.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(surface.normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(surface.colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(surface.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(surface.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function shadowProxyGeometry(
  surfaces: readonly BuildingSurfaceGeometry[],
): THREE.BufferGeometry | undefined {
  let vertCount = 0;
  let idxCount = 0;
  for (const s of surfaces) {
    vertCount += s.positions.length / 3;
    idxCount += s.indices.length;
  }
  if (idxCount === 0 || vertCount === 0) return undefined;
  const positions = new Float32Array(vertCount * 3);
  const indices = new Uint32Array(idxCount);
  let vOff = 0;
  let iOff = 0;
  for (const s of surfaces) {
    positions.set(s.positions, vOff * 3);
    for (let i = 0; i < s.indices.length; i += 1) {
      indices[iOff + i] = (s.indices[i] ?? 0) + vOff;
    }
    vOff += s.positions.length / 3;
    iOff += s.indices.length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export class BuildingRenderer {
  private readonly materials = createBuildingMaterials();
  private readonly shadowProxyMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  createMeshes(
    buildings: BuiltBuildingChunk | undefined,
    centerX: number,
    centerZ: number,
  ): THREE.Mesh[][] {
    if (!buildings) return [];
    const lod2Surfaces = buildings.levels[2]?.surfaces ?? buildings.levels[1]?.surfaces ?? [];
    const proxyGeom = lod2Surfaces.length > 0 ? shadowProxyGeometry(lod2Surfaces) : undefined;
    return buildings.levels.map((level, levelIndex) => {
      const meshes: THREE.Mesh[] = level.surfaces.flatMap((surface) => {
        const material = this.materials.get(surface.material);
        if (!material || surface.indices.length === 0) return [];
        const mesh = new THREE.Mesh(buildingGeometry(surface), material);
        mesh.position.set(centerX, 0, centerZ);
        mesh.castShadow = levelIndex > 0 || !proxyGeom;
        mesh.receiveShadow = true;
        mesh.visible = false;
        return [mesh];
      });
      if (levelIndex === 0 && proxyGeom) {
        const proxy = new THREE.Mesh(proxyGeom, this.shadowProxyMaterial);
        proxy.position.set(centerX, 0, centerZ);
        proxy.castShadow = true;
        proxy.receiveShadow = false;
        proxy.visible = false;
        meshes.push(proxy);
      }
      return meshes;
    });
  }

  async prepare(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    terrainMaterial: THREE.Material,
  ): Promise<void> {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const warmup: THREE.Mesh[] = [new THREE.Mesh(geometry, terrainMaterial)];
    for (const material of this.materials.values()) {
      if (material.map) renderer.initTexture(material.map);
      if (material.emissiveMap) renderer.initTexture(material.emissiveMap);
      warmup.push(new THREE.Mesh(geometry, material));
    }
    for (const mesh of warmup) scene.add(mesh);
    try {
      await renderer.compileAsync(scene, camera);
    } finally {
      for (const mesh of warmup) scene.remove(mesh);
      geometry.dispose();
    }
  }

  setNight(enabled: boolean): void {
    const intensity = enabled ? 1.35 : 0;
    for (const [kind, material] of this.materials) {
      if (kind.endsWith('_facade')) material.emissiveIntensity = intensity;
    }
  }

  dispose(): void {
    this.shadowProxyMaterial.dispose();
    for (const material of this.materials.values()) {
      material.map?.dispose();
      material.emissiveMap?.dispose();
      material.dispose();
    }
  }
}
