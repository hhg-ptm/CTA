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

interface ZoneShotSpec {
  readonly zoneKey: string;
  readonly label: string;
  readonly focus: { readonly x: number; readonly z: number; readonly targetYOffset: number };
  readonly player: { readonly x: number; readonly z: number };
  readonly streetCam: {
    readonly x: number;
    readonly z: number;
    readonly heightAboveGround: number;
  };
  readonly closeupCam: {
    readonly x: number;
    readonly z: number;
    readonly heightAboveGround: number;
  };
  readonly aerialCam: {
    readonly x: number;
    readonly z: number;
    readonly heightAboveGround: number;
  };
}

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

const ZONES: readonly ZoneShotSpec[] = [
  {
    zoneKey: '01-casco-historico',
    label: 'Casco Histórico (Plaza Mayor / Ayuntamiento / Diputación)',
    focus: { x: -34, z: -7, targetYOffset: 7.5 },
    player: { x: -12, z: 32 },
    streetCam: { x: -16, z: 54, heightAboveGround: 2.6 },
    closeupCam: { x: -12, z: 14, heightAboveGround: 4.8 },
    aerialCam: { x: 75, z: 34, heightAboveGround: 68 },
  },
  {
    zoneKey: '02-bloques-residenciales',
    label: 'Bloques Residenciales Modernos (Av. Virgen de Guadalupe / Cánovas)',
    focus: { x: -556, z: -332, targetYOffset: 15 },
    player: { x: -516, z: -362 },
    streetCam: { x: -508, z: -385, heightAboveGround: 2.8 },
    closeupCam: { x: -522, z: -358, heightAboveGround: 10.5 },
    aerialCam: { x: -460, z: -260, heightAboveGround: 78 },
  },
  {
    zoneKey: '03-viviendas-unifamiliares',
    label: 'Viviendas Unifamiliares / Chalets (Vistahermosa)',
    focus: { x: -1984, z: -72, targetYOffset: 3.5 },
    player: { x: -1968, z: -67 },
    streetCam: { x: -1978, z: -118, heightAboveGround: 2.6 },
    closeupCam: { x: -1968, z: -68, heightAboveGround: 4.5 },
    aerialCam: { x: -1918, z: -115, heightAboveGround: 54 },
  },
  {
    zoneKey: '04-zona-comercial',
    label: 'Zona Comercial (Av. Ruta de la Plata / El Vivero)',
    focus: { x: -1724, z: -348, targetYOffset: 4.5 },
    player: { x: -1766, z: -251 },
    streetCam: { x: -1778, z: -240, heightAboveGround: 2.8 },
    closeupCam: { x: -1748, z: -292, heightAboveGround: 5.0 },
    aerialCam: { x: -1810, z: -215, heightAboveGround: 64 },
  },
];

const OUT_DIR = resolve('reports', 'screens', 'fase2-prototype');

test('captures multi-angle in-game prototype renders across all 4 Cáceres zones', async ({
  page,
}) => {
  await mkdir(OUT_DIR, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('response', (res) => {
    if (!res.ok() && !res.url().endsWith('/favicon.ico')) {
      errors.push(`${res.status()} ${res.url()}`);
    }
  });

  await page.goto('/?world=cc-prototype&debug=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__CTA_DEBUG__), null, { timeout: 30_000 });
  // Hide the debug HUD panel and red chunk boundary lines so prototype renders are clean.
  await page.keyboard.press('F3');
  await page.keyboard.press('F4');
  await page.keyboard.press('F4');

  const reportLines = [
    '# Capturas Prototipo FASE 2 — Cáceres Criminal (`?world=cc-prototype`)',
    '',
    '| Zona | Ángulo | Draw calls | Triángulos | Chunks | Colliders | Archivo |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
  ];

  for (const zone of ZONES) {
    // Teleport via free view first so ChunkManager immediately streams target zone chunks with zero lerp drift
    await page.evaluate(({ x, z }) => {
      window.__CTA_DEBUG__?.setView(x, 450, z, 0, -0.3);
    }, zone.player);
    await page.waitForFunction(
      () => {
        const m = window.__CTA_DEBUG__?.metrics();
        return Boolean(
          m && m.groundHeight !== null && m.pendingChunks === 0 && m.loadedChunks >= 3,
        );
      },
      null,
      { timeout: 45_000 },
    );
    await page.evaluate(({ x, z }) => window.__CTA_DEBUG__?.teleport(x, z), zone.player);
    await page.waitForTimeout(700);

    const groundAtPlayer = await page.evaluate(
      () => window.__CTA_DEBUG__?.metrics().groundHeight ?? 400,
    );

    // Angle A: Cámara a la altura del personaje (3rd person gameplay view)
    const pAngles = lookAngles(
      zone.player.x,
      groundAtPlayer + 2.2,
      zone.player.z,
      zone.focus.x,
      groundAtPlayer + zone.focus.targetYOffset,
      zone.focus.z,
    );
    await page.evaluate(
      ({ x, z, yaw }) => window.__CTA_DEBUG__?.thirdPersonView(x, z, yaw, -0.08),
      { x: zone.player.x, z: zone.player.z, yaw: pAngles.yaw },
    );
    await page.waitForTimeout(550);
    const playerShot = `${zone.zoneKey}-personaje.png`;
    await page.screenshot({ path: resolve(OUT_DIR, playerShot), animations: 'disabled' });
    const pm = await page.evaluate(() => window.__CTA_DEBUG__?.metrics());
    reportLines.push(
      `| ${zone.label} | Personaje (3ª persona) | ${pm?.drawCalls ?? 0} | ${pm?.triangles ?? 0} | ${pm?.loadedChunks ?? 0} | ${pm?.colliderCount ?? 0} | \`${playerShot}\` |`,
    );

    // Helper for the 3 free camera perspectives
    const angles = [
      { key: 'calle', label: 'Perspectiva de calle', cam: zone.streetCam },
      { key: 'fachada', label: 'Vista cercana de fachadas', cam: zone.closeupCam },
      { key: 'aerea', label: 'Vista aérea', cam: zone.aerialCam },
    ] as const;

    for (const a of angles) {
      const cy = groundAtPlayer + a.cam.heightAboveGround;
      const ty = groundAtPlayer + zone.focus.targetYOffset;
      const { yaw, pitch } = lookAngles(a.cam.x, cy, a.cam.z, zone.focus.x, ty, zone.focus.z);
      await page.evaluate(
        ({ x, y, z, yaw: yw, pitch: pt }) => window.__CTA_DEBUG__?.setView(x, y, z, yw, pt),
        { x: a.cam.x, y: cy, z: a.cam.z, yaw, pitch },
      );
      await page.waitForTimeout(450);
      const shot = `${zone.zoneKey}-${a.key}.png`;
      await page.screenshot({ path: resolve(OUT_DIR, shot), animations: 'disabled' });
      const metrics = await page.evaluate(() => window.__CTA_DEBUG__?.metrics());
      reportLines.push(
        `| ${zone.label} | ${a.label} | ${metrics?.drawCalls ?? 0} | ${metrics?.triangles ?? 0} | ${metrics?.loadedChunks ?? 0} | ${metrics?.colliderCount ?? 0} | \`${shot}\` |`,
      );
      expect(metrics?.drawCalls ?? 999).toBeLessThanOrEqual(300);
      expect(metrics?.triangles ?? 9999999).toBeLessThanOrEqual(600_000);
    }
  }

  await writeFile(
    resolve('reports', 'fase2-prototype-summary.md'),
    reportLines.join('\n') + '\n',
    'utf8',
  );
  expect(errors).toEqual([]);
});
