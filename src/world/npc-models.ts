import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

// Instanced crowds draw the same mesh for every agent: decorative capsules and
// spheres use fewer sides so the visual pass stays inside the triangle budget.

function colorPart(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const count = geometry.getAttribute('position')?.count ?? 0;
  const tint = new THREE.Color(color);
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) colors.set([tint.r, tint.g, tint.b], index * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function addPart(
  parts: THREE.BufferGeometry[],
  geometry: THREE.BufferGeometry,
  color: number,
  position: THREE.Vector3,
): void {
  geometry.translate(position.x, position.y, position.z);
  parts.push(colorPart(geometry, color));
}

function finish(
  parts: THREE.BufferGeometry[],
  fallback: THREE.BufferGeometry,
): THREE.BufferGeometry {
  return mergeGeometries(parts, false) ?? colorPart(fallback, 0xffffff);
}

/** Low-poly but shaped crowd models, merged so each agent category stays one draw call. */
function pedestrianGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const skin = 0xe8bd9b;
  const jacket = 0x536c76;
  const torso = new THREE.CylinderGeometry(0.2, 0.25, 0.56, 9, 1);
  torso.scale(1, 1, 0.78);
  addPart(parts, torso, jacket, new THREE.Vector3(0, 1.15, 0));
  addPart(
    parts,
    new THREE.CylinderGeometry(0.105, 0.13, 0.11, 8),
    skin,
    new THREE.Vector3(0, 1.49, 0),
  );
  addPart(
    parts,
    new THREE.CylinderGeometry(0.2, 0.22, 0.27, 9),
    0x353a43,
    new THREE.Vector3(0, 0.78, 0),
  );
  // Cloth panels and a belt add contrast without the old flat, box-like torso.
  addPart(
    parts,
    new THREE.CylinderGeometry(0.085, 0.11, 0.4, 7),
    0xd8d0c4,
    new THREE.Vector3(0, 1.15, 0.17),
  );
  addPart(parts, new THREE.ConeGeometry(0.06, 0.23, 5), 0x8a4438, new THREE.Vector3(0, 1.02, 0.24));
  addPart(
    parts,
    new THREE.CapsuleGeometry(0.21, 0.025, 2, 8),
    0x403a35,
    new THREE.Vector3(0, 0.84, 0),
  );
  addPart(
    parts,
    new THREE.CylinderGeometry(0.035, 0.035, 0.025, 8),
    0xc5b27e,
    new THREE.Vector3(0, 0.84, 0.2),
  );
  addPart(parts, new THREE.SphereGeometry(0.145, 10, 8), 0xe8bd9b, new THREE.Vector3(0, 1.68, 0));
  addPart(
    parts,
    new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    0x38271f,
    new THREE.Vector3(0, 1.73, 0),
  );
  addPart(parts, new THREE.SphereGeometry(0.035, 7, 5), 0x38271f, new THREE.Vector3(0, 1.62, 0.14));
  addPart(parts, new THREE.SphereGeometry(0.03, 7, 5), skin, new THREE.Vector3(0, 1.64, 0.145));
  addPart(
    parts,
    new THREE.CapsuleGeometry(0.012, 0.05, 2, 5),
    0x815b4d,
    new THREE.Vector3(0, 1.59, 0.14),
  );
  for (const side of [-1, 1]) {
    addPart(
      parts,
      new THREE.SphereGeometry(0.033, 7, 5),
      skin,
      new THREE.Vector3(side * 0.14, 1.67, 0),
    );
    addPart(
      parts,
      new THREE.SphereGeometry(0.016, 6, 5),
      0x292522,
      new THREE.Vector3(side * 0.052, 1.69, 0.132),
    );
    addPart(
      parts,
      new THREE.CapsuleGeometry(0.048, 0.1, 2, 6),
      0xd8d0c4,
      new THREE.Vector3(side * 0.12, 1.18, 0.22),
    );
    addPart(
      parts,
      new THREE.SphereGeometry(0.035, 6, 4),
      0x38271f,
      new THREE.Vector3(side * 0.15, 1.78, 0.015),
    );
  }
  for (const side of [-1, 1]) {
    const arm = new THREE.CapsuleGeometry(0.085, 0.3, 3, 7);
    arm.rotateZ(side * -0.12);
    addPart(parts, arm, jacket, new THREE.Vector3(side * 0.29, 1.14, 0));
    addPart(
      parts,
      new THREE.CylinderGeometry(0.045, 0.058, 0.19, 7),
      jacket,
      new THREE.Vector3(side * 0.32, 0.84, 0.015),
    );
    addPart(
      parts,
      new THREE.SphereGeometry(0.058, 7, 5),
      skin,
      new THREE.Vector3(side * 0.32, 0.71, 0.025),
    );
    const leg = new THREE.CapsuleGeometry(0.09, 0.4, 3, 7);
    addPart(parts, leg, 0x353a43, new THREE.Vector3(side * 0.12, 0.48, 0));
    const shoe = new THREE.SphereGeometry(0.13, 9, 6);
    shoe.scale(1, 0.55, 1.55);
    addPart(parts, shoe, 0x282522, new THREE.Vector3(side * 0.12, 0.08, 0.055));
    // Crisp sneaker midsole (white sidewall) and dark tread
    const midsole = new THREE.SphereGeometry(0.132, 8, 5);
    midsole.scale(1, 0.22, 1.52);
    addPart(parts, midsole, 0xf0f2f5, new THREE.Vector3(side * 0.12, 0.042, 0.055));
    const sole = new THREE.SphereGeometry(0.13, 8, 5);
    sole.scale(1, 0.16, 1.5);
    addPart(parts, sole, 0x111315, new THREE.Vector3(side * 0.12, 0.018, 0.055));
    addPart(
      parts,
      new THREE.CapsuleGeometry(0.035, 0.08, 2, 5),
      0x282522,
      new THREE.Vector3(side * 0.15, 0.91, 0.12),
    );
  }
  // Sunglasses for urban character flair
  const glasses = new THREE.BoxGeometry(0.18, 0.038, 0.04);
  addPart(parts, glasses, 0x18181a, new THREE.Vector3(0, 1.685, 0.145));
  // Crossbody leather bag strap and hip satchel
  const satchel = new THREE.BoxGeometry(0.16, 0.18, 0.08);
  addPart(parts, satchel, 0x483427, new THREE.Vector3(0.24, 0.88, 0.06));
  const strap = new THREE.CapsuleGeometry(0.016, 0.65, 2, 5);
  strap.rotateZ(0.5);
  addPart(parts, strap, 0x483427, new THREE.Vector3(0.04, 1.18, 0.16));
  return finish(parts, new THREE.CapsuleGeometry(0.25, 1.2, 4, 8));
}

