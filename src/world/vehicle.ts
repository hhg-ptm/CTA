import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { World } from '@dimforge/rapier3d-compat';
import type { ChunkManager } from './chunk-manager';
import { createSedanBodyGeometry, createWheelArchGeometry } from './npc-models';

const CAR_COLOR = 0xc94a3a;
const WHEEL_COLOR = 0x1a1a1a;
const MAX_SPEED_MPS = 30;
const MIN_STEERING_ANGLE = 0.16;
const MAX_STEERING_ANGLE = 0.5;

export interface VehicleDriveInput {
  readonly forward: boolean;
  readonly backward: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly handbrake: boolean;
}

export const NEUTRAL_DRIVE_INPUT: VehicleDriveInput = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  handbrake: false,
};

/** Steering narrows with speed so the GT stays controllable at 100 km/h. */
export function steeringLimitForSpeed(speedMps: number): number {
  const ratio = Math.min(Math.max(speedMps, 0) / 24, 1);
  return MAX_STEERING_ANGLE + (MIN_STEERING_ANGLE - MAX_STEERING_ANGLE) * ratio;
}

export class Vehicle {
  readonly group: THREE.Group;
  readonly chassisBody: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly color: number;
  private readonly wheels: THREE.Object3D[] = [];
  private readonly wheelHardpoints: THREE.Vector3[] = [];
  private readonly brakeLightMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly proceduralParts: THREE.Object3D[] = [];
  private readonly world: World;
  private smoothedSteering = 0;

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
      .setAngularDamping(4.0)
      .setCcdEnabled(true);
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
      this.wheelHardpoints.push(new THREE.Vector3(wp.x, -0.2, wp.z));
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
      // Steer about the parent's up axis first, then roll about the wheel axle.
      pivot.rotation.order = 'YXZ';
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

  /** Applies controls only; the physics world is stepped once by VehicleSimulation. */
  update(deltaSeconds: number, input: VehicleDriveInput): void {
    const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const targetSteering = steer * steeringLimitForSpeed(this.speed);
    this.smoothedSteering +=
      (targetSteering - this.smoothedSteering) * Math.min(1, deltaSeconds * 9);
    this.controller.setWheelSteering(0, this.smoothedSteering);
    this.controller.setWheelSteering(1, this.smoothedSteering);

    // Rapier's positive engine force pushes along -Z, while the GT's nose is +Z.
    // Throttle tapers near the top speed so the car no longer keeps accelerating
    // into wall contacts at 150 km/h.
    const forwardSpeed = this.forwardSpeed();
    const throttleScale = 1 - Math.min(Math.abs(forwardSpeed) / MAX_SPEED_MPS, 1) * 0.8;
    const engine =
      input.forward && forwardSpeed < MAX_SPEED_MPS
        ? -4000 * throttleScale
        : input.backward && forwardSpeed > -8
          ? 2000
          : 0;
    this.controller.setWheelEngineForce(2, engine);
    this.controller.setWheelEngineForce(3, engine);

    const brake = input.handbrake ? 60 : input.backward && !input.forward ? 30 : 0;
    for (let i = 0; i < 4; i += 1) this.controller.setWheelBrake(i, brake);
    // Rear slip drops under handbrake so the chassis rotates instead of gripping.
    const rearSlip = input.handbrake ? 1.6 : 4.5;
    this.controller.setWheelFrictionSlip(2, rearSlip);
    this.controller.setWheelFrictionSlip(3, rearSlip);

    this.controller.updateVehicle(deltaSeconds);
    const braking = input.handbrake || (input.backward && !input.forward);
    for (const material of this.brakeLightMaterials)
      material.emissiveIntensity = braking ? 2.2 : 0.12;
  }

