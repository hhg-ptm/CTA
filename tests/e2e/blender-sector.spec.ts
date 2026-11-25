import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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
}

declare global {
  interface Window {
    __CTA_DEBUG__?: {
      teleport(x: number, z: number): void;
      setView(x: number, y: number, z: number, yaw: number, pitch: number): void;
      thirdPersonView(x: number, z: number, yaw?: number, pitch?: number): void;
      metrics(): DebugSnapshot;
    };
  }
}

interface SectorSpec {
  readonly key: 'casco' | 'bloques' | 'chalets' | 'comercial';
  readonly label: string;
  readonly player: { readonly x: number; readonly z: number };
  readonly focus: { readonly x: number; readonly z: number; readonly targetYOffset: number };
  readonly calle: { readonly x: number; readonly z: number; readonly heightAboveGround: number };
  readonly aerea: { readonly x: number; readonly z: number; readonly heightAboveGround: number };
}

const SECTORS: readonly SectorSpec[] = [
  {
    key: 'casco',
    label: 'Casco Histórico (Palacios, Casas Históricas, Casas Extremeñas y Hitos)',
    player: { x: -12, z: 32 },
    focus: { x: -34, z: -7, targetYOffset: 8.0 },
    calle: { x: -16, z: 54, heightAboveGround: 2.5 },
    aerea: { x: 64, z: 42, heightAboveGround: 64 },
  },
  {
    key: 'bloques',
    label: 'Ensanche Urbano (Bloques 4 y 6 Plantas, Comercio y Equipamiento)',
    player: { x: -516, z: -362 },
    focus: { x: -556, z: -332, targetYOffset: 13.0 },
    calle: { x: -508, z: -385, heightAboveGround: 2.6 },
    aerea: { x: -458, z: -268, heightAboveGround: 72 },
  },
  {
    key: 'chalets',
    label: 'Vistahermosa (Chalets Unifamiliares con Jardín y Casas Extremeñas)',
    player: { x: -2020, z: -57 },
    focus: { x: -1998, z: -68, targetYOffset: 5.2 },
    calle: { x: -2016, z: -50, heightAboveGround: 2.4 },
    aerea: { x: -1950, z: -18, heightAboveGround: 52 },
  },
  {
    key: 'comercial',
    label: 'Sector Comercial y Equipamiento Singular (El Vivero / Eje Urbano)',
    player: { x: -1798, z: -368 },
    focus: { x: -1790, z: -327, targetYOffset: 8.5 },
    calle: { x: -1815, z: -358, heightAboveGround: 2.5 },
    aerea: { x: -1712, z: -250, heightAboveGround: 58 },
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

interface SectorSampleMetrics {
  readonly sectorKey: SectorSpec['key'];
  readonly label: string;
  readonly angle: 'personaje' | 'calle' | 'aerea';
  readonly file: string;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly fpsReported: number;
  readonly rafFrameMsAvg: number;
  readonly rafFpsAvg: number;
  readonly worldMemoryMiB: number;
  readonly heapMemoryMiB: number | null;
  readonly loadedChunks: number;
  readonly colliderCount: number;
}

const OUT_DIR = resolve('reports', 'screens', 'blender-sector');

test('validates FASE D/E Blender-library representative test sector in live WebGL engine', async ({
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

  await page.goto('/?world=cc-blender-sector&debug=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__CTA_DEBUG__), null, { timeout: 30_000 });
  // Ensure debug overlay HUD stays cleanly tucked while keeping telemetry polling active
  await page.keyboard.press('F3');
  await page.keyboard.press('F4');
  await page.keyboard.press('F4');

  const samples: SectorSampleMetrics[] = [];

  for (const sector of SECTORS) {
    // Wait for streaming around target sector
    await page.evaluate(
      ({ x, z }) => window.__CTA_DEBUG__?.setView(x, 510, z, 0, -0.35),
      sector.player,
    );
    await page.waitForFunction(
      () => {
        const m = window.__CTA_DEBUG__?.metrics();
        return Boolean(m && m.pendingChunks === 0 && m.loadedChunks >= 2);
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
          m.groundHeight > 350 &&
          m.pendingChunks === 0,
        );
      },
      { px: sector.player.x, pz: sector.player.z },
      { timeout: 35_000 },
    );
    await page.waitForTimeout(800);

    const groundAtPlayer = await page.evaluate(
      () => window.__CTA_DEBUG__?.metrics().groundHeight ?? 400,
    );

    const captureAngle = async (
      angle: SectorSampleMetrics['angle'],
      file: string,
    ): Promise<void> => {
      await page.waitForTimeout(600);
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
      const m = await page.evaluate(() => window.__CTA_DEBUG__?.metrics());
      await page.screenshot({ path: resolve(OUT_DIR, file), animations: 'disabled' });

      expect(m?.colliderCount ?? 0).toBeGreaterThan(0);
      expect(m?.loadedChunks ?? 0).toBeGreaterThanOrEqual(2);
      expect(m?.drawCalls ?? 999).toBeLessThanOrEqual(300);
      expect(m?.triangles ?? 9_999_999).toBeLessThanOrEqual(1_800_000);

      samples.push({
        sectorKey: sector.key,
        label: sector.label,
        angle,
        file,
        drawCalls: m?.drawCalls ?? 0,
        triangles: m?.triangles ?? 0,
        fpsReported: m?.fps ?? 0,
        rafFrameMsAvg: perf.frameMsAvg,
        rafFpsAvg: perf.rafFps,
        worldMemoryMiB: Number((m?.worldMemoryMiB ?? 0).toFixed(2)),
        heapMemoryMiB:
          m?.heapMemoryMiB !== null && m?.heapMemoryMiB !== undefined
            ? Number(m.heapMemoryMiB.toFixed(2))
            : null,
        loadedChunks: m?.loadedChunks ?? 0,
        colliderCount: m?.colliderCount ?? 0,
      });
    };

    // 1. Third-person habitual character camera facing representative block
    const tpAngles = lookAngles(
      sector.player.x,
      groundAtPlayer + 2.2,
      sector.player.z,
      sector.focus.x,
      groundAtPlayer + sector.focus.targetYOffset,
      sector.focus.z,
    );
    await page.evaluate(
      ({ x, z, yaw }) => window.__CTA_DEBUG__?.thirdPersonView(x, z, yaw, -0.08),
      { x: sector.player.x, z: sector.player.z, yaw: tpAngles.yaw },
    );
    await captureAngle('personaje', `sector-${sector.key}-personaje.png`);

    // On Plaza Mayor (casco), validate pedestrian locomotion & physics colliders in third-person
    if (sector.key === 'casco') {
      const startPos = await page.evaluate(() => window.__CTA_DEBUG__?.metrics().position);
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(750);
      await page.keyboard.up('KeyW');
      const endPos = await page.evaluate(() => window.__CTA_DEBUG__?.metrics().position);
      const moved = Math.hypot(
        (endPos?.x ?? 0) - (startPos?.x ?? 0),
        (endPos?.z ?? 0) - (startPos?.z ?? 0),
      );
      expect(moved).toBeGreaterThan(1.0);
    }

    // 2. Street level & aerial views
    for (const angleKey of ['calle', 'aerea'] as const) {
      const cam = sector[angleKey];
      const cy = groundAtPlayer + cam.heightAboveGround;
      const ty = groundAtPlayer + sector.focus.targetYOffset;
      const { yaw, pitch } = lookAngles(cam.x, cy, cam.z, sector.focus.x, ty, sector.focus.z);
      await page.evaluate(
        ({ x, y, z, yaw: yw, pitch: pt }) => window.__CTA_DEBUG__?.setView(x, y, z, yw, pt),
        { x: cam.x, y: cy, z: cam.z, yaw, pitch },
      );
      await captureAngle(angleKey, `sector-${sector.key}-${angleKey}.png`);
    }
  }

  await writeFile(resolve(OUT_DIR, 'metrics.json'), JSON.stringify({ samples }, null, 2) + '\n');
  expect(errors, `Browser / runtime errors:\n${errors.join('\n')}`).toEqual([]);
});