function paneGeometry(
  points: readonly (readonly [number, number, number])[],
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      points.flatMap((point) => point),
      3,
    ),
  );
  // Keep the attribute set identical to the other parts or mergeGeometries()
  // silently falls back to a single capsule and loses all vehicle detail.
  const uvs: number[] = [];
  for (let index = 0; index < points.length; index += 1)
    uvs.push(index === 1 || index === 2 ? 1 : 0, index >= 2 ? 1 : 0);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

function cabinGeometry(): THREE.BufferGeometry {
  // A tapered cabin gives the silhouette a windscreen and roof line instead
  // of the toy-like upright cube used previously.
  const vertices = new Float32Array([
    -0.72, 0.78, 0.82, 0.72, 0.78, 0.82, 0.72, 0.78, -0.78, -0.72, 0.78, -0.78, -0.52, 1.34, 0.43,
    0.52, 1.34, 0.43, 0.52, 1.34, -0.48, -0.52, 1.34, -0.48,
  ]);
  const indices = [
    0, 1, 4, 1, 5, 4, 1, 2, 5, 2, 6, 5, 2, 3, 6, 3, 7, 6, 3, 0, 7, 0, 4, 7, 4, 5, 6, 4, 6, 7, 0, 3,
    2, 0, 2, 1,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  // Primitives carry uv; without it mergeGeometries() rejects the whole cabin.
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1], 2),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Sculpted low-poly shell: wheel arches, hood and trunk read as one car body. */
export function createSedanBodyGeometry(): THREE.BufferGeometry {
  const sections = [
    { z: -2.05, width: 0.72, shoulder: 0.46, top: 0.5 },
    { z: -1.72, width: 0.82, shoulder: 0.54, top: 0.62 },
    { z: -1.12, width: 0.88, shoulder: 0.56, top: 0.66 },
    { z: 0.85, width: 0.88, shoulder: 0.56, top: 0.66 },
    { z: 1.58, width: 0.82, shoulder: 0.53, top: 0.62 },
    { z: 2.05, width: 0.72, shoulder: 0.46, top: 0.5 },
  ];
  const ring = (section: (typeof sections)[number]): readonly (readonly [number, number])[] => [
    [-section.width, 0.23],
    [section.width, 0.23],
    [section.width, section.shoulder],
    [section.width * 0.82, section.top - 0.08],
    [0, section.top],
    [-section.width * 0.82, section.top - 0.08],
    [-section.width, section.shoulder],
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  sections.forEach((section, row) => {
    ring(section).forEach(([x, y], point) => {
      positions.push(x, y, section.z);
      // Primitives merged into the car carry uv; keep the attribute set identical.
      uvs.push(point / 6, row / (sections.length - 1));
    });
  });
  const indices: number[] = [];
  const pointsPerRing = 7;
  for (let row = 0; row < sections.length - 1; row += 1) {
    const rear = row * pointsPerRing;
    const front = (row + 1) * pointsPerRing;
    for (let point = 0; point < pointsPerRing; point += 1) {
      const next = (point + 1) % pointsPerRing;
      const a = rear + point;
      const b = rear + next;
      const c = front + next;
      const d = front + point;
      indices.push(a, b, c, a, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createWheelArchGeometry(
  side: number,
  centerZ: number,
  centerY = 0.36,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const segments = 10;
  const inner = 0.37;
  const outer = 0.48;
  for (let segment = 0; segment <= segments; segment += 1) {
    const angle = (segment / segments) * Math.PI;
    const zOffset = Math.cos(angle);
    const yOffset = Math.sin(angle);
    const u = segment / segments;
    positions.push(side * 0.885, centerY + yOffset * inner, centerZ + zOffset * inner);
    positions.push(side * 0.885, centerY + yOffset * outer, centerZ + zOffset * outer);
    uvs.push(u, 0, u, 1);
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const a = segment * 2;
    indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function vehicleGeometry(police = false): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  addPart(parts, createSedanBodyGeometry(), 0xffffff, new THREE.Vector3(0, 0, 0));
  addPart(parts, cabinGeometry(), 0xffffff, new THREE.Vector3(0, 0, 0));
  // Windshields and side windows are separate panes; the old solid dark cabin
  // tinted the entire vehicle and made it read as a stack of blocks.
  const glass = 0x304b58;
  addPart(
    parts,
    paneGeometry([
      [-0.64, 0.84, 0.79],
      [0.64, 0.84, 0.79],
      [0.46, 1.27, 0.42],
      [-0.46, 1.27, 0.42],
    ]),
    glass,
    new THREE.Vector3(0, 0, 0),
  );
  addPart(
    parts,
    paneGeometry([
      [0.64, 0.84, -0.75],
      [-0.64, 0.84, -0.75],
      [-0.46, 1.27, -0.48],
      [0.46, 1.27, -0.48],
    ]),
    glass,
    new THREE.Vector3(0, 0, 0),
  );
  for (const side of [-1, 1]) {
    addPart(
      parts,
      paneGeometry([
        [side * 0.731, 0.84, 0.72],
        [side * 0.731, 0.84, 0.04],
        [side * 0.535, 1.27, 0.04],
        [side * 0.535, 1.27, 0.42],
      ]),
      glass,
      new THREE.Vector3(0, 0, 0),
    );
    addPart(
      parts,
      paneGeometry([
        [side * 0.731, 0.84, -0.04],
        [side * 0.731, 0.84, -0.68],
        [side * 0.535, 1.27, -0.48],
        [side * 0.535, 1.27, -0.04],
      ]),
      glass,
      new THREE.Vector3(0, 0, 0),
    );
  }
  // Sculpted fender lips and hood pressings catch light like painted metal.
  for (const side of [-1, 1])
    for (const z of [-1.32, 1.32]) {
      addPart(parts, createWheelArchGeometry(side, z), 0xffffff, new THREE.Vector3(0, 0, 0));
      addPart(
        parts,
        new THREE.CapsuleGeometry(0.018, 0.62, 2, 6),
        0xffffff,
        new THREE.Vector3(side * 0.34, 0.69, z > 0 ? 1.12 : -1.12),
      );
    }
  for (const side of [-1, 1]) {
    addPart(
      parts,
      new THREE.CapsuleGeometry(0.018, 0.7, 2, 6),
      0xffffff,
      new THREE.Vector3(side * 0.34, 0.67, 1.78),
    );
    addPart(
      parts,
      new THREE.CapsuleGeometry(0.018, 0.48, 2, 6),
      0xffffff,
      new THREE.Vector3(side * 0.31, 0.66, -1.76),
    );
  }
  addPart(
    parts,
    new THREE.CapsuleGeometry(0.07, 1.74, 2, 7),
    0x4b4a46,
    new THREE.Vector3(0, 0.39, 2.02),
  );
  addPart(
    parts,
    new THREE.CapsuleGeometry(0.07, 1.74, 2, 7),
    0x4b4a46,
    new THREE.Vector3(0, 0.39, -2.02),
  );
  addPart(
    parts,
    new THREE.BoxGeometry(0.58, 0.13, 0.045),
    0x252b2e,
    new THREE.Vector3(0, 0.54, 2.04),
  );
  for (const x of [-0.2, -0.1, 0, 0.1, 0.2])
    addPart(
      parts,
      new THREE.BoxGeometry(0.018, 0.11, 0.05),
      0x85898a,
      new THREE.Vector3(x, 0.54, 2.065),
    );
  for (const side of [-1, 1]) {
    addPart(
      parts,
      new THREE.CapsuleGeometry(0.075, 0.2, 2, 7),
      0xffe8ad,
      new THREE.Vector3(side * 0.58, 0.56, 1.96),
    );
    addPart(
      parts,
      new THREE.CapsuleGeometry(0.07, 0.17, 2, 7),
      0xd85145,
      new THREE.Vector3(side * 0.58, 0.56, -1.96),
    );
    const mirror = new THREE.BoxGeometry(0.16, 0.12, 0.24);
    addPart(parts, mirror, 0xffffff, new THREE.Vector3(side * 0.82, 1.02, 0.46));
    const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10);
    wheel.rotateZ(Math.PI / 2);
    addPart(parts, wheel, 0x25272a, new THREE.Vector3(side * 0.89, 0.36, 1.32));
    const rearWheel = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10);
    rearWheel.rotateZ(Math.PI / 2);
    addPart(parts, rearWheel, 0x25272a, new THREE.Vector3(side * 0.89, 0.36, -1.32));
    for (const z of [1.32, -1.32]) {
      // Alloy rim outer lip
      const rim = new THREE.CylinderGeometry(0.24, 0.24, 0.23, 10);
      rim.rotateZ(Math.PI / 2);
      addPart(parts, rim, 0xd0d4d8, new THREE.Vector3(side * 0.9, 0.36, z));
      // Dark brake disc
      const disc = new THREE.CylinderGeometry(0.18, 0.18, 0.222, 8);
      disc.rotateZ(Math.PI / 2);
      addPart(parts, disc, 0x2c2e30, new THREE.Vector3(side * 0.895, 0.36, z));
      // Center hub
      const hub = new THREE.CylinderGeometry(0.09, 0.09, 0.235, 8);
      hub.rotateZ(Math.PI / 2);
      addPart(parts, hub, 0x9da2a5, new THREE.Vector3(side * 0.902, 0.36, z));
      // 5-spoke alloy wheels
      for (let s = 0; s < 5; s += 1) {
        const spokeAngle = (s * Math.PI * 2) / 5;
        const spoke = new THREE.BoxGeometry(0.02, 0.22, 0.028);
        spoke.rotateX(spokeAngle);
        addPart(parts, spoke, 0xd0d4d8, new THREE.Vector3(side * 0.905, 0.36, z));
      }
    }
    for (const z of [0.18, -0.88]) {
      addPart(
        parts,
        new THREE.CapsuleGeometry(0.012, 0.34, 2, 5),
        0x3e4244,
        new THREE.Vector3(side * 0.85, 0.59, z),
      );
      addPart(
        parts,
        new THREE.CapsuleGeometry(0.015, 0.095, 2, 5),
        0x85898a,
        new THREE.Vector3(side * 0.86, 0.77, z + 0.21),
      );
    }
  }
  // Front and rear Spanish / European license plates (white with blue EU band)
  addPart(
    parts,
    new THREE.BoxGeometry(0.42, 0.11, 0.03),
    0xf4f4f4,
    new THREE.Vector3(0, 0.25, 2.06),
  );
  addPart(
    parts,
    new THREE.BoxGeometry(0.06, 0.11, 0.032),
    0x154ca0,
    new THREE.Vector3(-0.18, 0.25, 2.062),
  );
  addPart(
    parts,
    new THREE.BoxGeometry(0.42, 0.11, 0.03),
    0xf4f4f4,
    new THREE.Vector3(0, 0.27, -2.06),
  );
  addPart(
    parts,
    new THREE.BoxGeometry(0.06, 0.11, 0.032),
    0x154ca0,
    new THREE.Vector3(-0.18, 0.27, -2.062),
  );
  // Dual chrome exhaust tips at rear
  for (const exX of [-0.52, -0.42]) {
    const pipe = new THREE.CylinderGeometry(0.036, 0.036, 0.16, 8);
    pipe.rotateX(Math.PI / 2);
    addPart(parts, pipe, 0xd0d4d8, new THREE.Vector3(exX, 0.22, -2.08));
  }
  // Front seats and dashboard are visible through the glass at close range.
  for (const x of [-0.28, 0.28]) {
    addPart(
      parts,
      new THREE.CapsuleGeometry(0.14, 0.28, 3, 7),
      0x343b3e,
      new THREE.Vector3(x, 0.8, 0.05),
    );
    addPart(
      parts,
      new THREE.CapsuleGeometry(0.09, 0.08, 2, 6),
      0x454a4c,
      new THREE.Vector3(x, 1.03, -0.02),
    );
  }
  addPart(
    parts,
    new THREE.CapsuleGeometry(0.07, 1.15, 2, 6),
    0x333638,
    new THREE.Vector3(0, 0.81, 0.64),
  );
  if (police) {
    // Aerodynamic emergency lightbar
    addPart(
      parts,
      new THREE.BoxGeometry(0.82, 0.04, 0.14),
      0x181a1c,
      new THREE.Vector3(0, 1.38, -0.05),
    );
    addPart(
      parts,
      new THREE.BoxGeometry(0.38, 0.11, 0.22),
      0x2979ff,
      new THREE.Vector3(-0.24, 1.46, -0.05),
    );
    addPart(
      parts,
      new THREE.BoxGeometry(0.38, 0.11, 0.22),
      0xff2a2a,
      new THREE.Vector3(0.24, 1.46, -0.05),
    );
    const siren = new THREE.CylinderGeometry(0.045, 0.045, 0.12, 8);
    siren.rotateX(Math.PI / 2);
    addPart(parts, siren, 0xcccccc, new THREE.Vector3(0, 1.46, -0.05));
    // Spanish police flank livery striping
    for (const side of [-1, 1]) {
      addPart(
        parts,
        new THREE.BoxGeometry(0.02, 0.14, 1.8),
        0x18488a,
        new THREE.Vector3(side * 0.895, 0.62, 0),
      );
      addPart(
        parts,
        new THREE.BoxGeometry(0.02, 0.05, 1.8),
        0x1e824c,
        new THREE.Vector3(side * 0.896, 0.52, 0),
      );
    }
  }
  return finish(parts, new THREE.BoxGeometry(1.9, 1, 4.1));
}

/** Cloth and skin look best with high roughness and near-zero metalness. */
function pedestrianMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.88,
    metalness: 0.02,
  });
}

/** Painted metal body panels catch light more sharply than fabric. */
function vehicleMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.32,
    metalness: 0.48,
  });
}

