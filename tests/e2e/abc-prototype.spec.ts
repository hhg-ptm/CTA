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
  readonly fps: number;
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

type BudgetKey = '600k' | '1200k' | '2000k';

interface CameraPose {
  readonly x: number;
  readonly z: number;
  readonly heightAboveGround: number;
}

interface SectorSpec {
  readonly key: 'casco' | 'bloques';
  readonly legacyPrefix: string;
  readonly label: string;
  readonly focus: { readonly x: number; readonly z: number; readonly targetYOffset: number };
  readonly player: { readonly x: number; readonly z: number };
  readonly calle: CameraPose;
  readonly fachada: CameraPose;
  readonly aerea: CameraPose;
}

const SECTORS: readonly SectorSpec[] = [
  {
    key: 'casco',
    legacyPrefix: '01-casco-historico',
    label: 'Casco Histórico (Plaza Mayor / Ayuntamiento / Diputación)',
    focus: { x: -34, z: -7, targetYOffset: 7.5 },
    player: { x: -12, z: 32 },
    calle: { x: -16, z: 54, heightAboveGround: 2.6 },
    fachada: { x: -12, z: 14, heightAboveGround: 4.8 },
    aerea: { x: 75, z: 34, heightAboveGround: 68 },
  },
  {
    key: 'bloques',
    legacyPrefix: '02-bloques-residenciales',
    label: 'Bloques Residenciales Modernos (Av. Virgen de Guadalupe / Cánovas)',
    focus: { x: -556, z: -332, targetYOffset: 15 },
    player: { x: -516, z: -362 },
    calle: { x: -508, z: -385, heightAboveGround: 2.8 },
    fachada: { x: -522, z: -358, heightAboveGround: 10.5 },
    aerea: { x: -460, z: -260, heightAboveGround: 78 },
  },
];

const BUDGETS: readonly { key: BudgetKey; versionLabel: string }[] = [
  { key: '600k', versionLabel: 'Versión A (600.000 tris)' },
  { key: '1200k', versionLabel: 'Versión B (1.200.000 tris)' },
  { key: '2000k', versionLabel: 'Versión C (2.000.000 tris)' },
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

interface SampledMetrics {
  readonly budget: BudgetKey;
  readonly versionLabel: string;
  readonly sectorKey: SectorSpec['key'];
  readonly angle: 'calle' | 'fachada' | 'aerea' | 'personaje';
  readonly file: string;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly fpsReported: number;
  readonly rafFrameMsAvg: number;
  readonly rafFpsAvg: number;
  readonly worldMemoryMiB: number;
  readonly loadedChunks: number;
  readonly colliderCount: number;
}

const OUT_DIR = resolve('reports', 'screens', 'v3-abc');

test('runs A/B/C budget benchmark (600k vs 1.2M vs 2.0M) on identical blocks and captures v3 prototype renders', async ({
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

  const allMetrics: SampledMetrics[] = [];

  for (const { key: budget, versionLabel } of BUDGETS) {
    await page.goto(`/?world=cc-prototype&debug=1&budget=${budget}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => Boolean(window.__CTA_DEBUG__), null, { timeout: 30_000 });
    await page.keyboard.press('F3');
    await page.keyboard.press('F4');
    await page.keyboard.press('F4');

    for (const sector of SECTORS) {
      await page.evaluate(({ x, z }) => {
        window.__CTA_DEBUG__?.setView(x, 520, z, 0, -0.35);
      }, sector.player);
      await page.waitForFunction(
        () => {
          const m = window.__CTA_DEBUG__?.metrics();
          return Boolean(m && m.pendingChunks === 0 && m.loadedChunks >= 3);
        },
        null,
        { timeout: 75_000 },
      );
      await page.evaluate(({ x, z }) => window.__CTA_DEBUG__?.teleport(x, z), sector.player);
      await page.waitForFunction(
        ({ px, pz }) => {
          const m = window.__CTA_DEBUG__?.metrics();
          return Boolean(
            m &&
            Math.hypot(m.position.x - px, m.position.z - pz) < 2 &&
            m.groundHeight !== null &&
            m.groundHeight > 380 &&
            m.pendingChunks === 0,
          );
        },
        { px: sector.player.x, pz: sector.player.z },
        { timeout: 30_000 },
      );
      await page.waitForTimeout(700);

      const groundAtPlayer = await page.evaluate(
        () => window.__CTA_DEBUG__?.metrics().groundHeight ?? 400,
      );

      const sampleAndCapture = async (
        angle: SampledMetrics['angle'],
        file: string,
      ): Promise<void> => {
        await page.waitForTimeout(650);
        const perf = await page.evaluate(
          () =>
            new Promise<{ frameMsAvg: number; rafFps: number }>((res) => {
              const times: number[] = [];
              const step = (ts: number) => {
                times.push(ts);
                if (times.length >= 24) {
                  const total = (times.at(-1) ?? 0) - (times[0] ?? 0);
                  const avg = total / Math.max(1, times.length - 1);
                  res({
                    frameMsAvg: Number(avg.toFixed(2)),
                    rafFps: Math.round(1000 / Math.max(1, avg)),
                  });
                  return;
                }
                requestAnimationFrame(step);
              };
              requestAnimationFrame(step);
            }),
        );
        const m = await page.evaluate(() => window.__CTA_DEBUG__?.metrics());
        await page.screenshot({ path: resolve(OUT_DIR, file), animations: 'disabled' });
        allMetrics.push({
          budget,
          versionLabel,
          sectorKey: sector.key,
          angle,
          file,
          drawCalls: m?.drawCalls ?? 0,
          triangles: m?.triangles ?? 0,
          fpsReported: m?.fps ?? 0,
          rafFrameMsAvg: perf.frameMsAvg,
          rafFpsAvg: perf.rafFps,
          worldMemoryMiB: m?.worldMemoryMiB ?? 0,
          loadedChunks: m?.loadedChunks ?? 0,
          colliderCount: m?.colliderCount ?? 0,
        });
      };

      // Capture 3rd-person character view on B & C (and A for full comparability)
      const pAngles = lookAngles(
        sector.player.x,
        groundAtPlayer + 2.2,
        sector.player.z,
        sector.focus.x,
        groundAtPlayer + sector.focus.targetYOffset,
        sector.focus.z,
      );
      await page.evaluate(
        ({ x, z, yaw }) => window.__CTA_DEBUG__?.thirdPersonView(x, z, yaw, -0.08),
        { x: sector.player.x, z: sector.player.z, yaw: pAngles.yaw },
      );
      await sampleAndCapture('personaje', `abc-${budget}-${sector.key}-personaje.png`);

      for (const angleKey of ['calle', 'fachada', 'aerea'] as const) {
        const cam = sector[angleKey];
        const cy = groundAtPlayer + cam.heightAboveGround;
        const ty = groundAtPlayer + sector.focus.targetYOffset;
        const { yaw, pitch } = lookAngles(cam.x, cy, cam.z, sector.focus.x, ty, sector.focus.z);
        await page.evaluate(
          ({ x, y, z, yaw: yw, pitch: pt }) => window.__CTA_DEBUG__?.setView(x, y, z, yw, pt),
          { x: cam.x, y: cy, z: cam.z, yaw, pitch },
        );
        await sampleAndCapture(angleKey, `abc-${budget}-${sector.key}-${angleKey}.png`);
      }
    }
  }

  await writeFile(resolve(OUT_DIR, 'metrics.json'), JSON.stringify(allMetrics, null, 2) + '\n');
  expect(errors, `Browser errors occurred:\n${errors.join('\n')}`).toEqual([]);
});
