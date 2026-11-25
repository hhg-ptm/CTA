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

interface ZoneSpec {
  readonly key: 'casco' | 'bloques' | 'comercial';
  readonly label: string;
  readonly player: { readonly x: number; readonly z: number };
  readonly focus: { readonly x: number; readonly z: number; readonly targetYOffset: number };
  readonly calle: { readonly x: number; readonly z: number; readonly heightAboveGround: number };
  readonly aerea: { readonly x: number; readonly z: number; readonly heightAboveGround: number };
  readonly minLandmarkCasters?: number;
}

const ZONES: readonly ZoneSpec[] = [
  {
    key: 'casco',
    label: 'Casco Histórico (Monumentos + Tejados Pizarra/Teja)',
    player: { x: -12, z: 32 },
    focus: { x: -34, z: -7, targetYOffset: 8.0 },
    calle: { x: -16, z: 54, heightAboveGround: 2.5 },
    aerea: { x: 64, z: 42, heightAboveGround: 64 },
    minLandmarkCasters: 1,
  },
  {
    key: 'bloques',
    label: 'Ensanche Residencial (Bloques 4 y 6 Plantas)',
    player: { x: -516, z: -362 },
    focus: { x: -556, z: -332, targetYOffset: 13.0 },
    calle: { x: -508, z: -385, heightAboveGround: 2.6 },
    aerea: { x: -458, z: -268, heightAboveGround: 72 },
  },
  {
    key: 'comercial',
    label: 'El Vivero Comercial (4 Fachadas Diferenciadas + Equipamiento)',
    player: { x: -1798, z: -368 },
    focus: { x: -1790, z: -327, targetYOffset: 8.5 },
    calle: { x: -1815, z: -358, heightAboveGround: 2.5 },
    aerea: { x: -1712, z: -250, heightAboveGround: 58 },
  },
];

const PROFILES: readonly ShadowProfile[] = ['wide', 'balanced', 'proxy'];
const OUT_DIR = resolve('reports', 'screens', 'shadow-compare');

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

interface CompareRow {
  readonly zone: ZoneSpec['key'];
  readonly angle: 'personaje' | 'calle' | 'aerea';
  readonly profile: ShadowProfile;
  readonly screenshot: string;
  readonly mainDrawCalls: number;
  readonly mainTriangles: number;
  readonly shadowDrawCalls: number;
  readonly shadowTriangles: number;
  readonly totalDrawCalls: number;
  readonly totalTriangles: number;
  readonly cpuShadowMs: number;
  readonly cpuMainMs: number;
  readonly cpuRenderTotalMs: number;
  readonly cpuPhysicsMs: number;
  readonly cpuActorMs: number;
  readonly cpuStreamingMs: number;
  readonly gpuTimerSupported: boolean;
  readonly gpuShadowMs: number | null;
  readonly gpuMainMs: number | null;
  readonly gpuTotalMs: number | null;
  readonly rafFrameMsAvg: number;
  readonly rafFpsAvg: number;
  readonly worldMemoryMiB: number;
  readonly heapMemoryMiB: number | null;
  readonly loadedChunks: number;
  readonly blenderShadowStats: PassBreakdown['blenderShadowStats'];
}