export function createPedestrianMesh(capacity: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(pedestrianGeometry(), pedestrianMaterial(), capacity);
  mesh.name = 'pedestrians';
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

/** Bake one walk pose from the rigged CC0 pedestrian into geometry for crowd instancing. */
export function createDetailedPedestrianGeometry(gltf: GLTF): {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
} {
  const root = gltf.scene;
  const mixer = new THREE.AnimationMixer(root);
  const walking =
    gltf.animations.find((clip) => clip.name.toLowerCase() === 'walk') ?? gltf.animations[0];
  if (walking) mixer.clipAction(walking).play();
  mixer.update(0.28);
  root.updateMatrixWorld(true);
  const skinnedMeshes: THREE.SkinnedMesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) skinnedMeshes.push(object);
  });
  const skinned = skinnedMeshes[0];
  if (!skinned) throw new Error('The pedestrian asset does not contain a rigged mesh.');
  skinned.skeleton.update();

  const geometry = skinned.geometry.clone();
  const positions = geometry.getAttribute('position');
  const point = new THREE.Vector3();
  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index);
    skinned.applyBoneTransform(index, point).applyMatrix4(skinned.matrixWorld);
    positions.setXYZ(index, point.x, point.y, point.z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = Array.isArray(skinned.material)
    ? skinned.material[0]?.clone()
    : skinned.material.clone();
  if (!material) throw new Error('The pedestrian asset has no material.');
  return { geometry, material };
}

