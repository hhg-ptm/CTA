import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type ShadowProfile = 'wide' | 'balanced' | 'proxy';

interface PassBreakdown {
  readonly mainDrawCalls: number;
  readonly mainTriangles: number;
  readonly shadowDrawCalls: number;
  readonly shadowTriangles: number;
  readonly totalDrawCalls: number;
  readonly totalTriangles: number;
  readonly cpuShadowMs: number;
  readonly cpuMainMs: number;
  readonly cpuRenderTotalMs: number;
  readonly gpuTimerSupported: boolean;
  readonly gpuShadowMs: number | null;
  readonly gpuMainMs: number | null;
  readonly gpuTotalMs: number | null;
  readonly blenderShadowStats: {
    readonly profile: ShadowProfile;
    readonly lod0Cells: number;
    readonly lod1Cells: number;
    readonly lod2Cells: number;
    readonly shadowLod0Cells: number;
    readonly shadowLod1Cells: number;
    readonly shadowLod2Cells: number;
    readonly shadowProxyCells: number;
    readonly shadowCulledCells: number;
    readonly landmarkCasters: number;
  } | null;
}

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
  readonly fps: number;
  readonly peakFrameMs: number;
  readonly systemTimesMs: {
    readonly physicsQuery: number;
    readonly actorUpdate: number;
    readonly cameraOcclusion: number;
    readonly npcAi: number;
    readonly streamingUpdate: number;
    readonly render: number;
  };
  readonly passBreakdown: PassBreakdown;
}

declare global {
  interface Window {
    __CTA_DEBUG__?: {
      teleport(x: number, z: number): void;
      setView(x: number, y: number, z: number, yaw: number, pitch: number): void;
      thirdPersonView(x: number, z: number, yaw?: number, pitch?: number): void;
      setShadowProfile(profile: ShadowProfile): void;
      metrics(): DebugSnapshot;
    };
  }
}

interface ZoneGallerySpec {
  readonly key: string;
  readonly label: string;
  readonly player: { readonly x: number; readonly z: number };
  readonly focus: { readonly x: number; readonly z: number; readonly targetYOffset: number };
  readonly calle: { readonly x: number; readonly z: number; readonly heightAboveGround: number };
  readonly aerea: { readonly x: number; readonly z: number; readonly heightAboveGround: number };
  readonly fachada: {
    readonly x: number;
    readonly z: number;
    readonly heightAboveGround: number;
    readonly targetYOffset?: number;
  };
}