  /** Runs after the single world step. Returns true when a contact was clamped. */
  postPhysics(): boolean {
    let clamped = false;
    // Prevent physical launch into the sky on curb or trimesh penetration.
    const linvel = this.chassisBody.linvel();
    if (linvel.y > 4.5) {
      this.chassisBody.setLinvel({ x: linvel.x, y: 4.5, z: linvel.z }, true);
      clamped = true;
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
      clamped = true;
    }

    // Sync visual mesh.
    const t = this.chassisBody.translation();
    const r = this.chassisBody.rotation();
    this.group.position.set(t.x, t.y, t.z);
    this.group.quaternion.set(r.x, r.y, r.z, r.w);

    // Keep wheel visuals in chassis-local space: wheelHardPoint() is world-space
    // and subtracting only the translation breaks as soon as the chassis yaws.
    for (let i = 0; i < 4; i += 1) {
      const w = this.wheels[i];
      const hardpoint = this.wheelHardpoints[i];
      if (!w || !hardpoint) continue;
      const rot = this.controller.wheelRotation(i);
      if (rot !== null) w.rotation.x = rot;
      const steerAng = this.controller.wheelSteering(i);
      if (steerAng !== null && i < 2) w.rotation.y = steerAng;
      w.position.set(
        hardpoint.x,
        hardpoint.y - (this.controller.wheelSuspensionLength(i) ?? 0.3),
        hardpoint.z,
      );
    }
    return clamped;
  }

  private forwardSpeed(): number {
    const velocity = this.chassisBody.linvel();
    const heading = this.heading;
    return velocity.x * Math.sin(heading) + velocity.z * Math.cos(heading);
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  /** Chassis yaw in radians, read from the physics body. */
  get heading(): number {
    const rotation = this.chassisBody.rotation();
    return 2 * Math.atan2(rotation.y, rotation.w);
  }

  /** Move the chassis once terrain height becomes available after streaming. */
  teleport(x: number, y: number, z: number, heading = 0): void {
    const half = heading * 0.5;
    const rotation = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
    this.chassisBody.setTranslation({ x, y: y + 0.82, z }, true);
    this.chassisBody.setRotation(rotation, true);
    this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.smoothedSteering = 0;
    this.group.position.set(x, y + 0.82, z);
    this.group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  async loadModel(chunks: ChunkManager, url: string): Promise<void> {
    const gltf = await chunks.loadModel(url, 80);
    const source = gltf.scene.clone(true);
    const wheelNames = ['WheelFrontLeft', 'WheelFrontRight', 'WheelRearLeft', 'WheelRearRight'];
    const detailedWheels = wheelNames.map((name) => {
      const wheel = source.getObjectByName(name);
      if (!wheel) throw new Error(`The sports car model is missing ${name}.`);
      wheel.parent?.remove(wheel);
      return wheel;
    });
    const model = mergeVehicleVisual(source, -0.42);
    model.name = 'Caceres GT';
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    this.group.add(model);

    // The GLB wheel nodes are centred on their axles, so reusing the existing
    // pivots keeps Rapier steering/rolling/suspension aligned with the body.
    for (let i = 0; i < this.wheels.length; i += 1) {
      const pivot = this.wheels[i];
      const wheel = detailedWheels[i];
      if (!pivot || !wheel) throw new Error('The sports car wheel setup is incomplete.');
      pivot.clear();
      wheel.position.set(0, 0, 0);
      wheel.rotation.set(0, 0, 0);
      wheel.scale.set(1, 1, 1);
      wheel.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = true;
        object.receiveShadow = true;
      });
      pivot.add(wheel);
    }
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

/** Merge the GLB body into one batch per material; wheels are handled by their pivots. */
function mergeVehicleVisual(source: THREE.Object3D, yOffset: number): THREE.Group {
  source.updateMatrixWorld(true);
  const batches = new Map<
    string,
    { material: THREE.Material; geometries: THREE.BufferGeometry[] }
  >();
  const bounds = new THREE.Box3().setFromObject(source);
  if (bounds.isEmpty()) throw new Error('The sports car model has no renderable geometry.');
  const center = bounds.getCenter(new THREE.Vector3());

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
      const material = materials[group.materialIndex ?? 0];
      if (!material) continue;
      // Transmission would force Three.js to render the whole scene again; the
      // tinted glass is already transparent through alpha.
      if (material instanceof THREE.MeshPhysicalMaterial && material.transmission > 0) {
        material.transmission = 0;
        material.needsUpdate = true;
      }
      const geometry = geometryForMaterialGroup(
        sourceGeometry,
        group.start,
        group.count,
        sourceGeometry.groups.length > 0,
      );
      geometry.applyMatrix4(object.matrixWorld);
      // Source glTF is Y-up with the wheels touching y=0 and their axles at
      // y=0.36. Keep its own vertical scale: only lower the ground plane to
      // the Rapier-controlled wheel pivots instead of centering the bounds.
      geometry.translate(-center.x, yOffset, -center.z);
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
    throw new Error('The sports car model could not be combined into renderable meshes.');
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
