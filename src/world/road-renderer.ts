import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRoadMaterials, createRoadPropMaterial } from './road-materials';
import type { BuiltRoadChunk, RoadSurfaceGeometry } from './types';

function roadGeometry(road: RoadSurfaceGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(road.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(road.normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(road.colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(road.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(road.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function createStreetLampGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Octagonal base pedestal
  const base = new THREE.CylinderGeometry(0.18, 0.24, 0.6, 8);
  base.translate(0, 0.3, 0);
  parts.push(base);

  // Fluted central post
  const post = new THREE.CylinderGeometry(0.045, 0.08, 3.2, 8);
  post.translate(0, 2.1, 0);
  parts.push(post);

  // Capital collar
  const collar = new THREE.CylinderGeometry(0.12, 0.06, 0.15, 8);
  collar.translate(0, 3.75, 0);
  parts.push(collar);

  // Four-sided historic lantern cage
  const lantern = new THREE.CylinderGeometry(0.22, 0.14, 0.48, 4);
  lantern.rotateY(Math.PI / 4);
  lantern.translate(0, 4.05, 0);
  parts.push(lantern);

  // Peaked cap finial
  const cap = new THREE.ConeGeometry(0.26, 0.24, 4);
  cap.rotateY(Math.PI / 4);
  cap.translate(0, 4.4, 0);
  parts.push(cap);

  return mergeGeometries(parts, false) ?? new THREE.CylinderGeometry(0.045, 0.08, 4.3, 6);
}

function createTreeTrunkGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const main = new THREE.CylinderGeometry(0.12, 0.22, 2.0, 7);
  main.translate(0, 1.0, 0);
  parts.push(main);

  const branch1 = new THREE.CylinderGeometry(0.06, 0.1, 1.2, 5);
  branch1.rotateZ(0.35);
  branch1.translate(0.3, 2.2, 0);
  parts.push(branch1);

  const branch2 = new THREE.CylinderGeometry(0.06, 0.09, 1.1, 5);
  branch2.rotateZ(-0.32);
  branch2.translate(-0.28, 2.1, 0.1);
  parts.push(branch2);

  return mergeGeometries(parts, false) ?? new THREE.CylinderGeometry(0.08, 0.12, 1.6, 6);
}

function createTreeFoliageGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Clustered organic Mediterranean canopy volumes (holm oak / stone pine style)
  const c1 = new THREE.DodecahedronGeometry(1.25, 1);
  c1.translate(0, 3.1, 0);
  parts.push(c1);

  const c2 = new THREE.DodecahedronGeometry(0.95, 1);
  c2.translate(0.48, 2.7, 0.35);
  parts.push(c2);

  const c3 = new THREE.DodecahedronGeometry(0.92, 1);
  c3.translate(-0.45, 2.65, -0.32);
  parts.push(c3);

  const c4 = new THREE.DodecahedronGeometry(0.85, 1);
  c4.translate(-0.35, 2.8, 0.4);
  parts.push(c4);

  const c5 = new THREE.DodecahedronGeometry(0.8, 1);
  c5.translate(0.1, 3.8, -0.1);
  parts.push(c5);

  return mergeGeometries(parts, false) ?? new THREE.ConeGeometry(1.1, 2.2, 8);
}

function propGeometry(kind: BuiltRoadChunk['props'][number]['kind']): THREE.BufferGeometry {
  if (kind === 'street_lamp' || kind === 'street_lamp_modern') return createStreetLampGeometry();
  if (kind === 'traffic_signals') {
    const geometry = new THREE.BoxGeometry(0.22, 2.8, 0.2);
    geometry.translate(0, 1.4, 0);
    return geometry;
  }
  if (kind === 'bus_shelter') {
    const geometry = new THREE.BoxGeometry(2.8, 2.3, 1.2);
    geometry.translate(0, 1.15, 0);
    return geometry;
  }
  if (kind === 'bench' || kind === 'hedge' || kind === 'shrub' || kind === 'fountain') {
    const geometry =
      kind === 'fountain'
        ? new THREE.CylinderGeometry(1.2, 1.3, 0.6, 8)
        : new THREE.BoxGeometry(1.4, 0.6, 0.5);
    geometry.translate(0, 0.3, 0);
    return geometry;
  }
  if (kind === 'waste_basket') {
    const geometry = new THREE.CylinderGeometry(0.2, 0.2, 0.85, 6);
    geometry.translate(0, 0.42, 0);
    return geometry;
  }
  const shape = new THREE.Shape();
  shape.moveTo(-0.045, 0);
  shape.lineTo(0.045, 0);
  shape.lineTo(0.045, 1.7);
  if (kind === 'give_way') {
    shape.lineTo(0.27, 1.82);
    shape.lineTo(0, 2.26);
    shape.lineTo(-0.27, 1.82);
  } else {
    shape.lineTo(0.18, 1.84);
    shape.lineTo(0.18, 2.02);
    shape.lineTo(0.1, 2.1);
    shape.lineTo(-0.1, 2.1);
    shape.lineTo(-0.18, 2.02);
    shape.lineTo(-0.18, 1.84);
  }
  shape.lineTo(-0.045, 1.7);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.computeVertexNormals();
  return geometry;
}

export class RoadRenderer {
  private readonly roadMaterials = createRoadMaterials();
  private readonly propMaterials = new Map(
    [
      'traffic_signals',
      'stop',
      'give_way',
      'street_lamp',
      'street_lamp_modern',
      'tree',
      'shrub',
      'hedge',
      'bus_shelter',
      'bench',
      'waste_basket',
      'fountain',
    ].map((kind) => [kind, createRoadPropMaterial(kind)]),
  );
  private readonly materials = new Map([...this.roadMaterials, ...this.propMaterials]);

  createMeshes(
    roads: BuiltRoadChunk | undefined,
    centerX: number,
    centerZ: number,
    includeProps = true,
  ): THREE.Mesh[] {
    if (!roads) return [];
    const meshes: THREE.Mesh[] = [];
    for (const surface of roads.surfaces) {
      if (surface.indices.length === 0) continue;
      const mesh = new THREE.Mesh(roadGeometry(surface), this.materials.get(surface.style));
      mesh.position.set(centerX, 0, centerZ);
      mesh.receiveShadow = true;
      meshes.push(mesh);
    }
    if (roads.markings.indices.length > 0) {
      const markings = new THREE.Mesh(roadGeometry(roads.markings), this.materials.get('marking'));
      markings.position.set(centerX, 0, centerZ);
      meshes.push(markings);
    }
    if (includeProps) {
      const matrix = new THREE.Matrix4();
      const rotation = new THREE.Quaternion();
      const scale = new THREE.Vector3(1, 1, 1);
      for (const batch of roads.props) {
        if (batch.positions.length < 3) continue;
        if (batch.kind.startsWith('tree')) {
          const count = batch.positions.length / 3;
          // Lush Mediterranean tree (holm oak / stone pine style)
          const trunkGeo = createTreeTrunkGeometry();
          const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3424, roughness: 0.94 });
          const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
          // Foliage cluster.
          const foliageGeo = createTreeFoliageGeometry();
          const foliageMat = new THREE.MeshStandardMaterial({
            color: 0x3b6632,
            roughness: 0.76,
            metalness: 0.04,
          });
          const foliageMesh = new THREE.InstancedMesh(foliageGeo, foliageMat, count);
          for (let index = 0; index < count; index += 1) {
            const offset = index * 3;
            const x = batch.positions[offset] ?? 0;
            const y = batch.positions[offset + 1] ?? 0;
            const z = batch.positions[offset + 2] ?? 0;
            const s = 0.8 + ((index * 37) % 5) * 0.12;
            scale.set(s, s, s);
            rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), batch.headings[index] ?? 0);
            matrix.compose(new THREE.Vector3(x, y, z), rotation, scale);
            trunkMesh.setMatrixAt(index, matrix);
            foliageMesh.setMatrixAt(index, matrix);
          }
          trunkMesh.computeBoundingSphere();
          foliageMesh.computeBoundingSphere();
          trunkMesh.position.set(centerX, 0, centerZ);
          foliageMesh.position.set(centerX, 0, centerZ);
          trunkMesh.castShadow = true;
          foliageMesh.castShadow = true;
          meshes.push(trunkMesh, foliageMesh);
          continue;
        }
        const mesh = new THREE.InstancedMesh(
          propGeometry(batch.kind),
          this.materials.get(batch.kind),
          batch.positions.length / 3,
        );
        for (let index = 0; index < batch.positions.length / 3; index += 1) {
          const offset = index * 3;
          const height = 0;
          rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), batch.headings[index] ?? 0);
          matrix.compose(
            new THREE.Vector3(
              batch.positions[offset] ?? 0,
              (batch.positions[offset + 1] ?? 0) + height,
              batch.positions[offset + 2] ?? 0,
            ),
            rotation,
            scale,
          );
          mesh.setMatrixAt(index, matrix);
        }
        mesh.computeBoundingSphere();
        mesh.position.set(centerX, 0, centerZ);
        mesh.castShadow = true;
        meshes.push(mesh);
      }
    }
    return meshes;
  }

  async prepare(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    terrainMaterial: THREE.Material,
  ): Promise<void> {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const warmup: THREE.Mesh[] = [new THREE.Mesh(geometry, terrainMaterial)];
    for (const material of this.roadMaterials.values())
      warmup.push(new THREE.Mesh(geometry, material));
    for (const material of this.propMaterials.values())
      warmup.push(new THREE.InstancedMesh(geometry, material, 1));
    for (const material of this.materials.values())
      if (material.map) renderer.initTexture(material.map);
    for (const mesh of warmup) scene.add(mesh);
    try {
      await renderer.compileAsync(scene, camera);
    } finally {
      for (const mesh of warmup) scene.remove(mesh);
      geometry.dispose();
    }
  }

  dispose(): void {
    for (const material of this.roadMaterials.values()) {
      material.map?.dispose();
      material.dispose();
    }
    for (const material of this.propMaterials.values()) material.dispose();
  }
}