test('compares wide, balanced, and proxy shadow LOD profiles with separated telemetry', async ({
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

  await page.goto('/?world=cc-blender-sector&debug=1&shadowProfile=wide', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => Boolean(window.__CTA_DEBUG__), null, { timeout: 30_000 });
  // Tuck overlay panels while keeping live per-frame telemetry active
  await page.keyboard.press('F3');
  await page.keyboard.press('F4');
  await page.keyboard.press('F4');

  const rows: CompareRow[] = [];

  for (const zone of ZONES) {
    await page.evaluate(
      ({ x, z }) => window.__CTA_DEBUG__?.setView(x, 510, z, 0, -0.35),
      zone.player,
    );
    await page.waitForFunction(
      () => {
        const m = window.__CTA_DEBUG__?.metrics();
        return Boolean(m && m.pendingChunks === 0 && m.loadedChunks >= 2);
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
          m.groundHeight > 350 &&
          m.pendingChunks === 0,
        );
      },
      { px: zone.player.x, pz: zone.player.z },
      { timeout: 35_000 },
    );
    await page.waitForTimeout(700);

    const groundAtPlayer = await page.evaluate(
      () => window.__CTA_DEBUG__?.metrics().groundHeight ?? 400,
    );

    const angles: readonly ('personaje' | 'calle' | 'aerea')[] = ['personaje', 'calle', 'aerea'];
    for (const angle of angles) {
      if (angle === 'personaje') {
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
      } else {
        const cam = zone[angle];
        const cy = groundAtPlayer + cam.heightAboveGround;
        const ty = groundAtPlayer + zone.focus.targetYOffset;
        const { yaw, pitch } = lookAngles(cam.x, cy, cam.z, zone.focus.x, ty, zone.focus.z);
        await page.evaluate(
          ({ x, y, z, yaw: yw, pitch: pt }) => window.__CTA_DEBUG__?.setView(x, y, z, yw, pt),
          { x: cam.x, y: cy, z: cam.z, yaw, pitch },
        );
      }
      await page.waitForTimeout(350);

      for (const profile of PROFILES) {
        await page.evaluate((p) => window.__CTA_DEBUG__?.setShadowProfile(p), profile);
        await page.waitForTimeout(300);

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
        if (!snap) continue;

        expect(snap.loadedChunks).toBeGreaterThanOrEqual(2);
        expect(snap.colliderCount).toBeGreaterThan(0);
        expect(snap.passBreakdown.shadowTriangles).toBeGreaterThan(0);
        expect(snap.passBreakdown.mainTriangles).toBeGreaterThan(0);
        if (zone.minLandmarkCasters) {
          expect(
            snap.passBreakdown.blenderShadowStats?.landmarkCasters ?? 0,
          ).toBeGreaterThanOrEqual(zone.minLandmarkCasters);
        }

        const file = `${zone.key}-${angle}-${profile}.png`;
        if (
          angle === 'aerea' ||
          angle === 'personaje' ||
          (zone.key === 'comercial' && angle === 'calle')
        ) {
          await page.screenshot({ path: resolve(OUT_DIR, file), animations: 'disabled' });
        }

        rows.push({
          zone: zone.key,
          angle,
          profile,
          screenshot: file,
          mainDrawCalls: snap.passBreakdown.mainDrawCalls,
          mainTriangles: snap.passBreakdown.mainTriangles,
          shadowDrawCalls: snap.passBreakdown.shadowDrawCalls,
          shadowTriangles: snap.passBreakdown.shadowTriangles,
          totalDrawCalls: snap.passBreakdown.totalDrawCalls,
          totalTriangles: snap.passBreakdown.totalTriangles,
          cpuShadowMs: Number(snap.passBreakdown.cpuShadowMs.toFixed(2)),
          cpuMainMs: Number(snap.passBreakdown.cpuMainMs.toFixed(2)),
          cpuRenderTotalMs: Number(snap.passBreakdown.cpuRenderTotalMs.toFixed(2)),
          cpuPhysicsMs: Number(snap.systemTimesMs.physicsQuery.toFixed(2)),
          cpuActorMs: Number(snap.systemTimesMs.actorUpdate.toFixed(2)),
          cpuStreamingMs: Number(snap.systemTimesMs.streamingUpdate.toFixed(2)),
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
          rafFrameMsAvg: perf.frameMsAvg,
          rafFpsAvg: perf.rafFps,
          worldMemoryMiB: Number(snap.worldMemoryMiB.toFixed(2)),
          heapMemoryMiB: snap.heapMemoryMiB !== null ? Number(snap.heapMemoryMiB.toFixed(2)) : null,
          loadedChunks: snap.loadedChunks,
          blenderShadowStats: snap.passBreakdown.blenderShadowStats,
        });
      }
    }

    // Verify pedestrian locomotion works cleanly under proxy profile in Casco Histórico
    if (zone.key === 'casco') {
      await page.evaluate(
        ({ x, z }) => window.__CTA_DEBUG__?.thirdPersonView(x, z, 0, -0.08),
        zone.player,
      );
      const startPos = await page.evaluate(() => window.__CTA_DEBUG__?.metrics().position);
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(650);
      await page.keyboard.up('KeyW');
      const endPos = await page.evaluate(() => window.__CTA_DEBUG__?.metrics().position);
      const moved = Math.hypot(
        (endPos?.x ?? 0) - (startPos?.x ?? 0),
        (endPos?.z ?? 0) - (startPos?.z ?? 0),
      );
      expect(moved).toBeGreaterThan(0.8);
    }
  }

  await writeFile(resolve(OUT_DIR, 'metrics.json'), JSON.stringify({ rows }, null, 2) + '\n');
  expect(errors, `Browser / runtime errors:\n${errors.join('\n')}`).toEqual([]);
});
