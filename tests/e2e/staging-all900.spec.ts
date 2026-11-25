import { expect, test } from '@playwright/test';
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

interface SectorSpec {
  readonly key: string;
  readonly sectorGroup: string;
  readonly label: string;
  readonly player: { readonly x: number; readonly z: number };
  readonly focus: { readonly x: number; readonly z: number; readonly targetYOffset: number };
  readonly calle: { readonly x: number; readonly z: number; readonly heightAboveGround: number };
  readonly aerea: { readonly x: number; readonly z: number; readonly heightAboveGround: number };
  readonly checkWalk?: boolean;
}

const SECTORS: readonly SectorSpec[] = [
  {
    key: 'sector1-casco',
    sectorGroup: 'Sector 1: Casco Histórico y Centro',
    label: 'Casco Histórico y Plaza Mayor (Palacios, Casas Históricas, Monumentos)',
    player: { x: -12, z: 32 },
    focus: { x: -34, z: -7, targetYOffset: 8.0 },
    calle: { x: -16, z: 54, heightAboveGround: 2.5 },
    aerea: { x: 64, z: 42, heightAboveGround: 64 },
    checkWalk: true,
  },
  {
    key: 'sector2-canovas',
    sectorGroup: 'Sector 2: Cánovas y barrios residenciales',
    label: 'Paseo de Cánovas y Ensanche Residencial',
    player: { x: -516, z: -362 },
    focus: { x: -556, z: -332, targetYOffset: 13.0 },
    calle: { x: -508, z: -385, heightAboveGround: 2.6 },
    aerea: { x: -458, z: -268, heightAboveGround: 72 },
  },
  {
    key: 'sector3-nuevo-caceres',
    sectorGroup: 'Sector 3: Nuevo Cáceres y zonas modernas',
    label: 'Nuevo Cáceres (Bloques Modernos, 4 Plantas y Eje Comercial)',
    player: { x: -1114.2, z: -1069.2 },
    focus: { x: -1100, z: -1105, targetYOffset: 12.0 },
    calle: { x: -1053.6, z: -1120.2, heightAboveGround: 2.6 },
    aerea: { x: -1025, z: -1015, heightAboveGround: 68 },
  },
  {
    key: 'sector4-mejostilla',
    sectorGroup: 'Sector 4: Mejostilla y periferia',
    label: 'Mejostilla (Bloques Residenciales, Vivienda Adosada y Equipamiento)',
    player: { x: 337.8, z: 1385.5 },
    focus: { x: 410, z: 1345, targetYOffset: 11.0 },
    calle: { x: 422.4, z: 1367.1, heightAboveGround: 2.6 },
    aerea: { x: 495, z: 1275, heightAboveGround: 70 },
    checkWalk: true,
  },
  {
    key: 'sector5a-aldea-moret',
    sectorGroup: 'Sector 5: Aldea Moret y zonas industriales',
    label: 'Aldea Moret (Barrio Tradicional y Vivienda Media)',
    player: { x: -778.3, z: -2091.5 },
    focus: { x: -815, z: -2065, targetYOffset: 7.5 },
    calle: { x: -791.2, z: -2040.1, heightAboveGround: 2.6 },
    aerea: { x: -735, z: -1995, heightAboveGround: 58 },
  },
  {
    key: 'sector5b-industrial',
    sectorGroup: 'Sector 5: Aldea Moret y zonas industriales',
    label: 'Polígono Industrial Charca Musia (Naves y Talleres)',
    player: { x: 379.3, z: -2506.0 },
    focus: { x: 375, z: -2515, targetYOffset: 6.5 },
    calle: { x: 349.1, z: -2474.3, heightAboveGround: 2.8 },
    aerea: { x: 485, z: -2425, heightAboveGround: 56 },
  },
  {
    key: 'sector6-campus',
    sectorGroup: 'Sector 6: Campus, hospital y equipamientos',
    label: 'Campus Universitario de Extremadura y Equipamientos',
    player: { x: 2304.8, z: 716.7 },
    focus: { x: 2335, z: 695, targetYOffset: 9.0 },
    calle: { x: 2379.8, z: 706.1, heightAboveGround: 2.6 },
    aerea: { x: 2435, z: 795, heightAboveGround: 64 },
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

interface StagingSampleRow {
  readonly sectorKey: string;
  readonly sectorGroup: string;
  readonly label: string;
  readonly angle: 'personaje' | 'calle' | 'aerea';
  readonly screenshot: string;
  readonly mainDrawCalls: number;
  readonly mainTriangles: number;
  readonly shadowDrawCalls: number;
  readonly shadowTriangles: number;
  readonly totalDrawCalls: number;
  readonly totalTriangles: number;
  readonly cpuPhysicsMs: number;
  readonly cpuActorMs: number;
  readonly cpuCameraOcclusionMs: number;
  readonly cpuNpcAiMs: number;
  readonly cpuStreamingMs: number;
  readonly cpuShadowMs: number;
  readonly cpuMainMs: number;
  readonly cpuRenderTotalMs: number;
  readonly gpuTimerSupported: boolean;
  readonly gpuShadowMs: number | null;
  readonly gpuMainMs: number | null;
  readonly gpuTotalMs: number | null;
  readonly fpsReported: number;
  readonly rafFrameMsAvg: number;
  readonly rafFpsAvg: number;
  readonly peakFrameMs: number;
  readonly worldMemoryMiB: number;
  readonly heapMemoryMiB: number | null;
  readonly loadedChunks: number;
  readonly colliderCount: number;
  readonly blenderShadowStats: PassBreakdown['blenderShadowStats'];
}

interface WalkCheckRow {
  readonly sectorKey: string;
  readonly movedMeters: number;
  readonly startGroundHeight: number | null;
  readonly endGroundHeight: number | null;
}

const OUT_DIR = resolve('reports', 'screens', 'staging-all900');

test('validates all 6 Cáceres sectors and full cross-city streaming on 900-chunk staging', async ({
  page,
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
    if (!res.ok() && !res.url().endsWith('/favicon.ico')) {
      errors.push(`${res.status()} ${res.url()}`);
    }
  });

  await page.goto('/?world=cc-blender-staging&debug=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__CTA_DEBUG__), null, { timeout: 45_000 });
  // Keep telemetry updating while hiding HUD debug boxes for clean screenshots
  await page.keyboard.press('F3');
  await page.keyboard.press('F4');
  await page.keyboard.press('F4');

  const rows: StagingSampleRow[] = [];
  const walkChecks: WalkCheckRow[] = [];

  for (const sector of SECTORS) {
    await page.evaluate(
      ({ x, z }) => window.__CTA_DEBUG__?.setView(x, 530, z, 0, -0.35),
      sector.player,
    );
    await page.waitForFunction(
      () => {
        const m = window.__CTA_DEBUG__?.metrics();
        return Boolean(m && m.pendingChunks === 0 && m.loadedChunks >= 4);
      },
      null,
      { timeout: 60_000 },
    );

    await page.evaluate(({ x, z }) => window.__CTA_DEBUG__?.teleport(x, z), sector.player);
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
      { px: sector.player.x, pz: sector.player.z },
      { timeout: 45_000 },
    );
    await page.waitForTimeout(850);

    const groundAtPlayer = await page.evaluate(
      () => window.__CTA_DEBUG__?.metrics().groundHeight ?? 400,
    );

    const captureAngle = async (angle: StagingSampleRow['angle'], file: string): Promise<void> => {
      await page.waitForTimeout(550);
      const perf = await page.evaluate(
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
      const snap = await page.evaluate(() => window.__CTA_DEBUG__?.metrics());
      expect(snap).toBeDefined();
      if (!snap) return;

      expect(snap.loadedChunks).toBeGreaterThanOrEqual(4);
      expect(snap.colliderCount).toBeGreaterThan(0);
      expect(snap.passBreakdown.mainTriangles).toBeGreaterThan(0);
      expect(snap.passBreakdown.shadowTriangles).toBeGreaterThan(0);
      expect(snap.passBreakdown.blenderShadowStats?.profile).toBe('proxy');

      await page.screenshot({ path: resolve(OUT_DIR, file), animations: 'disabled' });

      rows.push({
        sectorKey: sector.key,
        sectorGroup: sector.sectorGroup,
        label: sector.label,
        angle,
        screenshot: file,
        mainDrawCalls: snap.passBreakdown.mainDrawCalls,
        mainTriangles: snap.passBreakdown.mainTriangles,
        shadowDrawCalls: snap.passBreakdown.shadowDrawCalls,
        shadowTriangles: snap.passBreakdown.shadowTriangles,
        totalDrawCalls: snap.passBreakdown.totalDrawCalls,
        totalTriangles: snap.passBreakdown.totalTriangles,
        cpuPhysicsMs: Number(snap.systemTimesMs.physicsQuery.toFixed(2)),
        cpuActorMs: Number(snap.systemTimesMs.actorUpdate.toFixed(2)),
        cpuCameraOcclusionMs: Number(snap.systemTimesMs.cameraOcclusion.toFixed(2)),
        cpuNpcAiMs: Number(snap.systemTimesMs.npcAi.toFixed(2)),
        cpuStreamingMs: Number(snap.systemTimesMs.streamingUpdate.toFixed(2)),
        cpuShadowMs: Number(snap.passBreakdown.cpuShadowMs.toFixed(2)),
        cpuMainMs: Number(snap.passBreakdown.cpuMainMs.toFixed(2)),
        cpuRenderTotalMs: Number(snap.passBreakdown.cpuRenderTotalMs.toFixed(2)),
        gpuTimerSupported: snap.passBreakdown.gpuTimerSupported,
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
        rafFrameMsAvg: perf.frameMsAvg,
        rafFpsAvg: perf.rafFps,
        peakFrameMs: Number(snap.peakFrameMs.toFixed(2)),
        worldMemoryMiB: Number(snap.worldMemoryMiB.toFixed(2)),
        heapMemoryMiB: snap.heapMemoryMiB !== null ? Number(snap.heapMemoryMiB.toFixed(2)) : null,
        loadedChunks: snap.loadedChunks,
        colliderCount: snap.colliderCount,
        blenderShadowStats: snap.passBreakdown.blenderShadowStats,
      });
    };

    const tp = lookAngles(
      sector.player.x,
      groundAtPlayer + 2.2,
      sector.player.z,
      sector.focus.x,
      groundAtPlayer + sector.focus.targetYOffset,
      sector.focus.z,
    );
    await page.evaluate(
      ({ x, z, yaw }) => window.__CTA_DEBUG__?.thirdPersonView(x, z, yaw, -0.08),
      { x: sector.player.x, z: sector.player.z, yaw: tp.yaw },
    );
    await captureAngle('personaje', `${sector.key}-personaje.png`);

    if (sector.checkWalk) {
      const before = await page.evaluate(() => window.__CTA_DEBUG__?.metrics());
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(750);
      await page.keyboard.up('KeyW');
      const after = await page.evaluate(() => window.__CTA_DEBUG__?.metrics());
      const movedMeters = Math.hypot(
        (after?.position.x ?? 0) - (before?.position.x ?? 0),
        (after?.position.z ?? 0) - (before?.position.z ?? 0),
      );
      expect(movedMeters).toBeGreaterThan(0.8);
      walkChecks.push({
        sectorKey: sector.key,
        movedMeters: Number(movedMeters.toFixed(2)),
        startGroundHeight: before?.groundHeight ?? null,
        endGroundHeight: after?.groundHeight ?? null,
      });
    }

    for (const angleKey of ['calle', 'aerea'] as const) {
      const cam = sector[angleKey];
      const cy = groundAtPlayer + cam.heightAboveGround;
      const ty = groundAtPlayer + sector.focus.targetYOffset;
      const { yaw, pitch } = lookAngles(cam.x, cy, cam.z, sector.focus.x, ty, sector.focus.z);
      await page.evaluate(
        ({ x, y, z, yaw: yw, pitch: pt }) => window.__CTA_DEBUG__?.setView(x, y, z, yw, pt),
        { x: cam.x, y: cy, z: cam.z, yaw, pitch },
      );
      await captureAngle(angleKey, `${sector.key}-${angleKey}.png`);
    }
  }

  // Streaming stability check: sweep across distant sectors without exceeding memory bounds or leaking chunks
  const streamingRoute = [
    { name: 'campus-to-casco', x: -12, z: 32 },
    { name: 'casco-to-industrial', x: 379.3, z: -2506.0 },
    { name: 'industrial-to-mejostilla', x: 337.8, z: 1385.5 },
    { name: 'mejostilla-to-nuevo-caceres', x: -1114.2, z: -1069.2 },
  ];
  const streamingLog: Array<{
    hop: string;
    loadedChunks: number;
    pendingChunks: number;
    groundHeight: number | null;
    worldMemoryMiB: number;
    heapMemoryMiB: number | null;
    cpuStreamingMs: number;
    cpuActorMsDuringWalk: number;
    rafFpsDuringWalk: number;
  }> = [];
  for (const hop of streamingRoute) {
    await page.evaluate(({ x, z }) => window.__CTA_DEBUG__?.setView(x, 530, z, 0, -0.35), hop);
    await page.waitForFunction(
      () => {
        const m = window.__CTA_DEBUG__?.metrics();
        return Boolean(m && m.pendingChunks === 0 && m.loadedChunks >= 4);
      },
      null,
      { timeout: 60_000 },
    );
    await page.evaluate(({ x, z }) => window.__CTA_DEBUG__?.thirdPersonView(x, z, 0, -0.08), hop);
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
      { px: hop.x, pz: hop.z },
      { timeout: 45_000 },
    );
    await page.keyboard.down('KeyW');
    const movePerf = await page.evaluate(
      () =>
        new Promise<{ rafFps: number }>((res) => {
          const times: number[] = [];
          const tick = (ts: number) => {
            times.push(ts);
            if (times.length >= 24) {
              const span = (times.at(-1) ?? 0) - (times[0] ?? 0);
              const avg = span / Math.max(1, times.length - 1);
              res({ rafFps: Math.round(1000 / Math.max(1, avg)) });
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
    await page.keyboard.up('KeyW');
    const snap = await page.evaluate(() => window.__CTA_DEBUG__?.metrics());
    expect(snap).toBeDefined();
    if (!snap) continue;
    expect(snap.loadedChunks).toBeLessThanOrEqual(36);
    expect(snap.groundHeight).not.toBeNull();
    streamingLog.push({
      hop: hop.name,
      loadedChunks: snap.loadedChunks,
      pendingChunks: snap.pendingChunks,
      groundHeight: snap.groundHeight !== null ? Number(snap.groundHeight.toFixed(2)) : null,
      worldMemoryMiB: Number(snap.worldMemoryMiB.toFixed(2)),
      heapMemoryMiB: snap.heapMemoryMiB !== null ? Number(snap.heapMemoryMiB.toFixed(2)) : null,
      cpuStreamingMs: Number(snap.systemTimesMs.streamingUpdate.toFixed(2)),
      cpuActorMsDuringWalk: Number(snap.systemTimesMs.actorUpdate.toFixed(2)),
      rafFpsDuringWalk: movePerf.rafFps,
    });
  }

  await writeFile(
    resolve(OUT_DIR, 'staging-metrics.json'),
    JSON.stringify({ rows, walkChecks, streamingLog }, null, 2) + '\n',
  );
  expect(errors, `Browser / runtime errors:\n${errors.join('\n')}`).toEqual([]);
});
