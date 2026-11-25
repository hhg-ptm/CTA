import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { World } from '@dimforge/rapier3d-compat';
import type { ChunkManager } from './chunk-manager';
import { createSedanBodyGeometry, createWheelArchGeometry } from './npc-models';

const CAR_COLOR = 0xc94a3a;
const WHEEL_COLOR = 0x1a1a1a;

export class Vehicle {
  readonly group: THREE.Group;
  readonly chassisBody: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly color: number;
  private readonly wheels: THREE.Object3D[] = [];
  private readonly brakeLightMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly proceduralParts: THREE.Object3D[] = [];
  private readonly world: World;

  constructor(world: World, x: number, y: number, z: number, heading = 0, color = CAR_COLOR) {
    this.world = world;
    this.color = color;
    this.group = new THREE.Group();

    // Chassis rigid body: placed at y + 0.82 so wheels rest gently on the ground
    // without compressing the suspension into the floor on frame 0. Heading rotates
    // the chassis along the street direction to prevent trimesh wall penetration.
    const half = heading * 0.5;
    const chassisDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y + 0.82, z)
      .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) })
      .setLinearDamping(0.8)
      .setAngularDamping(4.0);
    this.chassisBody = world.createRigidBody(chassisDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(0.9, 0.35, 2.0).setMass(1200).setFriction(0.7);
    world.createCollider(colliderDesc, this.chassisBody);

    this.group.position.set(x, y + 0.82, z);
    this.group.quaternion.set(0, Math.sin(half), 0, Math.cos(half));

    this.controller = new RAPIER.DynamicRayCastVehicleController(
      this.chassisBody,
      world.bodies,
      world.colliders,
      world.queryPipeline,
    );
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;

    const wheelPositions = [
      { x: -0.75, z: 1.3 },
      { x: 0.75, z: 1.3 },
      { x: -0.75, z: -1.3 },
      { x: 0.75, z: -1.3 },
    ];
    for (const wp of wheelPositions) {
      this.controller.addWheel(
        new RAPIER.Vector3(wp.x, -0.2, wp.z),
        new RAPIER.Vector3(0, -1, 0),
        new RAPIER.Vector3(1, 0, 0),
        0.3,
        0.35,
      );
    }
    for (let i = 0; i < 4; i += 1) {
      this.controller.setWheelSuspensionStiffness(i, 28);
      this.controller.setWheelMaxSuspensionTravel(i, 0.28);
      this.controller.setWheelSuspensionCompression(i, 4.4);
      this.controller.setWheelSuspensionRelaxation(i, 2.3);
      this.controller.setWheelFrictionSlip(i, 4.5);
      this.controller.setWheelSideFrictionStiffness(i, 2.0);
      this.controller.setWheelMaxSuspensionForce(i, 6000);
      this.controller.setWheelRadius(i, 0.35);
    }

    // Visual mesh with matching color and glossy clearcoat automotive finish.
    const bodyGeo = createSedanBodyGeometry();
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.16, metalness: 0.65 });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.castShadow = true;
    this.group.add(bodyMesh);

    const cabinGeo = taperedCabinGeometry();
    const cabinMat = new THREE.MeshStandardMaterial({ color, roughness: 0.18, metalness: 0.55 });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 0, -0.18);
    cabin.castShadow = true;
    this.group.add(cabin);

    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x34383b,
      roughness: 0.62,
      metalness: 0.22,
    });
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xfffae8,
      emissive: 0xffefb8,
      emissiveIntensity: 1.2,
      roughness: 0.15,
    });
    const rearLightMat = new THREE.MeshStandardMaterial({
      color: 0x8f211c,
      roughness: 0.26,
      metalness: 0.08,
    });
    const brakeLightMat = new THREE.MeshStandardMaterial({
      color: 0xf13327,
      emissive: 0xc91c12,
      emissiveIntensity: 0.12,
      roughness: 0.18,
    });
    const plateMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.6 });
    const euMat = new THREE.MeshStandardMaterial({ color: 0x154ca0, roughness: 0.5 });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xd8dcd0,
      roughness: 0.18,
      metalness: 0.9,
    });

    const addDetail = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      x: number,
      y: number,
      z: number,
    ) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      this.group.add(mesh);
    };
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x1b2d36,
      roughness: 0.1,
      metalness: 0.72,
      side: THREE.DoubleSide,
    });
    const addPane = (points: readonly (readonly [number, number, number])[]) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          points.flatMap((point) => point),
          3,
        ),
      );
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      geometry.computeVertexNormals();
      addDetail(geometry, glassMat, 0, 0, 0);
    };
    addPane([
      [-0.64, 0.57, 0.79],
      [0.64, 0.57, 0.79],
      [0.48, 1.08, 0.42],
      [-0.48, 1.08, 0.42],
    ]);
    addPane([
      [0.64, 0.57, -0.75],
      [-0.64, 0.57, -0.75],
      [-0.48, 1.08, -0.48],
      [0.48, 1.08, -0.48],
    ]);
    for (const side of [-1, 1]) {
      addPane([
        [side * 0.731, 0.58, 0.72],
        [side * 0.731, 0.58, 0.04],
        [side * 0.535, 1.08, 0.04],
        [side * 0.535, 1.08, 0.42],
      ]);
      addPane([
        [side * 0.731, 0.58, -0.04],
        [side * 0.731, 0.58, -0.68],
        [side * 0.535, 1.08, -0.48],
        [side * 0.535, 1.08, -0.04],
      ]);
    }
    addDetail(new THREE.CapsuleGeometry(0.07, 1.74, 2, 8), trimMat, 0, 0.14, 2.02);
    addDetail(new THREE.CapsuleGeometry(0.07, 1.74, 2, 8), trimMat, 0, 0.14, -2.02);
    addDetail(new THREE.BoxGeometry(0.58, 0.13, 0.045), trimMat, 0, 0.3, 2.04);
    for (const x of [-0.2, -0.1, 0, 0.1, 0.2])
      addDetail(new THREE.BoxGeometry(0.018, 0.11, 0.05), trimMat, x, 0.3, 2.065);
    for (const side of [-1, 1]) {
      addDetail(new THREE.BoxGeometry(0.32, 0.2, 0.1), lightMat, side * 0.62, 0.4, 1.91);
      addDetail(new THREE.BoxGeometry(0.28, 0.17, 0.1), rearLightMat, side * 0.66, 0.42, -1.91);
      const brake = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.035), brakeLightMat);
      brake.position.set(side * 0.66, 0.42, -1.97);
      this.group.add(brake);
      this.brakeLightMaterials.push(brakeLightMat);
      addDetail(new THREE.BoxGeometry(0.16, 0.12, 0.22), trimMat, side * 0.82, 0.83, 0.48);
      for (const z of [-1.32, 1.32]) {
        const arch = new THREE.Mesh(createWheelArchGeometry(side, z, 0), bodyMat);
        arch.castShadow = true;
        this.group.add(arch);
      }
      addDetail(new THREE.CapsuleGeometry(0.014, 0.34, 2, 6), trimMat, side * 0.86, 0.4, 0.12);
      addDetail(new THREE.CapsuleGeometry(0.02, 0.08, 2, 6), trimMat, side * 0.86, 0.6, 0.38);
    }

    // Cabin forms add a visible interior through the glass at close range.
    addDetail(new THREE.BoxGeometry(1.16, 0.12, 0.3), trimMat, 0, 0.69, 0.61);
    const steeringWheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 6, 16), trimMat);
    steeringWheel.position.set(-0.28, 0.84, 0.53);
    this.group.add(steeringWheel);
    for (const seatX of [-0.3, 0.3]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.28), trimMat);
      seat.position.set(seatX, 0.75, -0.22);
      seat.castShadow = true;
      this.group.add(seat);
    }

    // Door shut lines clarify the car body silhouette without adding many draw calls.
    const seamGeometry = new THREE.BufferGeometry();
    seamGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          -0.87, 0.58, 0.02, -0.87, 0.58, -0.7, -0.87, 0.58, -0.7, -0.68, 1.02, -0.48, 0.87, 0.58,
          0.02, 0.87, 0.58, -0.7, 0.87, 0.58, -0.7, 0.68, 1.02, -0.48,
        ],
        3,
      ),
    );
    const seamMaterial = new THREE.LineBasicMaterial({
      color: 0x652b25,
      transparent: true,
      opacity: 0.58,
    });
    this.group.add(new THREE.LineSegments(seamGeometry, seamMaterial));

    // Spanish / European format license plates
    addDetail(new THREE.BoxGeometry(0.42, 0.11, 0.03), plateMat, 0, 0.05, 2.06);
    addDetail(new THREE.BoxGeometry(0.06, 0.11, 0.032), euMat, -0.18, 0.05, 2.062);
    addDetail(new THREE.BoxGeometry(0.42, 0.11, 0.03), plateMat, 0, 0.07, -2.06);
    addDetail(new THREE.BoxGeometry(0.06, 0.11, 0.032), euMat, -0.18, 0.07, -2.062);

    // Dual chrome exhaust pipes at rear
    for (const exX of [-0.52, -0.42]) {
      const pipeGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.16, 8);
      pipeGeo.rotateX(Math.PI / 2);
      addDetail(pipeGeo, chromeMat, exX, 0.02, -2.08);
    }

    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: WHEEL_COLOR, roughness: 0.85 });
    const rimGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.258, 12);
    rimGeo.rotateZ(Math.PI / 2);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xd0d4d8,
      roughness: 0.25,
      metalness: 0.85,
    });

    // The GLB replaces these simple wheels; the pivots stay so steering,
    // rolling and suspension travel keep working with the same Rapier data.
    this.proceduralParts.push(...this.group.children);
    for (const wp of wheelPositions) {
      const pivot = new THREE.Group();
      pivot.position.set(wp.x, 0.0, wp.z);
      const tyre = new THREE.Mesh(wheelGeo, wheelMat);
      tyre.castShadow = true;
      pivot.add(tyre);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.position.x = 0.01;
      pivot.add(rim);
      this.group.add(pivot);
      this.wheels.push(pivot);
    }
  }

  update(
    deltaSeconds: number,
    input: {
      forward: boolean;
      backward: boolean;
      left: boolean;
      right: boolean;
      handbrake: boolean;
    },
  ): void {
    const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const steeringAngle = steer * 0.5;
    this.controller.setWheelSteering(0, steeringAngle);
    this.controller.setWheelSteering(1, steeringAngle);

    const engine = input.forward ? 4000 : input.backward ? -2000 : 0;
    this.controller.setWheelEngineForce(2, engine);
    this.controller.setWheelEngineForce(3, engine);

    const brake = input.handbrake ? 60 : input.backward && !input.forward ? 30 : 0;
    for (let i = 0; i < 4; i += 1) this.controller.setWheelBrake(i, brake);

    this.controller.updateVehicle(deltaSeconds);
    const braking = input.handbrake || (input.backward && !input.forward);
    for (const material of this.brakeLightMaterials)
      material.emissiveIntensity = braking ? 2.2 : 0.12;
    // Rapier's vehicle controller only changes velocities; stepping the world is
    // what integrates the chassis and resolves contacts with terrain, buildings
    // and the kinematic agent colliders.
    this.world.step();

    // Prevent physical launch into the sky on curb or trimesh penetration.
    const linvel = this.chassisBody.linvel();
    if (linvel.y > 4.5) {
      this.chassisBody.setLinvel({ x: linvel.x, y: 4.5, z: linvel.z }, true);
    }
    const angvel = this.chassisBody.angvel();
    if (Math.abs(angvel.x) > 3.0 || Math.abs(angvel.z) > 3.0) {
      this.chassisBody.setAngvel(
        {
          x: THREE.MathUtils.clamp(angvel.x, -3.0, 3.0),
          y: angvel.y,
          z: THREE.MathUtils.clamp(angvel.z, -3.0, 3.0),
        },
        true,
      );
    }

    // Sync visual mesh.
    const t = this.chassisBody.translation();
    const r = this.chassisBody.rotation();
    this.group.position.set(t.x, t.y, t.z);
    this.group.quaternion.set(r.x, r.y, r.z, r.w);

    // Wheel visuals.
    for (let i = 0; i < 4; i += 1) {
      const w = this.wheels[i];
      if (!w) continue;
      const rot = this.controller.wheelRotation(i);
      if (rot !== null) w.rotation.x = rot;
      const steerAng = this.controller.wheelSteering(i);
      if (steerAng !== null && i < 2) w.rotation.y = steerAng;
      const hp = this.controller.wheelHardPoint(i);
      const suspLen = this.controller.wheelSuspensionLength(i);
      if (hp && suspLen !== null) {
        w.position.set(
          hp.x - this.group.position.x,
          hp.y - this.group.position.y + suspLen * 0.5,
          hp.z - this.group.position.z,
        );
      }
    }
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  async loadModel(chunks: ChunkManager, url: string): Promise<void> {
    const gltf = await chunks.loadModel(url, 80);
    const model = createMergedVehicleVisual(gltf, this.color);
    model.name = 'Kenney CC0 sedan';
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    this.group.add(model);
    for (const part of this.proceduralParts) part.visible = false;
  }

  get speed(): number {
    const velocity = this.chassisBody.linvel();
    return Math.hypot(velocity.x, velocity.y, velocity.z);
  }

  dispose(): void {
    this.world.removeRigidBody(this.chassisBody);
  }
}

function taperedCabinGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    -0.75, 0.56, 0.82, 0.75, 0.56, 0.82, 0.75, 0.56, -0.78, -0.75, 0.56, -0.78, -0.53, 1.1, 0.42,
    0.53, 1.1, 0.42, 0.53, 1.1, -0.48, -0.53, 1.1, -0.48,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([
    0, 1, 4, 1, 5, 4, 1, 2, 5, 2, 6, 5, 2, 3, 6, 3, 7, 6, 3, 0, 7, 0, 4, 7, 4, 5, 6, 4, 6, 7,
  ]);
  geometry.computeVertexNormals();
  return geometry;
}

/** Merge the Kenney sedan body into one batch per material and reuse the animated wheels. */
function createMergedVehicleVisual(gltf: GLTF, paintColor?: number): THREE.Group {
  const source = gltf.scene.clone(true);
  // Kenney ships four static wheels; the procedural wheels keep steering and rolling.
  source.traverse((object) => {
    if (object instanceof THREE.Mesh && object.name.toLowerCase().includes('wheel')) {
      object.parent?.remove(object);
    }
  });
  source.updateMatrixWorld(true);
  const batches = new Map<
    string,
    { material: THREE.Material; geometries: THREE.BufferGeometry[] }
  >();
  const bounds = new THREE.Box3().setFromObject(source);
  if (bounds.isEmpty()) throw new Error('The sedan model has no renderable geometry.');
  const center = bounds.getCenter(new THREE.Vector3());
  // The source body is 1.5 × 1.15 × 2.55 m; this matches the 1.8 × 4.1 m chassis.
  const scale = new THREE.Vector3(1.2, 1, 1.6);

  source.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const sourceGeometry = object.geometry;
    const groups =
      sourceGeometry.groups.length > 0
        ? sourceGeometry.groups
        : [
            {
              start: 0,
              count:
                sourceGeometry.index?.count ?? sourceGeometry.getAttribute('position')?.count ?? 0,
              materialIndex: 0,
            },
          ];
    for (const group of groups) {
      let material = materials[group.materialIndex ?? 0];
      if (!material) continue;
      if (
        paintColor !== undefined &&
        material instanceof THREE.MeshStandardMaterial &&
        (material.name.toLowerCase().includes('paint') ||
          material.name.toLowerCase().includes('body') ||
          material.name.toLowerCase().includes('colormap'))
      ) {
        material = material.clone();
        material.color.setHex(paintColor);
      }
      const geometry = geometryForMaterialGroup(
        sourceGeometry,
        group.start,
        group.count,
        sourceGeometry.groups.length > 0,
      );
      geometry.applyMatrix4(object.matrixWorld);
      geometry.translate(-center.x, -center.y + 0.35, -center.z);
      geometry.scale(scale.x, scale.y, scale.z);
      const signature = Object.entries(geometry.attributes)
        .map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized}`)
        .sort()
        .join('|');
      const key = `${material.uuid}:${signature}:${Boolean(geometry.index)}`;
      const batch: { material: THREE.Material; geometries: THREE.BufferGeometry[] } = batches.get(
        key,
      ) ?? { material, geometries: [] };
      batch.geometries.push(geometry);
      batches.set(key, batch);
    }
  });

  const result = new THREE.Group();
  for (const batch of batches.values()) {
    const geometry = mergeGeometries(batch.geometries, false);
    for (const sourceGeometry of batch.geometries) sourceGeometry.dispose();
    if (!geometry) continue;
    geometry.computeBoundingSphere();
    result.add(new THREE.Mesh(geometry, batch.material));
  }
  if (result.children.length === 0)
    throw new Error('The sedan model could not be combined into renderable meshes.');
  return result;
}

function geometryForMaterialGroup(
  source: THREE.BufferGeometry,
  start: number,
  count: number,
  selectRange: boolean,
): THREE.BufferGeometry {
  const geometry = source.clone();
  geometry.clearGroups();
  if (!selectRange) return geometry;
  if (source.index) {
    geometry.setIndex(new THREE.BufferAttribute(source.index.array.slice(start, start + count), 1));
    return geometry;
  }
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const begin = start * attribute.itemSize;
    const end = (start + count) * attribute.itemSize;
    const array =
      attribute instanceof THREE.InterleavedBufferAttribute
        ? attribute.data.array
        : attribute.array;
    geometry.setAttribute(
      name,
      new THREE.BufferAttribute(array.slice(begin, end), attribute.itemSize, attribute.normalized),
    );
  }
  return geometry;
}