const VEHICLE_LOD_SCALE = 0.85;

/** Bake a GLB vehicle into one vertex-coloured geometry for instancing. */
export function createDetailedVehicleGeometry(gltf: GLTF): {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
} {
  const parts: THREE.BufferGeometry[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const baked = object.geometry.clone();
    baked.applyMatrix4(object.matrixWorld);
    const positions = baked.getAttribute('position');
    if (!positions) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', positions.clone());
    const normals = baked.getAttribute('normal');
    if (normals) geometry.setAttribute('normal', normals.clone());
    else geometry.computeVertexNormals();
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    const color =
      material instanceof THREE.MeshStandardMaterial ? material.color : new THREE.Color(0xffffff);
    const colors = new Float32Array(positions.count * 3);
    for (let index = 0; index < positions.count; index += 1) {
      colors.set([color.r, color.g, color.b], index * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const part = geometry.index ? geometry.toNonIndexed() : geometry;
    if (part !== geometry) geometry.dispose();
    parts.push(part);
  });
  const geometry = mergeGeometries(parts, false);
  if (!geometry) throw new Error('The vehicle asset does not contain a mesh.');
  // The GT is wider than the old procedural sedan; keep NPC lanes unchanged.
  geometry.scale(VEHICLE_LOD_SCALE, VEHICLE_LOD_SCALE, VEHICLE_LOD_SCALE);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, material: vehicleMaterial() };
}

/** Swap fallback geometry/material for a baked GLB without changing instance data. */
export function replaceInstancedModel(
  mesh: THREE.InstancedMesh,
  detailed: { readonly geometry: THREE.BufferGeometry; readonly material: THREE.Material },
): void {
  mesh.geometry.dispose();
  const previous = mesh.material;
  if (Array.isArray(previous)) for (const item of previous) item.dispose();
  else previous.dispose();
  mesh.geometry = detailed.geometry;
  mesh.material = detailed.material;
}

export function createVehicleMesh(capacity: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(vehicleGeometry(), vehicleMaterial(), capacity);
  mesh.name = 'traffic';
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

export function createPoliceMesh(capacity: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(vehicleGeometry(true), vehicleMaterial(), capacity);
  mesh.name = 'police';
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

export function disposeAgentMesh(mesh: THREE.InstancedMesh): void {
  mesh.geometry.dispose();
  const mat = mesh.material;
  if (Array.isArray(mat)) for (const item of mat) item.dispose();
  else mat.dispose();
  mesh.dispose();
}