const GALLERY_ZONES: readonly ZoneGallerySpec[] = [
  {
    key: '01-casco-plaza',
    label: 'Casco Histórico — Plaza Mayor y Ayuntamiento',
    player: { x: -12, z: 32 },
    focus: { x: -34, z: -7, targetYOffset: 7.5 },
    calle: { x: -16, z: 54, heightAboveGround: 2.5 },
    aerea: { x: 64, z: 42, heightAboveGround: 64 },
    fachada: { x: -8, z: 22, heightAboveGround: 5.5, targetYOffset: 7.0 },
  },
  {
    key: '01b-casco-interior',
    label: 'Casco Histórico — Calles Interiores y Palacios (Santa María / Adarves)',
    player: { x: -6, z: -28 },
    focus: { x: -56, z: -42, targetYOffset: 7.0 },
    calle: { x: 0, z: -4, heightAboveGround: 2.6 },
    aerea: { x: 35, z: -5, heightAboveGround: 52 },
    fachada: { x: -12, z: -28, heightAboveGround: 4.8, targetYOffset: 6.5 },
  },
  {
    key: '02-canovas',
    label: 'Cánovas — Avenidas y Bloques Residenciales',
    player: { x: -516, z: -362 },
    focus: { x: -556, z: -332, targetYOffset: 12.0 },
    calle: { x: -508, z: -385, heightAboveGround: 2.6 },
    aerea: { x: -458, z: -268, heightAboveGround: 72 },
    fachada: { x: -522, z: -368, heightAboveGround: 7.0, targetYOffset: 10.5 },
  },
  {
    key: '03-nuevo-caceres',
    label: 'Nuevo Cáceres — Viviendas Modernas',
    player: { x: -1044.9, z: -1031.5 },
    focus: { x: -1088, z: -1080, targetYOffset: 9.5 },
    calle: { x: -1053.6, z: -1120.2, heightAboveGround: 2.6 },
    aerea: { x: -1025, z: -1015, heightAboveGround: 68 },
    fachada: { x: -1077.4, z: -1014.4, heightAboveGround: 5.8, targetYOffset: 8.5 },
  },
  {
    key: '04-mejostilla',
    label: 'Mejostilla — Bloques y Residencial Reciente',
    player: { x: 337.8, z: 1385.5 },
    focus: { x: 410, z: 1345, targetYOffset: 10.5 },
    calle: { x: 422.4, z: 1367.1, heightAboveGround: 2.6 },
    aerea: { x: 495, z: 1275, heightAboveGround: 70 },
    fachada: { x: 377.3, z: 1310.2, heightAboveGround: 5.8, targetYOffset: 8.0 },
  },
  {
    key: '05-aldea-moret',
    label: 'Aldea Moret — Arquitectura Tradicional y Residencial',
    player: { x: -774.1, z: -2107.5 },
    focus: { x: -805, z: -2062, targetYOffset: 7.0 },
    calle: { x: -758.2, z: -2103.4, heightAboveGround: 3.0 },
    aerea: { x: -735, z: -1995, heightAboveGround: 58 },
    fachada: { x: -791.2, z: -2040.1, heightAboveGround: 4.5, targetYOffset: 6.2 },
  },
  {
    key: '06-industrial',
    label: 'Zonas Industriales — Polígono Charca Musia',
    player: { x: 350, z: -2470 },
    focus: { x: 382, z: -2520, targetYOffset: 5.5 },
    calle: { x: 349.1, z: -2474.3, heightAboveGround: 2.8 },
    aerea: { x: 485, z: -2425, heightAboveGround: 56 },
    fachada: { x: 400, z: -2510, heightAboveGround: 4.2, targetYOffset: 4.8 },
  },
  {
    key: '07-campus',
    label: 'Campus Universitario — Facultades y Equipamientos',
    player: { x: 2304.8, z: 716.7 },
    focus: { x: 2335, z: 695, targetYOffset: 8.5 },
    calle: { x: 2379.8, z: 706.1, heightAboveGround: 2.6 },
    aerea: { x: 2435, z: 795, heightAboveGround: 64 },
    fachada: { x: 2318, z: 716, heightAboveGround: 5.0, targetYOffset: 7.0 },
  },
  {
    key: '08-chalets',
    label: 'Zonas de Chalets — Vistahermosa',
    player: { x: -2008, z: -48 },
    focus: { x: -1998, z: -68, targetYOffset: 4.6 },
    calle: { x: -2016, z: -50, heightAboveGround: 2.5 },
    aerea: { x: -1950, z: -18, heightAboveGround: 52 },
    fachada: { x: -2012, z: -56, heightAboveGround: 3.6, targetYOffset: 4.2 },
  },
];

interface WorstCaseSpec {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly z: number;
  readonly camX: number;
  readonly camZ: number;
  readonly camHeight: number;
  readonly focusX: number;
  readonly focusZ: number;
  readonly cpuThrottleRate?: number;
  readonly urlParams?: string;
}

const WORST_CASES: readonly WorstCaseSpec[] = [
  {
    id: 'wc-casco-corazon-proxy',
    label: 'Casco Histórico Corazón (-1_-1, densidad máxima · proxy)',
    x: -12,
    z: 32,
    camX: -12,
    camZ: 32,
    camHeight: 2.2,
    focusX: -34,
    focusZ: -7,
  },
  {
    id: 'wc-casco-panoramico-proxy',
    label: 'Casco Panorámica Alta (-1_-1 + 0_0 + -1_0 + 0_-1 · proxy)',
    x: -20,
    z: 10,
    camX: 64,
    camZ: 42,
    camHeight: 64,
    focusX: -45,
    focusZ: -15,
  },
  {
    id: 'wc-canovas-sanblas-proxy',
    label: 'Cánovas / San Blas (-2_0 / -2_1, 310+ edificios · proxy)',
    x: -360,
    z: 40,
    camX: -310,
    camZ: 10,
    camHeight: 58,
    focusX: -395,
    focusZ: 45,
  },
  {
    id: 'wc-casco-budget600k',
    label: 'Casco Corazón (-1_-1 · perfil ligero budget=600k)',
    x: -12,
    z: 32,
    camX: -12,
    camZ: 32,
    camHeight: 2.2,
    focusX: -34,
    focusZ: -7,
    urlParams: '?world=cc-blender-staging&debug=1&budget=600k',
  },
  {
    id: 'wc-casco-lowcpu-4x',
    label: 'Hardware Menos Potente (CPU 4x slowdown · Casco proxy)',
    x: -12,
    z: 32,
    camX: -12,
    camZ: 32,
    camHeight: 2.2,
    focusX: -34,
    focusZ: -7,
    cpuThrottleRate: 4,
    urlParams: '?world=cc-blender-staging&debug=1&budget=600k',
  },
];

