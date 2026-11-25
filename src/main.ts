import * as THREE from 'three';
import { CameraRig } from './engine/camera-rig';
import { FixedStepLoop } from './engine/game-loop';
import { InputManager } from './engine/input-manager';
import { DebugConsole } from './engine/debug-console';
import { Logger } from './engine/logger';
import { QUALITY_PRESETS } from './engine/quality';
import { t } from './i18n';
import { AgentColliders } from './world/agent-colliders';
import { ChunkManager } from './world/chunk-manager';
import { Character } from './world/character';
import { CrimeSystem } from './world/crime-system';
import { NpcSystem } from './world/npc-system';
import { PoliceSystem } from './world/police-system';
import { RoadGraph } from './world/road-graph';
import type { RoadNetwork } from './world/types';
import { Vehicle } from './world/vehicle';
import { createPhysicsWorld } from './world/terrain-physics';
import type { World } from '@dimforge/rapier3d-compat';
import { AudioSystem } from './engine/audio-system';
import { Minimap, type MinimapBlip } from './ui/minimap';
import './style.css';

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Falta un elemento requerido: ${selector}.`);
  return element;
}

const canvas = requiredElement<HTMLCanvasElement>('#world');
const fpsLabel = requiredElement<HTMLElement>('#fps');
const frameLabel = requiredElement<HTMLElement>('#frame-time');
const chunksLabel = requiredElement<HTMLElement>('#chunks');
const collidersLabel = requiredElement<HTMLElement>('#colliders');
const drawCallsLabel = requiredElement<HTMLElement>('#draw-calls');
const trianglesLabel = requiredElement<HTMLElement>('#triangles');
const memoryLabel = requiredElement<HTMLElement>('#memory');
const heapMemoryLabel = requiredElement<HTMLElement>('#heap-memory');
const agentsLabel = requiredElement<HTMLElement>('#agents');
const agentsLodLabel = requiredElement<HTMLElement>('#agents-lod');
const systemTimesLabel = requiredElement<HTMLElement>('#system-times');
const debugModesLabel = requiredElement<HTMLElement>('#debug-modes');
const wantedLabel = requiredElement<HTMLElement>('#wanted');
const noticeLabel = requiredElement<HTMLElement>('#notice');
const statusLabel = requiredElement<HTMLElement>('#world-status');
const debugPanel = requiredElement<HTMLElement>('.debug-panel');
const minimapCanvas = requiredElement<HTMLCanvasElement>('#minimap');
const minimap = new Minimap(minimapCanvas);
const audio = new AudioSystem();
requiredElement<HTMLElement>('#wanted-label').textContent = t('hud.wanted');
requiredElement<HTMLElement>('#controls-hint').textContent = t('controls.hint');
const query = new URLSearchParams(window.location.search);
const debugMode = query.get('debug') === '1';
if (debugMode) {
  debugPanel.classList.remove('is-hidden');
}
const cityKitEnabled = query.get('citykit') !== '0';
const quality = QUALITY_PRESETS.high;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: quality.antialias,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.14;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const fogColor = '#c8d7df';
renderer.setClearColor(fogColor);

const scene = new THREE.Scene();
scene.background = new THREE.Color(fogColor);
scene.fog = new THREE.Fog(fogColor, quality.viewDistance * 0.45, quality.viewDistance * 1.05);

// Gradient sky sphere with warm Iberian horizon and rich azure zenith.
const skyGeometry = new THREE.SphereGeometry(quality.viewDistance * 1.25, 32, 16);
const skyPositions = skyGeometry.attributes.position as THREE.BufferAttribute;
const skyColors = new Float32Array(skyPositions.count * 3);
for (let i = 0; i < skyPositions.count; i += 1) {
  const y = skyPositions.getY(i);
  const t = Math.max(
    0,
    Math.min(1, (y + quality.viewDistance * 0.15) / (quality.viewDistance * 1.35)),
  );
  const r =
    t < 0.28
      ? THREE.MathUtils.lerp(0.96, 0.68, t / 0.28)
      : THREE.MathUtils.lerp(0.68, 0.2, (t - 0.28) / 0.72);
  const g =
    t < 0.28
      ? THREE.MathUtils.lerp(0.88, 0.81, t / 0.28)
      : THREE.MathUtils.lerp(0.81, 0.48, (t - 0.28) / 0.72);
  const b =
    t < 0.28
      ? THREE.MathUtils.lerp(0.78, 0.9, t / 0.28)
      : THREE.MathUtils.lerp(0.9, 0.82, (t - 0.28) / 0.72);
  skyColors[i * 3] = r;
  skyColors[i * 3 + 1] = g;
  skyColors[i * 3 + 2] = b;
}
skyGeometry.setAttribute('color', new THREE.BufferAttribute(skyColors, 3));
const skyMaterial = new THREE.MeshBasicMaterial({
  vertexColors: true,
  side: THREE.BackSide,
  depthWrite: false,
});
const sky = new THREE.Mesh(skyGeometry, skyMaterial);
scene.add(sky);

// Radiant Sun disc and warm atmospheric halo in the Iberian sky
const sunDistance = quality.viewDistance * 1.18;
const sunDir = new THREE.Vector3(-320, 240, 220).normalize();
const sunDiskGeo = new THREE.CircleGeometry(quality.viewDistance * 0.045, 24);
const sunDiskMat = new THREE.MeshBasicMaterial({
  color: 0xfffaea,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const sunDisk = new THREE.Mesh(sunDiskGeo, sunDiskMat);
sunDisk.position.copy(sunDir).multiplyScalar(sunDistance);
sunDisk.lookAt(0, 0, 0);
scene.add(sunDisk);

const sunCoronaGeo = new THREE.RingGeometry(
  quality.viewDistance * 0.04,
  quality.viewDistance * 0.12,
  24,
);
const sunCoronaMat = new THREE.MeshBasicMaterial({
  color: 0xffdf9a,
  transparent: true,
  opacity: 0.38,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const sunCorona = new THREE.Mesh(sunCoronaGeo, sunCoronaMat);
sunCorona.position.copy(sunDisk.position);
sunCorona.lookAt(0, 0, 0);
scene.add(sunCorona);

const camera = new THREE.PerspectiveCamera(
  54,
  window.innerWidth / window.innerHeight,
  0.5,
  quality.viewDistance + 50,
);
camera.position.set(0, 570, 72);
const input = new InputManager(canvas);
const cameraRig = new CameraRig(camera, input, 5.2, 0.002, 2.07, -0.12);
cameraRig.mode = 'thirdPerson';
const logger = new Logger('world', 'info');
const character = new Character();
scene.add(new THREE.HemisphereLight('#9ec6e8', '#5a4836', 2.0));
scene.add(character.group);

// Dramatic warm afternoon sun angle creating authentic long shadows
const sun = new THREE.DirectionalLight('#fff0d6', 3.6);
sun.position.set(-320, 240, 220);
sun.castShadow = true;
sun.shadow.mapSize.width = quality.shadowMapSize;
sun.shadow.mapSize.height = quality.shadowMapSize;
sun.shadow.camera.near = 50;
sun.shadow.camera.far = 850;
const shadowSpan = 240;
sun.shadow.camera.left = -shadowSpan;
sun.shadow.camera.right = shadowSpan;
sun.shadow.camera.top = shadowSpan;
sun.shadow.camera.bottom = -shadowSpan;
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.035;
scene.add(sun);
scene.add(sun.target);

let world: World | undefined;
let chunks: ChunkManager | undefined;
let agentColliders: AgentColliders | undefined;
let npcs: NpcSystem | undefined;
let police: PoliceSystem | undefined;
const crime = new CrimeSystem();
const vehicles: Vehicle[] = [];

function modelUrl(path: string): string {
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.href);
  return new URL(path, baseUrl).href;
}

function loadVehicleVisual(vehicle: Vehicle): void {
  if (!chunks) return;
  void vehicle
    .loadModel(chunks, modelUrl('models/vehicles/caceres-gt.glb'))
    .catch((error: unknown) => {
      logger.warn('Detailed vehicle model failed to load; keeping the built-in vehicle', {
        error: String(error),
      });
    });
}

let activeVehicle: Vehicle | null = null;
let initialVehiclePlaced = false;
let inVehicle = false;
let spacePressed = false;
let hornPressed = false;
let previousStars = 0;
const minimapVehicles: MinimapBlip[] = [];
const minimapPolice: MinimapBlip[] = [];
let showDebug = debugMode;
let showChunkBorders = debugMode;
let showColliderWireframes = false;
let showRoadWireframes = false;
let showLodBounds = false;
let showShadows = true;
let noclipEnabled = false;
let frameCount = 0;
let frameWindowStart = performance.now();
let previousFrameTimestamp = frameWindowStart;
let maximumFrameMs = 0;
let lastStatsUpdate = frameWindowStart;
let physicsQueryMs = 0;
let actorUpdateMs = 0;
let streamingUpdateMs = 0;
let renderUpdateMs = 0;
let noticeUntil = 0;
let bustCooldownUntil = 0;
let recklessSeconds = 0;
let focusInitialized = false;
const previousFocus = new THREE.Vector3();

interface DebugSnapshot {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly groundHeight: number | null;
  readonly loadedChunks: number;
  readonly pendingChunks: number;
  readonly colliderCount: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly worldMemoryMiB: number;
  readonly heapMemoryMiB: number | null;
  readonly agentsByLod: readonly [number, number, number];
  readonly fps: number;
  readonly peakFrameMs: number;
  readonly systemTimesMs: {
    readonly physicsQuery: number;
    readonly actorUpdate: number;
    readonly streamingUpdate: number;
    readonly render: number;
  };
}

declare global {
  interface Window {
    __CTA_DEBUG__?: {
      teleport(x: number, z: number): void;
      metrics(): DebugSnapshot;
    };
  }
}

const debugConsole = new DebugConsole(
  requiredElement<HTMLElement>('#debug-console'),
  requiredElement<HTMLElement>('#debug-console-output'),
  requiredElement<HTMLFormElement>('#debug-console-form'),
  requiredElement<HTMLInputElement>('#debug-console-input'),
  {
    teleport: teleportToLandmark,
    spawnVehicle: spawnDebugVehicle,
    toggleNoclip: () => {
      noclipEnabled = !noclipEnabled;
      cameraRig.mode = noclipEnabled ? 'free' : 'thirdPerson';
      return `Cámara noclip ${noclipEnabled ? 'activada' : 'desactivada'}.`;
    },
  },
);

function debugSnapshot(): DebugSnapshot {
  const position = character.position;
  const browserMemory = (performance as Performance & { memory?: { usedJSHeapSize: number } })
    .memory;
  return {
    position: { x: position.x, y: position.y, z: position.z },
    groundHeight: chunks?.groundHeightAt(position.x, position.z) ?? null,
    loadedChunks: chunks?.loadedCount ?? 0,
    pendingChunks: chunks?.pendingCount ?? 0,
    colliderCount: chunks?.colliderCount ?? 0,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    worldMemoryMiB: chunks?.memoryMiB ?? 0,
    heapMemoryMiB: browserMemory ? browserMemory.usedJSHeapSize / (1024 * 1024) : null,
    agentsByLod: npcs?.lodCounts ?? [0, 0, 0],
    fps: Number(fpsLabel.textContent ?? 0),
    peakFrameMs: maximumFrameMs,
    systemTimesMs: {
      physicsQuery: physicsQueryMs,
      actorUpdate: actorUpdateMs,
      streamingUpdate: streamingUpdateMs,
      render: renderUpdateMs,
    },
  };
}

function teleportForAudit(x: number, z: number): void {
  noclipEnabled = false;
  inVehicle = false;
  activeVehicle = null;
  cameraRig.mode = 'thirdPerson';
  const ground = chunks?.groundHeightAt(x, z);
  character.position.set(x, ground ?? character.position.y, z);
  character.group.visible = true;
  focusInitialized = false;
  camera.position.set(x, character.position.y + 8, z + 9);
}

if (debugMode) window.__CTA_DEBUG__ = { teleport: teleportForAudit, metrics: debugSnapshot };

function normalizeLandmarkQuery(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-ES')
    .trim();
}

async function teleportToLandmark(query: string): Promise<string> {
  const response = await fetch(
    new URL(
      'data/landmarks/landmarks.json',
      new URL(import.meta.env.BASE_URL, window.location.href),
    ),
  );
  if (!response.ok) throw new Error(`no se pudo leer el catálogo de hitos (${response.status}).`);
  const catalog = (await response.json()) as {
    landmarks: {
      id: string;
      name: string;
      position?: { localMeters?: readonly [number, number] };
    }[];
  };
  const normalized = normalizeLandmarkQuery(query);
  const landmark = catalog.landmarks.find(
    (item) =>
      normalizeLandmarkQuery(item.id) === normalized ||
      normalizeLandmarkQuery(item.name) === normalized,
  );
  const point = landmark?.position?.localMeters;
  if (!landmark || !point)
    throw new Error(`no encuentro el hito «${query}» con coordenadas disponibles.`);
  teleportForAudit(point[0], point[1]);
  return `Teletransporte: ${landmark.name}.`;
}

function spawnDebugVehicle(): string {
  if (!world || !chunks) throw new Error('el mundo físico todavía no está listo.');
  const position = character.position;
  const x = position.x + 4;
  const z = position.z;
  const height = chunks.groundHeightAt(x, z) ?? position.y;
  const vehicle = new Vehicle(world, x, height, z, cameraRig.getYaw());
  vehicles.push(vehicle);
  scene.add(vehicle.group);
  loadVehicleVisual(vehicle);
  world.updateSceneQueries();
  return 'Vehículo de pruebas creado a 4 m del jugador.';
}

function updateDebugModeLabel(): void {
  debugModesLabel.textContent = `F5 colisiones ${showColliderWireframes ? 'ON' : 'OFF'} · F6 calzadas ${showRoadWireframes ? 'ON' : 'OFF'} · F7 LOD ${showLodBounds ? 'ON' : 'OFF'} · F8 sombras ${showShadows ? 'ON' : 'OFF'} · F9 city kit ${cityKitEnabled ? 'ON' : 'OFF'}`;
}

updateDebugModeLabel();

function showNotice(message: string, timestamp: number, durationMs = 3000): void {
  noticeLabel.textContent = message;
  noticeLabel.hidden = false;
  noticeUntil = timestamp + durationMs;
}

function handleBust(timestamp: number): void {
  bustCooldownUntil = timestamp + 4000;
  crime.reset();
  audio.playBusted();
  cameraRig.addTrauma(0.5);
  inVehicle = false;
  activeVehicle = null;
  character.group.visible = true;
  character.position.set(0, chunks?.groundHeightAt(0, 0) ?? 0, 0);
  cameraRig.mode = 'thirdPerson';
  focusInitialized = false;
  showNotice(t('notice.busted'), timestamp, 3500);
  logger.info('Player busted', { stars: crime.stars });
}

function updateDebug(timestamp: number): void {
  if (!chunks || timestamp - lastStatsUpdate < 250) return;
  chunksLabel.textContent = `${chunks.loadedCount} cargados · ${chunks.pendingCount} en cola · ${chunks.failures} errores`;
  collidersLabel.textContent = String(chunks.colliderCount);
  drawCallsLabel.textContent = String(renderer.info.render.calls);
  trianglesLabel.textContent = renderer.info.render.triangles.toLocaleString('es-ES');
  memoryLabel.textContent = `≈ ${chunks.memoryMiB.toFixed(1)} MiB`;
  const browserMemory = (performance as Performance & { memory?: { usedJSHeapSize: number } })
    .memory;
  heapMemoryLabel.textContent = browserMemory
    ? `≈ ${(browserMemory.usedJSHeapSize / (1024 * 1024)).toFixed(1)} MiB`
    : 'n/d';
  systemTimesLabel.textContent = `física ${physicsQueryMs.toFixed(2)} · jugador ${actorUpdateMs.toFixed(2)} · streaming ${streamingUpdateMs.toFixed(2)} · render ${renderUpdateMs.toFixed(2)} ms`;
  const agents = npcs?.counts;
  agentsLabel.textContent = agents
    ? `${agents.pedestrians} peatones · ${agents.vehicles} coches`
    : 'cargando red viaria…';
  agentsLodLabel.textContent = (npcs?.lodCounts ?? [0, 0, 0]).join(' / ');
  const stars = crime.stars;
  wantedLabel.textContent = stars > 0 ? `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}` : '—';
  statusLabel.textContent =
    chunks.loadedCount > 0
      ? 'Edificios, calles y terreno MDT05 en streaming'
      : 'Preparando la ciudad desde datos oficiales…';
  if (noticeUntil > 0 && timestamp >= noticeUntil) {
    noticeLabel.hidden = true;
    noticeUntil = 0;
  }
  lastStatsUpdate = timestamp;
}

const loop = new FixedStepLoop([], (interpolation, frameSeconds, timestamp) => {
  void interpolation;
  // Rapier raycasts (vehicle suspension, camera occlusion) need an up-to-date
  // query pipeline before any of this frame's collider consumers run.
  let systemStart = debugMode ? performance.now() : 0;
  chunks?.refreshPhysicsQueries();
  if (debugMode) physicsQueryMs = performance.now() - systemStart;
  systemStart = debugMode ? performance.now() : 0;
  const rawFrameMs = Math.max(0, timestamp - previousFrameTimestamp);
  previousFrameTimestamp = timestamp;
  maximumFrameMs = Math.max(maximumFrameMs, rawFrameMs);
  if (inVehicle && activeVehicle) {
    const driveInput = {
      forward: input.isPressed('moveForward'),
      backward: input.isPressed('moveBack'),
      left: input.isPressed('moveLeft'),
      right: input.isPressed('moveRight'),
      handbrake: spacePressed,
    };
    activeVehicle.update(frameSeconds, driveInput);
    audio.updateVehicleEngine(true, activeVehicle.speed, driveInput.forward || driveInput.backward);
    const isSkidding =
      (driveInput.handbrake && activeVehicle.speed > 3) ||
      ((driveInput.left || driveInput.right) && activeVehicle.speed > 9);
    audio.updateSkid(isSkidding);
    audio.setHorn(hornPressed);
    cameraRig.mode = 'thirdPerson';
    cameraRig.setSpeedFov(activeVehicle.speed);
    cameraRig.update(frameSeconds, activeVehicle.position);
    const vh = chunks?.groundHeightAt(camera.position.x, camera.position.z);
    if (vh !== undefined && camera.position.y < vh + 0.5) camera.position.y = vh + 0.5;
    if (chunks?.collidesWithBuilding(camera.position.x, camera.position.z, 0)) {
      const dir = camera.position.clone().sub(activeVehicle.position);
      const dist = dir.length();
      if (dist > 0.1) {
        dir.normalize();
        for (let i = 0; i < 8; i += 1) {
          camera.position
            .copy(activeVehicle.position)
            .addScaledVector(dir, dist * (1 - (i + 1) / 9));
          if (!chunks.collidesWithBuilding(camera.position.x, camera.position.z, 0)) break;
        }
      }
    }
  } else if (cameraRig.mode === 'thirdPerson') {
    cameraRig.resetFov();
    audio.updateVehicleEngine(false, 0, false);
    audio.updateSkid(false);
    audio.setHorn(false);
    character.update(frameSeconds, input, chunks, cameraRig.getYaw(), spacePressed);
    if (character.stepTriggered) audio.playFootstep();
    // The character is scripted (not a Rapier body), so resolve agent overlap here.
    npcs?.resolveCollision(character.position, 0.35);
    police?.resolveCollision(character.position, 0.35);
    cameraRig.update(frameSeconds, character.position);
    const ch = chunks?.groundHeightAt(camera.position.x, camera.position.z);
    if (ch !== undefined && camera.position.y < ch + 0.5) camera.position.y = ch + 0.5;
    // Safety: if the camera ended up inside a building footprint, pull it toward the character.
    if (chunks?.collidesWithBuilding(camera.position.x, camera.position.z, 0)) {
      const dir = camera.position.clone().sub(character.position);
      const dist = dir.length();
      if (dist > 0.1) {
        dir.normalize();
        for (let i = 0; i < 8; i += 1) {
          camera.position.copy(character.position).addScaledVector(dir, dist * (1 - (i + 1) / 9));
          if (!chunks.collidesWithBuilding(camera.position.x, camera.position.z, 0)) break;
        }
      }
      const ch2 = chunks.groundHeightAt(camera.position.x, camera.position.z);
      if (ch2 !== undefined && camera.position.y < ch2 + 0.5) camera.position.y = ch2 + 0.5;
    }
  } else {
    audio.updateVehicleEngine(false, 0, false);
    audio.updateSkid(false);
    audio.setHorn(false);
    cameraRig.update(frameSeconds);
    character.position.copy(camera.position);
    const characterGround = chunks?.groundHeightAt(character.position.x, character.position.z);
    if (characterGround !== undefined) character.position.y = characterGround;
  }
  if (debugMode) actorUpdateMs = performance.now() - systemStart;
  if (cameraRig.mode === 'free' && !noclipEnabled) {
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -500, 500);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -500, 500);
    const groundHeight = chunks?.groundHeightAt(camera.position.x, camera.position.z);
    if (groundHeight !== undefined) camera.position.y = groundHeight + 1.7;
  }
  const focus = inVehicle && activeVehicle ? activeVehicle.position : character.position;
  let playerSpeed = 0;
  if (focusInitialized)
    playerSpeed = Math.min(focus.distanceTo(previousFocus) / Math.max(frameSeconds, 1 / 120), 25);
  previousFocus.copy(focus);
  focusInitialized = true;
  if (inVehicle && activeVehicle) playerSpeed = activeVehicle.speed;

  sun.position.set(focus.x - 320, 240, focus.z + 220);
  sun.target.position.set(focus.x, focus.y, focus.z);
  sky.position.set(focus.x, focus.y * 0.2, focus.z);
  sunDisk.position.set(
    focus.x + sunDir.x * sunDistance,
    focus.y * 0.2 + sunDir.y * sunDistance,
    focus.z + sunDir.z * sunDistance,
  );
  sunCorona.position.copy(sunDisk.position);

  if (npcs && chunks) npcs.update(frameSeconds, focus, camera, chunks);
  if (police && chunks) {
    police.update(frameSeconds, crime.stars, focus, camera, chunks);
    crime.update(frameSeconds, police.nearestDistance(focus), playerSpeed);
    if (crime.busted && timestamp > bustCooldownUntil) handleBust(timestamp);
  }
  if (crime.stars > previousStars) {
    audio.playCrimeAlert();
  }
  previousStars = crime.stars;
  audio.updatePoliceSiren(crime.stars, police ? police.nearestDistance(focus) : 999);

  if (
    npcs &&
    inVehicle &&
    activeVehicle &&
    activeVehicle.speed > 6 &&
    npcs.checkVehicleImpact(activeVehicle.position)
  ) {
    if (crime.report('pedestrianImpact', activeVehicle.position.x, activeVehicle.position.z)) {
      npcs.alarm(activeVehicle.position.x, activeVehicle.position.z);
      showNotice(t('notice.pedestrianImpact'), timestamp);
      audio.playCollision(0.8);
      cameraRig.addTrauma(0.55);
    }
  }
  if (inVehicle && activeVehicle && activeVehicle.speed > 16) {
    recklessSeconds += frameSeconds;
    if (recklessSeconds > 2.5 && crime.report('recklessDriving', focus.x, focus.z))
      recklessSeconds = 0;
  } else {
    recklessSeconds = 0;
  }

  if (npcs) npcs.getVehiclePositions(minimapVehicles);
  if (police) police.getPatrolPositions(minimapPolice);
  minimap.update(
    focus.x,
    focus.z,
    cameraRig.getYaw(),
    inVehicle,
    crime.stars,
    minimapVehicles,
    minimapPolice,
    frameSeconds,
  );

  systemStart = debugMode ? performance.now() : 0;
  chunks?.update(camera, timestamp);
  if (debugMode) streamingUpdateMs = performance.now() - systemStart;
  // The initial vehicle is created before chunk heights exist; place it as soon
  // as streaming publishes the spawn height so it cannot fall through the map.
  const initialVehicle = vehicles[0];
  if (!initialVehiclePlaced && initialVehicle && chunks) {
    const ground = chunks.groundHeightAt(8, 8);
    if (ground !== undefined) {
      initialVehicle.teleport(8, ground, 8, 0);
      initialVehiclePlaced = true;
    }
  }
  systemStart = debugMode ? performance.now() : 0;
  renderer.render(scene, camera);
  if (debugMode) renderUpdateMs = performance.now() - systemStart;
  frameCount += 1;
  if (timestamp - frameWindowStart >= 500) {
    fpsLabel.textContent = String(Math.round((frameCount * 1000) / (timestamp - frameWindowStart)));
    frameLabel.textContent = `${maximumFrameMs.toFixed(1)} ms`;
    frameCount = 0;
    frameWindowStart = timestamp;
    maximumFrameMs = 0;
  }
  updateDebug(timestamp);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (!debugMode) {
    if (event.code !== 'F4') return;
    event.preventDefault();
    showDebug = !showDebug;
    debugPanel.classList.toggle('is-hidden', !showDebug);
    chunks?.setDebugBorders(showDebug);
    return;
  }
  if (event.code === 'Escape' && debugConsole.isOpen) {
    debugConsole.setOpen(false);
    return;
  }
  if (debugConsole.isInputFocused) return;
  switch (event.code) {
    case 'F3':
      event.preventDefault();
      showDebug = !showDebug;
      debugPanel.classList.toggle('is-hidden', !showDebug);
      break;
    case 'F4':
      event.preventDefault();
      showChunkBorders = !showChunkBorders;
      chunks?.setDebugBorders(showChunkBorders);
      break;
    case 'F5':
      event.preventDefault();
      showColliderWireframes = !showColliderWireframes;
      chunks?.setDebugColliders(showColliderWireframes);
      break;
    case 'F6':
      event.preventDefault();
      showRoadWireframes = !showRoadWireframes;
      chunks?.setDebugRoadSurfaces(showRoadWireframes);
      break;
    case 'F7':
      event.preventDefault();
      showLodBounds = !showLodBounds;
      chunks?.setDebugLodBounds(showLodBounds);
      break;
    case 'F8':
      event.preventDefault();
      showShadows = !showShadows;
      renderer.shadowMap.enabled = showShadows;
      break;
    case 'F9':
      event.preventDefault();
      debugConsole.append(
        cityKitEnabled
          ? 'F9: city kit GLB activo. Añade ?citykit=0 para comparar con el mobiliario procedural.'
          : 'F9: city kit desactivado (?citykit=0). Recarga sin ese parámetro para volver a los GLB.',
      );
      debugConsole.setOpen(true);
      break;
    case 'Backquote':
      event.preventDefault();
      debugConsole.toggle();
      break;
    default:
      return;
  }
  updateDebugModeLabel();
});

canvas.addEventListener('click', () => {
  input.requestPointerLock();
  audio.resume();
});
window.addEventListener('pointerdown', () => audio.resume(), { once: true });
window.addEventListener('keydown', (event: KeyboardEvent) => {
  audio.resume();
  if (event.code === 'KeyH') hornPressed = true;
  if (event.code === 'KeyM') {
    const isMuted = audio.toggleMute();
    showNotice(isMuted ? t('notice.audioMuted') : t('notice.audioUnmuted'), performance.now());
  }
  if (event.code === 'Space') {
    spacePressed = true;
    event.preventDefault();
  }
  if (event.code === 'KeyE') {
    if (inVehicle && activeVehicle) {
      const side = new THREE.Vector3(1.8, 0, 0).applyQuaternion(activeVehicle.group.quaternion);
      let exitPos = activeVehicle.position.clone().add(side);
      if (chunks?.collidesWithBuilding(exitPos.x, exitPos.z, 0.4)) {
        exitPos = activeVehicle.position.clone().sub(side);
      }
      character.position.copy(exitPos);
      const h = chunks?.groundHeightAt(character.position.x, character.position.z);
      if (h !== undefined) character.position.y = h;
      inVehicle = false;
      activeVehicle = null;
      character.group.visible = true;
      cameraRig.mode = 'thirdPerson';
    } else {
      // Prefer a vehicle the player already owns, then requisition an ambient one.
      let nearest: Vehicle | null = null;
      let best = 3;
      for (const v of vehicles) {
        const d = v.position.distanceTo(character.position);
        if (d < best) {
          best = d;
          nearest = v;
        }
      }
      if (!nearest && npcs && world) {
        const claimed = npcs.claimVehicle(character.position, 4.5);
        if (claimed) {
          const stolen = new Vehicle(
            world,
            claimed.x,
            claimed.y,
            claimed.z,
            claimed.heading,
            claimed.color,
          );
          vehicles.push(stolen);
          scene.add(stolen.group);
          stolen.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
          stolen.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
          loadVehicleVisual(stolen);
          world.updateSceneQueries();
          nearest = stolen;
          if (crime.report('vehicleTheft', claimed.x, claimed.z)) {
            npcs.alarm(claimed.x, claimed.z);
            showNotice(t('notice.vehicleTheft'), performance.now());
          }
        }
      }
      if (nearest) {
        inVehicle = true;
        activeVehicle = nearest;
        character.position.copy(nearest.position);
        character.group.visible = false;
      } else {
        showNotice(t('notice.noVehicle'), performance.now(), 1600);
      }
    }
  }
});
window.addEventListener('keyup', (event: KeyboardEvent) => {
  if (event.code === 'Space') spacePressed = false;
  if (event.code === 'KeyH') hornPressed = false;
});
window.addEventListener('pagehide', () => {
  loop.stop();
  input.dispose();
  npcs?.dispose();
  police?.dispose();
  agentColliders?.dispose();
  chunks?.close();
  renderer.dispose();
});

async function initializeWorld(): Promise<void> {
  world = await createPhysicsWorld();
  agentColliders = new AgentColliders(world);
  const worldBaseUrl = new URL(import.meta.env.BASE_URL, window.location.href);
  const manifestUrl = new URL('world/cc-monumental/manifest.json', worldBaseUrl);
  chunks = new ChunkManager(scene, world, manifestUrl, worldBaseUrl, cityKitEnabled);
  cameraRig.occlusion = (origin, dir, maxDist) =>
    chunks?.cameraOcclusion(origin, dir, maxDist) ?? maxDist;
  chunks.events.on('chunkLoaded', ({ id, lod }) =>
    logger.debug('Terrain chunk loaded', { id, lod }),
  );
  chunks.events.on('chunkUnloaded', ({ id }) => logger.debug('Terrain chunk unloaded', { id }));
  await chunks.initialize();
  const startHeight = chunks.groundHeightAt(0, 0);
  if (startHeight !== undefined) character.position.y = startHeight;
  if (world) {
    const spawnH = chunks.groundHeightAt(8, 8) ?? 0;
    const vehicle = new Vehicle(world, 8, spawnH, 8, 0);
    vehicles.push(vehicle);
    scene.add(vehicle.group);
    // The chassis collider was created outside TerrainColliders.
    world.updateSceneQueries();
  }
  await chunks.prepareRenderer(renderer, camera);
  chunks.setDebugBorders(showDebug);
  void character
    .loadModel(chunks, modelUrl('models/characters/caceres-pedestrian.glb'))
    .catch((error: unknown) => {
      logger.warn('Detailed player model failed to load; keeping the built-in character', {
        error: String(error),
      });
    });
  for (const vehicle of vehicles) loadVehicleVisual(vehicle);
  statusLabel.textContent = 'Ciudad lista · WASD camina · clic captura el ratón';
  logger.info('World streaming initialized', { region: 'cc-monumental', stepHz: 60, lods: 3 });
  void initializeNpcs(worldBaseUrl).catch((error: unknown) => {
    agentsLabel.textContent = 'sin red viaria';
    logger.warn('Traffic initialization failed', { error: String(error) });
  });
}

async function initializeNpcs(worldBaseUrl: URL): Promise<void> {
  // Deferred until the visible world is ready: the road graph is ~30 MB and
  // must not block the first rendered frame.
  const url = new URL('world/cc-monumental/road-network.json', worldBaseUrl);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`road-network.json HTTP ${response.status}`);
  const network = (await response.json()) as RoadNetwork;
  const graph = new RoadGraph(network);
  npcs = new NpcSystem(
    graph,
    {
      pedestrians: Math.round(150 * quality.populationDensity),
      vehicles: Math.round(60 * quality.populationDensity),
    },
    agentColliders,
  );
  scene.add(npcs.group);
  if (chunks) {
    void chunks
      .loadModel(modelUrl('models/characters/caceres-pedestrian.glb'), 60)
      .then((gltf) => npcs?.setPedestrianModel(gltf))
      .catch((error: unknown) => {
        logger.warn('Detailed pedestrian model failed to load; keeping the built-in crowd', {
          error: String(error),
        });
      });
  }
  police = new PoliceSystem(graph, agentColliders);
  scene.add(police.group);
  logger.info('Traffic and pedestrians initialized', {
    nodes: graph.nodeCount,
    segments: graph.segments.length,
    density: quality.populationDensity,
  });
}

void initializeWorld().catch((error: unknown) => {
  statusLabel.textContent =
    error instanceof Error
      ? `No se pudo iniciar el mundo: ${error.message}`
      : 'No se pudo iniciar el mundo.';
  logger.error('World initialization failed', { error: String(error) });
});
loop.start();
