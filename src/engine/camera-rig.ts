import { Euler, MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { InputManager, MovementAxes } from './input-manager';

export type CameraMode = 'free' | 'thirdPerson';

export class CameraRig {
  mode: CameraMode = 'free';
  occlusion: ((origin: Vector3, dir: Vector3, maxDist: number) => number) | undefined;
  private yaw = 0.58;
  private pitch = -0.27;
  private readonly direction = new Vector3();
  private readonly target = new Vector3();
  private readonly orbitOffset = new Vector3();
  private readonly orbitEuler = new Euler(0, 0, 0, 'YXZ');
  private readonly upAxis = new Vector3(0, 1, 0);
  private readonly axes: MovementAxes = { horizontal: 0, vertical: 0 };
  private mouseX = 0;
  private mouseY = 0;
  private readonly camera: PerspectiveCamera;
  private readonly input: InputManager;
  private readonly moveSpeed: number;
  private readonly mouseSensitivity: number;
  private readonly smoothPosition = new Vector3();
  private smoothInitialized = false;
  private targetFov: number;
  private readonly baseFov: number;
  private trauma = 0;

  constructor(
    camera: PerspectiveCamera,
    input: InputManager,
    moveSpeed = 8,
    mouseSensitivity = 0.002,
    initialYaw = 0.58,
    initialPitch = -0.27,
  ) {
    this.camera = camera;
    this.input = input;
    this.moveSpeed = moveSpeed;
    this.mouseSensitivity = mouseSensitivity;
    this.yaw = initialYaw;
    this.pitch = MathUtils.clamp(initialPitch, -1.45, 1.45);
    this.camera.rotation.order = 'YXZ';
    this.baseFov = camera.fov;
    this.targetFov = camera.fov;
    this.syncRotation();
  }

  toggleMode(): CameraMode {
    this.mode = this.mode === 'free' ? 'thirdPerson' : 'free';
    return this.mode;
  }

  getYaw(): number {
    return this.yaw;
  }

  /** Point the orbit camera behind a heading and snap the follow next frame. */
  setYaw(yaw: number): void {
    this.yaw = MathUtils.euclideanModulo(yaw + Math.PI, Math.PI * 2) - Math.PI;
    this.smoothInitialized = false;
    this.syncRotation();
  }

  /** Widens the field of view proportionally to driving speed. */
  setSpeedFov(speed: number): void {
    this.targetFov = this.baseFov + Math.min(speed * 0.35, 12);
  }

  resetFov(): void {
    this.targetFov = this.baseFov;
  }

  /** Adds rotational and positional trauma for impacts and crashes. */
  addTrauma(amount: number): void {
    this.trauma = MathUtils.clamp(this.trauma + amount, 0, 1);
  }

  update(deltaSeconds: number, focus?: Vector3): void {
    this.input.sampleGamepad();
    if (this.input.consumePressed('lookToggle')) this.toggleMode();
    this.mouseX = this.input.lookX;
    this.mouseY = this.input.lookY;
    this.input.consumeLookDelta();
    this.yaw -= this.mouseX * this.mouseSensitivity;
    this.pitch = MathUtils.clamp(this.pitch - this.mouseY * this.mouseSensitivity, -1.45, 1.45);
    this.syncRotation();

    if (this.mode === 'thirdPerson' && focus) {
      this.target.copy(focus);
      this.orbitEuler.set(this.pitch, this.yaw, 0, 'YXZ');
      this.orbitOffset.set(0, 2.6, 7.5).applyEuler(this.orbitEuler);
      const desired = this.target.clone().add(this.orbitOffset);
      if (this.occlusion) {
        const dir = desired.clone().sub(this.target);
        const maxDist = dir.length();
        if (maxDist > 0.01) {
          dir.normalize();
          const toi = this.occlusion(this.target, dir, maxDist);
          if (toi < maxDist - 0.2) {
            desired.copy(this.target).addScaledVector(dir, Math.max(0.5, toi - 0.3));
          }
        }
      }
      // Smooth follow instead of snapping; the camera glides toward the target.
      if (!this.smoothInitialized) {
        this.smoothPosition.copy(desired);
        this.smoothInitialized = true;
      }
      this.smoothPosition.lerp(desired, Math.min(1, deltaSeconds * 7));
      this.camera.position.copy(this.smoothPosition);
      if (this.trauma > 0) {
        const shake = this.trauma * this.trauma;
        this.camera.position.x += (Math.random() - 0.5) * 0.45 * shake;
        this.camera.position.y += (Math.random() - 0.5) * 0.35 * shake;
        this.camera.position.z += (Math.random() - 0.5) * 0.45 * shake;
        this.trauma = Math.max(0, this.trauma - deltaSeconds * 2.8);
      }
      this.camera.lookAt(this.target);
      this.updateFov(deltaSeconds);
      return;
    }

    this.input.movement(this.axes);
    this.direction
      .set(this.axes.horizontal, 0, -this.axes.vertical)
      .applyAxisAngle(this.upAxis, this.yaw);
    const speedMultiplier = this.input.isPressed('sprint') ? 5 : 1;
    this.camera.position.addScaledVector(
      this.direction,
      this.moveSpeed * speedMultiplier * deltaSeconds,
    );
    this.updateFov(deltaSeconds);
  }

  /** Smoothly interpolates the camera FOV toward the target value. */
  private updateFov(deltaSeconds: number): void {
    const diff = this.targetFov - this.camera.fov;
    if (Math.abs(diff) > 0.05) {
      this.camera.fov += diff * Math.min(1, deltaSeconds * 4);
      this.camera.updateProjectionMatrix();
    }
  }

  private syncRotation(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