function lookAngles(
  cx: number,
  cy: number,
  cz: number,
  tx: number,
  ty: number,
  tz: number,
): { yaw: number; pitch: number } {
  const dx = tx - cx;
  const dz = tz - cz;
  const dy = ty - cy;
  const horiz = Math.hypot(dx, dz);
  return {
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.atan2(dy, Math.max(0.1, horiz)),
  };
}

async function samplePerf(page: Page): Promise<{ frameMsAvg: number; rafFps: number }> {
  return page.evaluate(
    () =>
      new Promise<{ frameMsAvg: number; rafFps: number }>((res) => {
        const times: number[] = [];
        const tick = (ts: number) => {
          times.push(ts);
          if (times.length >= 24) {
            const span = (times.at(-1) ?? 0) - (times[0] ?? 0);
            const avg = span / Math.max(1, times.length - 1);
            res({
              frameMsAvg: Number(avg.toFixed(2)),
              rafFps: Math.round(1000 / Math.max(1, avg)),
            });
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

const OUT_DIR = resolve('reports', 'screens', 'final-audit');

test('executes full 8-zone 4-angle gallery, worst-case benchmarks, low-CPU check, and cc-monumental comparison', async ({
  page,
  context,
}) => {
  await mkdir(OUT_DIR, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) {
      errors.push(msg.text());
    }
  });
  page.on('response', (res) => {
    if (!res.ok() && res.status() !== 304 && !res.url().endsWith('/favicon.ico')) {
      errors.push(`${res.status()} ${res.url()}`);
    }
  });

  // 1) Full 9-stop (8 real zone groups incl. Casco Plaza + Casco interior) x 4 angles gallery on cc-blender-staging
  await page.goto('/?world=cc-blender-staging&debug=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__CTA_DEBUG__), null, { timeout: 45_000 });
  await page.keyboard.press('F3');
  await page.keyboard.press('F4');
  await page.keyboard.press('F4');

  const galleryMetrics: Array<Record<string, unknown>> = [];

  for (const zone of GALLERY_ZONES) {
    await page.evaluate(
      ({ x, z }) => window.__CTA_DEBUG__?.setView(x, 530, z, 0, -0.35),
      zone.player,
    );
    await page.waitForFunction(
      () => {
        const m = window.__CTA_DEBUG__?.metrics();
        return Boolean(m && m.pendingChunks === 0 && m.loadedChunks >= 4);
      },
      null,
      { timeout: 60_000 },
    );

    await page.evaluate(({ x, z }) => window.__CTA_DEBUG__?.teleport(x, z), zone.player);
    await page.waitForFunction(
      ({ px, pz }) => {
        const m = window.__CTA_DEBUG__?.metrics();
        return Boolean(
          m &&
          Math.hypot(m.position.x - px, m.position.z - pz) < 2.5 &&
          m.groundHeight !== null &&
          m.groundHeight > 300 &&
          m.pendingChunks === 0,
        );
      },
      { px: zone.player.x, pz: zone.player.z },
      { timeout: 45_000 },
    );
    await page.waitForTimeout(750);

    const groundAtPlayer = await page.evaluate(
      () => window.__CTA_DEBUG__?.metrics().groundHeight ?? 400,
    );

    const recordAngle = async (
      angle: 'aerea' | 'calle' | 'personaje' | 'fachada',
      file: string,
    ): Promise<void> => {
      await page.waitForTimeout(450);
      const perf = await samplePerf(page);
      const snap = await page.evaluate(() => window.__CTA_DEBUG__?.metrics());
      expect(snap).toBeDefined();
      if (!snap) return;
      await page.screenshot({ path: resolve(OUT_DIR, file), animations: 'disabled' });
      galleryMetrics.push({
        zoneKey: zone.key,
        label: zone.label,
        angle,
        file,
        mainDrawCalls: snap.passBreakdown.mainDrawCalls,
        shadowDrawCalls: snap.passBreakdown.shadowDrawCalls,
        totalDrawCalls: snap.passBreakdown.totalDrawCalls,
        mainTriangles: snap.passBreakdown.mainTriangles,
        shadowTriangles: snap.passBreakdown.shadowTriangles,
        cpuActorMs: Number(snap.systemTimesMs.actorUpdate.toFixed(2)),
        cpuCameraOcclusionMs: Number(snap.systemTimesMs.cameraOcclusion.toFixed(2)),
        cpuNpcAiMs: Number(snap.systemTimesMs.npcAi.toFixed(2)),
        cpuShadowMs: Number(snap.passBreakdown.cpuShadowMs.toFixed(2)),
        cpuMainMs: Number(snap.passBreakdown.cpuMainMs.toFixed(2)),
        cpuRenderTotalMs: Number(snap.passBreakdown.cpuRenderTotalMs.toFixed(2)),
        gpuShadowMs:
          snap.passBreakdown.gpuShadowMs !== null
            ? Number(snap.passBreakdown.gpuShadowMs.toFixed(2))
            : null,
        gpuMainMs:
          snap.passBreakdown.gpuMainMs !== null
            ? Number(snap.passBreakdown.gpuMainMs.toFixed(2))
            : null,
        gpuTotalMs:
          snap.passBreakdown.gpuTotalMs !== null
            ? Number(snap.passBreakdown.gpuTotalMs.toFixed(2))
            : null,
        fpsReported: snap.fps,
        rafFpsAvg: perf.rafFps,
        rafFrameMsAvg: perf.frameMsAvg,
        worldMemoryMiB: Number(snap.worldMemoryMiB.toFixed(2)),
        heapMemoryMiB: snap.heapMemoryMiB !== null ? Number(snap.heapMemoryMiB.toFixed(2)) : null,
        loadedChunks: snap.loadedChunks,
        colliderCount: snap.colliderCount,
      });
    };

    const tp = lookAngles(
      zone.player.x,
      groundAtPlayer + 2.2,
      zone.player.z,
      zone.focus.x,
      groundAtPlayer + zone.focus.targetYOffset,
      zone.focus.z,
    );
    await page.evaluate(
      ({ x, z, yaw }) => window.__CTA_DEBUG__?.thirdPersonView(x, z, yaw, -0.08),
      { x: zone.player.x, z: zone.player.z, yaw: tp.yaw },
    );
    await recordAngle('personaje', `${zone.key}-personaje.png`);

    for (const angleKey of ['calle', 'fachada', 'aerea'] as const) {
      const cam = zone[angleKey];
      const cy = groundAtPlayer + cam.heightAboveGround;
      const tyOff =
        angleKey === 'fachada'
          ? (zone.fachada.targetYOffset ?? zone.focus.targetYOffset)
          : zone.focus.targetYOffset;
      const ty = groundAtPlayer + tyOff;
      const { yaw, pitch } = lookAngles(cam.x, cy, cam.z, zone.focus.x, ty, zone.focus.z);
      await page.evaluate(
        ({ x, y, z, yaw: yw, pitch: pt }) => window.__CTA_DEBUG__?.setView(x, y, z, yw, pt),
        { x: cam.x, y: cy, z: cam.z, yaw, pitch },
      );
      await recordAngle(angleKey, `${zone.key}-${angleKey}.png`);
    }
  }

  // 2) Worst-case & hardware-constrained benchmarks (staying cleanly inside existing session / reload for budget=600k + CDP throttling)
  const cdp = await context.newCDPSession(page);
  const worstCaseMetrics: Array<Record<string, unknown>> = [];

  for (const wc of WORST_CASES) {
    if (wc.urlParams) {
      await page.goto(wc.urlParams, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Boolean(window.__CTA_DEBUG__), null, { timeout: 45_000 });
      await page.keyboard.press('F3');
      await page.keyboard.press('F4');
      await page.keyboard.press('F4');
    }
    if (wc.cpuThrottleRate) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: wc.cpuThrottleRate });
    } else {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }

    await page.evaluate(({ x, z }) => window.__CTA_DEBUG__?.setView(x, 530, z, 0, -0.35), wc);
    await page.waitForFunction(
      () => {
        const m = window.__CTA_DEBUG__?.metrics();
        return Boolean(m && m.pendingChunks === 0 && m.loadedChunks >= 4);
      },
      null,
      { timeout: 60_000 },
    );
    await page.evaluate(({ x, z }) => window.__CTA_DEBUG__?.teleport(x, z), wc);
    await page.waitForFunction(
      ({ px, pz }) => {
        const m = window.__CTA_DEBUG__?.metrics();
        return Boolean(
          m &&
          Math.hypot(m.position.x - px, m.position.z - pz) < 2.5 &&
          m.groundHeight !== null &&
          m.groundHeight > 300 &&
          m.pendingChunks === 0,
        );
      },
      { px: wc.x, pz: wc.z },
      { timeout: 45_000 },
    );
    const groundH = await page.evaluate(() => window.__CTA_DEBUG__?.metrics().groundHeight ?? 430);
    if (wc.camHeight < 4) {
      const tp = lookAngles(wc.camX, groundH + 2.2, wc.camZ, wc.focusX, groundH + 8.0, wc.focusZ);
      await page.evaluate(
        ({ x, z, yaw }) => window.__CTA_DEBUG__?.thirdPersonView(x, z, yaw, -0.08),
        { x: wc.camX, z: wc.camZ, yaw: tp.yaw },
      );
    } else {
      const cy = groundH + wc.camHeight;
      const { yaw, pitch } = lookAngles(wc.camX, cy, wc.camZ, wc.focusX, groundH + 8.0, wc.focusZ);
      await page.evaluate(
        ({ x, y, z, yaw: yw, pitch: pt }) => window.__CTA_DEBUG__?.setView(x, y, z, yw, pt),
        { x: wc.camX, y: cy, z: wc.camZ, yaw, pitch },
      );
    }
    await page.waitForTimeout(600);
    const perf = await samplePerf(page);
    const snap = await page.evaluate(() => window.__CTA_DEBUG__?.metrics());
    if (snap) {
      worstCaseMetrics.push({
        id: wc.id,
        label: wc.label,
        cpuThrottleRate: wc.cpuThrottleRate ?? 1,
        mainDrawCalls: snap.passBreakdown.mainDrawCalls,
        shadowDrawCalls: snap.passBreakdown.shadowDrawCalls,
        totalDrawCalls: snap.passBreakdown.totalDrawCalls,
        mainTriangles: snap.passBreakdown.mainTriangles,
        shadowTriangles: snap.passBreakdown.shadowTriangles,
        cpuActorMs: Number(snap.systemTimesMs.actorUpdate.toFixed(2)),
        cpuCameraOcclusionMs: Number(snap.systemTimesMs.cameraOcclusion.toFixed(2)),
        cpuNpcAiMs: Number(snap.systemTimesMs.npcAi.toFixed(2)),
        cpuStreamingMs: Number(snap.systemTimesMs.streamingUpdate.toFixed(2)),
        cpuShadowMs: Number(snap.passBreakdown.cpuShadowMs.toFixed(2)),
        cpuMainMs: Number(snap.passBreakdown.cpuMainMs.toFixed(2)),
        cpuRenderTotalMs: Number(snap.passBreakdown.cpuRenderTotalMs.toFixed(2)),
        gpuShadowMs:
          snap.passBreakdown.gpuShadowMs !== null
            ? Number(snap.passBreakdown.gpuShadowMs.toFixed(2))
            : null,
        gpuMainMs:
          snap.passBreakdown.gpuMainMs !== null
            ? Number(snap.passBreakdown.gpuMainMs.toFixed(2))
            : null,
        gpuTotalMs:
          snap.passBreakdown.gpuTotalMs !== null
            ? Number(snap.passBreakdown.gpuTotalMs.toFixed(2))
            : null,
        fpsReported: snap.fps,
        rafFpsAvg: perf.rafFps,
        rafFrameMsAvg: perf.frameMsAvg,
        worldMemoryMiB: Number(snap.worldMemoryMiB.toFixed(2)),
        heapMemoryMiB: snap.heapMemoryMiB !== null ? Number(snap.heapMemoryMiB.toFixed(2)) : null,
        loadedChunks: snap.loadedChunks,
      });
    }
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  // 3) Original Production Baseline comparison (?world=cc-monumental&debug=1) in Casco & Cánovas
  const baselineComparisons: Array<Record<string, unknown>> = [];
  await page.goto('/?world=cc-monumental&debug=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__CTA_DEBUG__), null, { timeout: 45_000 });
  await page.keyboard.press('F3');
  await page.keyboard.press('F4');
  await page.keyboard.press('F4');

  for (const baseKey of ['01-casco-plaza', '02-canovas'] as const) {
    const zone = GALLERY_ZONES.find((z) => z.key === baseKey)!;
    await page.evaluate(
      ({ x, z }) => window.__CTA_DEBUG__?.setView(x, 530, z, 0, -0.35),
      zone.player,
    );
    await page.waitForFunction(
      () => {
        const m = window.__CTA_DEBUG__?.metrics();
        return Boolean(m && m.pendingChunks === 0 && m.loadedChunks >= 4);
      },
      null,
      { timeout: 60_000 },
    );
    await page.evaluate(({ x, z }) => window.__CTA_DEBUG__?.teleport(x, z), zone.player);
    await page.waitForFunction(
      ({ px, pz }) => {
        const m = window.__CTA_DEBUG__?.metrics();
        return Boolean(
          m &&
          Math.hypot(m.position.x - px, m.position.z - pz) < 2.5 &&
          m.groundHeight !== null &&
          m.pendingChunks === 0,
        );
      },
      { px: zone.player.x, pz: zone.player.z },
      { timeout: 45_000 },
    );
    const groundAtPlayer = await page.evaluate(
      () => window.__CTA_DEBUG__?.metrics().groundHeight ?? 420,
    );
    for (const angleKey of ['calle', 'aerea'] as const) {
      const cam = zone[angleKey];
      const cy = groundAtPlayer + cam.heightAboveGround;
      const ty = groundAtPlayer + zone.focus.targetYOffset;
      const { yaw, pitch } = lookAngles(cam.x, cy, cam.z, zone.focus.x, ty, zone.focus.z);
      await page.evaluate(
        ({ x, y, z, yaw: yw, pitch: pt }) => window.__CTA_DEBUG__?.setView(x, y, z, yw, pt),
        { x: cam.x, y: cy, z: cam.z, yaw, pitch },
      );
      await page.waitForTimeout(500);
      const perf = await samplePerf(page);
      const snap = await page.evaluate(() => window.__CTA_DEBUG__?.metrics());
      const file = `baseline-monumental-${baseKey}-${angleKey}.png`;
      await page.screenshot({ path: resolve(OUT_DIR, file), animations: 'disabled' });
      if (snap) {
        baselineComparisons.push({
          world: 'cc-monumental',
          zoneKey: baseKey,
          angle: angleKey,
          file,
          mainDrawCalls: snap.passBreakdown.mainDrawCalls,
          shadowDrawCalls: snap.passBreakdown.shadowDrawCalls,
          totalDrawCalls: snap.passBreakdown.totalDrawCalls,
          mainTriangles: snap.passBreakdown.mainTriangles,
          shadowTriangles: snap.passBreakdown.shadowTriangles,
          cpuRenderTotalMs: Number(snap.passBreakdown.cpuRenderTotalMs.toFixed(2)),
          gpuTotalMs:
            snap.passBreakdown.gpuTotalMs !== null
              ? Number(snap.passBreakdown.gpuTotalMs.toFixed(2))
              : null,
          rafFpsAvg: perf.rafFps,
          worldMemoryMiB: Number(snap.worldMemoryMiB.toFixed(2)),
        });
      }
    }
  }

  await writeFile(
    resolve(OUT_DIR, 'final-audit-metrics.json'),
    JSON.stringify({ galleryMetrics, worstCaseMetrics, baselineComparisons }, null, 2) + '\n',
  );
  expect(errors, `Browser / runtime errors:\n${errors.join('\n')}`).toEqual([]);
});
