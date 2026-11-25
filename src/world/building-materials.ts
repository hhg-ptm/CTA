import * as THREE from 'three';
import type { BuildingMaterial } from './types';

type ZoneKind = 'casco' | 'ensanche' | 'periferia';

interface BandTheme {
  readonly walls: readonly string[];
  readonly accent: string;
  readonly trim: string;
  readonly sill: string;
  readonly windowStyle: 'arched_reja' | 'shuttered' | 'persiana' | 'modern_ribbon' | 'clerestory';
  readonly masonry: 'ashlar' | 'limewash' | 'brick' | 'plaster' | 'curtain' | 'corrugated';
}

const BANDS: Readonly<Record<ZoneKind, readonly [BandTheme, BandTheme, BandTheme, BandTheme]>> = {
  casco: [
    // Band 0: Monumental granite ashlar palace ("sillería cacereña")
    {
      walls: ['#cdbd9f', '#c5b496', '#d4c5a8', '#bfb093'],
      accent: '#786855',
      trim: '#e2d4ba',
      sill: '#ede2cb',
      windowStyle: 'arched_reja',
      masonry: 'ashlar',
    },
    // Band 1: Whitewashed Cáceres Plaza house ("encalado")
    {
      walls: ['#f0eadf', '#ebe4d6', '#f4efe5', '#e6dfd0'],
      accent: '#3e5440',
      trim: '#c9b89c',
      sill: '#dfd3bc',
      windowStyle: 'shuttered',
      masonry: 'limewash',
    },
    // Band 2: Warm Extremadura ochre sandstone townhouse
    {
      walls: ['#dfc292', '#d7b783', '#e5cba0', '#cfb07d'],
      accent: '#5a4332',
      trim: '#efe0c4',
      sill: '#e9d8b8',
      windowStyle: 'shuttered',
      masonry: 'plaster',
    },
    // Band 3: Sienna terracotta & historic church masonry
    {
      walls: ['#cfa282', '#c79575', '#d9ad8e', '#be8e6e'],
      accent: '#4f3b2e',
      trim: '#e6ccb4',
      sill: '#dec5ad',
      windowStyle: 'arched_reja',
      masonry: 'limewash',
    },
  ],
  ensanche: [
    // Band 0: Red exposed brick ("ladrillo caravista") + crisp white slab bands
    {
      walls: ['#b14b34', '#a5432e', '#bc543c', '#9c3e2a'],
      accent: '#f0ebe1',
      trim: '#ebe6dc',
      sill: '#dad4c8',
      windowStyle: 'persiana',
      masonry: 'brick',
    },
    // Band 1: Warm champagne / sandstone residential apartment stucco
    {
      walls: ['#e7ddcc', '#ded3c0', '#eee5d6', '#d6cab6'],
      accent: '#584e43',
      trim: '#f3ede3',
      sill: '#cbc2b3',
      windowStyle: 'persiana',
      masonry: 'plaster',
    },
    // Band 2: Coral / peach Mediterranean residential facade
    {
      walls: ['#dfbaa2', '#d6ae95', '#e6c5af', '#cda48b'],
      accent: '#4a4a4c',
      trim: '#f0e6dc',
      sill: '#d4ccc2',
      windowStyle: 'shuttered',
      masonry: 'plaster',
    },
    // Band 3: Contemporary office / retail / hotel glass & aluminum
    {
      walls: ['#d8dde0', '#cdd4d8', '#e3e7ea', '#c2cace'],
      accent: '#2c343b',
      trim: '#454e56',
      sill: '#889299',
      windowStyle: 'modern_ribbon',
      masonry: 'curtain',
    },
  ],
  periferia: [
    // Band 0: Whitewashed & terracotta chalet / rowhouse ("adosado")
    {
      walls: ['#f2efe8', '#ebe6dd', '#f5f3ed', '#e3ded3'],
      accent: '#98553b',
      trim: '#ded7cb',
      sill: '#9e8f7e',
      windowStyle: 'shuttered',
      masonry: 'limewash',
    },
    // Band 1: Suburban ochre-brick apartment block
    {
      walls: ['#d2b38c', '#c8a77f', '#dbbe99', '#be9d76'],
      accent: '#d8d2c7',
      trim: '#eae4d8',
      sill: '#c5bfb5',
      windowStyle: 'persiana',
      masonry: 'brick',
    },
    // Band 2: Industrial / warehouse corrugated steel ("nave polígono")
    {
      walls: ['#9fa7ad', '#939ca2', '#abb3b9', '#8a939a'],
      accent: '#3e474e',
      trim: '#c9cfd3',
      sill: '#5a636a',
      windowStyle: 'clerestory',
      masonry: 'corrugated',
    },
    // Band 3: Institutional school / hospital / campus concrete & sandstone
    {
      walls: ['#d9d2c5', '#cfc7b9', '#e2dcd0', '#c5bdb0'],
      accent: '#4c575c',
      trim: '#ebe6dc',
      sill: '#8b8880',
      windowStyle: 'modern_ribbon',
      masonry: 'plaster',
    },
  ],
};

function seeded(seed: number): number {
  let value = seed | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 0x1_0000_0000;
}

function seededSequence(seed: number): () => number {
  let step = 0;
  return () => {
    step += 1;
    return seeded(seed + step * 7919);
  };
}

function drawMasonryTexture(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tile: number,
  theme: BandTheme,
  seed: number,
): void {
  const next = seededSequence(seed);
  if (theme.masonry === 'brick') {
    // Clean stylized brick warmth without noisy dark pixels
    const bh = 10;
    const bw = 24;
    for (let by = 0; by < tile; by += bh) {
      const offset = ((by / bh) % 2) * (bw / 2);
      ctx.fillStyle = 'rgb(244 232 216 / 14%)';
      ctx.fillRect(x, y + by, tile, 1);
      for (let bx = -offset; bx < tile; bx += bw) {
        ctx.fillStyle = next() > 0.5 ? 'rgb(255 210 175 / 9%)' : 'rgb(80 28 14 / 8%)';
        ctx.fillRect(x + Math.max(0, bx + 1), y + by + 1, Math.min(bw - 1.5, tile - bx), bh - 1.2);
      }
    }
    return;
  }
  if (theme.masonry === 'ashlar') {
    // Subtle sunlit Cáceres golden granite coursing (clean Stylized Low Poly blocks)
    const bh = 26;
    for (let by = 0; by < tile; by += bh) {
      const offset = ((by / bh) % 2) * 26;
      ctx.fillStyle = 'rgb(255 248 228 / 14%)';
      ctx.fillRect(x, y + by + 1, tile, 1.5);
      for (let bx = -offset; bx < tile; bx += 52) {
        const w = Math.min(50, tile - Math.max(0, bx));
        const rx = x + Math.max(0, bx);
        ctx.fillStyle = next() > 0.5 ? 'rgb(255 250 236 / 9%)' : 'rgb(110 92 66 / 7%)';
        ctx.fillRect(rx + 1, y + by + 2, Math.max(1, w - 2), bh - 3);
        ctx.fillStyle = 'rgb(115 96 72 / 12%)';
        if (bx >= 0) ctx.fillRect(x + bx, y + by, 1.2, bh);
      }
    }
    return;
  }
  if (theme.masonry === 'corrugated') {
    for (let bx = 0; bx < tile; bx += 10) {
      ctx.fillStyle = 'rgb(255 255 255 / 12%)';
      ctx.fillRect(x + bx, y, 2, tile);
      ctx.fillStyle = 'rgb(40 48 56 / 12%)';
      ctx.fillRect(x + bx + 5, y, 2, tile);
    }
    ctx.fillStyle = 'rgb(45 50 56 / 18%)';
    ctx.fillRect(x, y + tile / 2, tile, 2);
    return;
  }
  if (theme.masonry === 'curtain') {
    ctx.fillStyle = '#364d59';
    ctx.fillRect(x + 4, y + 6, tile - 8, tile - 14);
    const grad = ctx.createLinearGradient(x, y, x + tile, y + tile);
    grad.addColorStop(0, '#78b4d4');
    grad.addColorStop(0.55, '#4682a4');
    grad.addColorStop(1, '#2b556c');
    ctx.fillStyle = grad;
    ctx.fillRect(x + 8, y + 10, tile - 16, tile - 22);
    ctx.fillStyle = theme.trim;
    ctx.fillRect(x, y, tile, 9);
    ctx.fillRect(x, y + tile - 9, tile, 9);
    ctx.fillRect(x + tile * 0.48, y + 8, 3, tile - 16);
    return;
  }
  // Smooth limewash / plaster with minimal warm sunlight grain
  for (let i = 0; i < 14; i += 1) {
    ctx.fillStyle = next() > 0.5 ? 'rgb(255 253 246 / 10%)' : 'rgb(140 120 96 / 4%)';
    const sz = 2 + next() * 5;
    ctx.fillRect(x + next() * tile, y + next() * tile, sz, sz);
  }
}

function drawGlassPane(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frame: string,
  litGlow: boolean,
  emissive: boolean,
): void {
  if (emissive) {
    ctx.fillStyle = litGlow ? '#ffe29a' : '#030302';
    ctx.fillRect(x + 2, y + 2, Math.max(2, w - 4), Math.max(2, h - 4));
    return;
  }
  // Vibrant cerulean-sky stylized glazing with crisp frame and sky slash
  ctx.fillStyle = '#25292e';
  ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, '#78bfe3');
  grad.addColorStop(0.55, '#3e7da1');
  grad.addColorStop(1, '#24526b');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgb(240 251 255 / 38%)';
  ctx.beginPath();
  ctx.moveTo(x + 2, y + 2);
  ctx.lineTo(x + Math.min(w - 2, 20), y + 2);
  ctx.lineTo(x + 2, y + Math.min(h - 2, 30));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = frame;
  ctx.fillRect(x + w * 0.5 - 1.2, y, 2.4, h);
  ctx.fillRect(x, y + h * 0.52, w, 2);
}

function drawTileOpenings(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tile: number,
  col: number,
  isGround: boolean,
  theme: BandTheme,
  emissive: boolean,
  litGlow: boolean,
): void {
  // Col 6 = corner quoins (no opening); Col 7 = blind party wall (no opening)
  if (col === 6) {
    if (!emissive) {
      ctx.fillStyle = theme.trim;
      for (let qy = 4; qy < tile - 8; qy += 22) {
        const w = (qy / 22) % 2 === 0 ? 18 : 11;
        ctx.fillRect(x + 2, y + qy, w, 16);
        ctx.fillRect(x + tile - 2 - w, y + qy, w, 16);
      }
    }
    return;
  }
  if (col === 7) return;

  if (isGround) {
    if (!emissive) {
      // Lower dado / stone plinth inside ground tile
      ctx.fillStyle = 'rgb(45 40 35 / 22%)';
      ctx.fillRect(x, y + tile - 16, tile, 16);
    }
    if (col === 2) {
      // Archway door / portal / truck shutter on ground floor
      if (theme.masonry === 'corrugated') {
        if (!emissive) {
          ctx.fillStyle = '#4f575e';
          ctx.fillRect(x + 20, y + 24, 88, 102);
          ctx.fillStyle = '#6c747a';
          for (let ry = 28; ry < 122; ry += 6) ctx.fillRect(x + 24, y + ry, 80, 3);
        }
      } else {
        if (!emissive) {
          ctx.fillStyle = theme.trim;
          ctx.fillRect(x + 36, y + 28, 56, 98);
          ctx.fillStyle = '#4e3522';
          ctx.fillRect(x + 42, y + 36, 44, 90);
          ctx.fillStyle = '#332215';
          ctx.fillRect(x + 63, y + 36, 2, 90);
        }
      }
      return;
    }
    if (col === 1 || col === 4) {
      // Wide ground commercial storefront window
      if (!emissive) {
        ctx.fillStyle = theme.accent;
        ctx.fillRect(x + 16, y + 22, 96, 86);
      }
      drawGlassPane(ctx, x + 21, y + 27, 86, 72, theme.accent, litGlow, emissive);
      return;
    }
    if (col === 3) return; // Ground blind wall variation
    // Ground guarded window
    drawGlassPane(ctx, x + 42, y + 28, 44, 62, theme.accent, litGlow, emissive);
    if (!emissive && theme.windowStyle === 'arched_reja') {
      ctx.fillStyle = '#202225';
      for (let rx = 44; rx <= 82; rx += 9) ctx.fillRect(x + rx, y + 28, 2, 66);
    }
    return;
  }

  // Upper floor openings (cols 0..5)
  if (theme.windowStyle === 'clerestory') {
    drawGlassPane(ctx, x + 12, y + 22, 104, 24, '#414950', litGlow, emissive);
    return;
  }
  if (theme.windowStyle === 'modern_ribbon') {
    const xPad = col === 3 ? 42 : 14;
    drawGlassPane(ctx, x + xPad, y + 26, tile - xPad * 2, 58, theme.accent, litGlow, emissive);
    return;
  }
  if (col === 3) {
    // Narrow stairwell / vertical window
    drawGlassPane(ctx, x + 48, y + 28, 32, 62, theme.accent, litGlow, emissive);
    return;
  }
  if (col === 1 || col === 5) {
    // Paired double window bay
    drawGlassPane(ctx, x + 16, y + 30, 38, 60, theme.accent, litGlow, emissive);
    drawGlassPane(ctx, x + 74, y + 30, 38, 60, theme.accent, litGlow, emissive);
    if (!emissive) {
      ctx.fillStyle = theme.sill;
      ctx.fillRect(x + 12, y + 92, 46, 5);
      ctx.fillRect(x + 70, y + 92, 46, 5);
    }
    return;
  }
  // Single central tall window / shuttered window / persiana
  const w = 44;
  const h = col === 2 ? 72 : 60;
  const wx = x + (tile - w) / 2;
  const wy = y + 28;
  drawGlassPane(ctx, wx, wy, w, h, theme.accent, litGlow, emissive);
  if (!emissive) {
    if (theme.windowStyle === 'persiana') {
      ctx.fillStyle = '#d4cfc5';
      ctx.fillRect(wx - 4, wy - 10, w + 8, 12);
      ctx.fillStyle = '#6f6c66';
      for (let sy = 0; sy < 14; sy += 4) ctx.fillRect(wx, wy + 2 + sy, w, 2);
    } else if (theme.windowStyle === 'shuttered') {
      ctx.fillStyle = theme.accent;
      ctx.fillRect(wx - 15, wy + 2, 11, h - 4);
      ctx.fillRect(wx + w + 4, wy + 2, 11, h - 4);
    }
    ctx.fillStyle = theme.sill;
    ctx.fillRect(wx - 7, wy + h + 2, w + 14, 5);
  }
}

function drawFacade(zone: ZoneKind, emissive: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create procedural facade texture.');
  const tile = 128;
  const cols = 8;
  const rows = 8;
  canvas.width = tile * cols;
  canvas.height = tile * rows;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const bands = BANDS[zone];
  for (let uvRow = 0; uvRow < rows; uvRow += 1) {
    const bandIndex = Math.min(3, Math.floor(uvRow / 2)) as 0 | 1 | 2 | 3;
    const isGround = uvRow % 2 === 0;
    const theme = bands[bandIndex];
    // CanvasTexture flips Y by default, so uvRow 0 sits at the bottom canvas row.
    const canvasRow = rows - 1 - uvRow;
    const y = canvasRow * tile;

    for (let col = 0; col < cols; col += 1) {
      const x = col * tile;
      const seed = uvRow * 47 + col * 131 + zone.length * 29;
      if (!emissive) {
        ctx.fillStyle = theme.walls[(col + uvRow) % theme.walls.length] ?? '#d8cebc';
        ctx.fillRect(x, y, tile, tile);
        drawMasonryTexture(ctx, x, y, tile, theme, seed);
        // Clean concrete/stone floor slab line
        ctx.fillStyle = theme.trim;
        ctx.fillRect(x, y + tile - 8, tile, 8);
        ctx.fillRect(x, y, tile, 5);
      }
      const litGlow = seeded(seed + 19) > 0.56;
      drawTileOpenings(ctx, x, y, tile, col, isGround, theme, emissive, litGlow);
    }
  }
  return canvas;
}

function drawRoof(tile: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create procedural roof texture.');
  canvas.width = 256;
  canvas.height = 256;
  ctx.fillStyle = tile ? '#b96441' : '#969a9f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (tile) {
    const colW = 24;
    const tileH = 26;
    const cols = Math.ceil(256 / colW);
    const rows = Math.ceil(256 / tileH) + 1;
    const tones = ['#c36943', '#cf744b', '#b15c38', '#d77d53', '#bc633e'];
    for (let col = 0; col < cols; col += 1) {
      const x = col * colW;
      for (let row = -1; row < rows; row += 1) {
        const y = row * tileH;
        const seed = (col * 37 + row * 19 + 71) % tones.length;
        ctx.fillStyle = tones[seed] ?? '#c36943';
        ctx.fillRect(x + 1, y, colW - 2, tileH);
        const grad = ctx.createLinearGradient(x, y, x + colW, y);
        grad.addColorStop(0, 'rgb(80 28 12 / 14%)');
        grad.addColorStop(0.45, 'rgb(255 240 225 / 18%)');
        grad.addColorStop(1, 'rgb(70 24 10 / 16%)');
        ctx.fillStyle = grad;
        ctx.fillRect(x + 1, y, colW - 2, tileH);
        ctx.fillStyle = 'rgb(70 26 12 / 14%)';
        ctx.fillRect(x, y + tileH - 2, colW, 2);
      }
    }
  } else {
    ctx.strokeStyle = 'rgb(245 248 252 / 22%)';
    ctx.lineWidth = 2;
    for (let offset = 0; offset <= 256; offset += 64) {
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, offset);
      ctx.lineTo(256, offset);
      ctx.stroke();
    }
  }
  return canvas;
}

function drawMonumentStone(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create procedural stone texture.');
  canvas.width = 256;
  canvas.height = 256;
  ctx.fillStyle = '#c4b599';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const blockH = 32;
  const rows = 256 / blockH;
  const stones = ['#cebfa2', '#bfae92', '#c7b89c', '#b7a68a', '#d4c6aa'];
  for (let row = 0; row < rows; row += 1) {
    const y = row * blockH;
    const xOffset = (row % 2) * 32;
    for (let x = -32; x <= 256 + 32; x += 64) {
      const curX = x + xOffset;
      const seed = (row * 13 + (x >> 5) * 29 + 43) % stones.length;
      ctx.fillStyle = stones[seed] ?? '#c0b094';
      ctx.fillRect(curX + 1.5, y + 1.5, 61, blockH - 3);
      ctx.fillStyle = 'rgb(255 255 255 / 22%)';
      ctx.fillRect(curX + 2, y + 2, 60, 2);
      ctx.fillRect(curX + 2, y + 2, 2, blockH - 4);
      ctx.fillStyle = 'rgb(45 38 28 / 34%)';
      ctx.fillRect(curX + 2, y + blockH - 3.5, 60, 2);
      ctx.fillRect(curX + 61, y + 2, 2, blockH - 4);
    }
  }
  return canvas;
}

function canvasTexture(canvas: HTMLCanvasElement, repeat: boolean): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  return texture;
}

export function createBuildingMaterials(): Map<BuildingMaterial, THREE.MeshStandardMaterial> {
  const casco = drawFacade('casco', false);
  const ensanche = drawFacade('ensanche', false);
  const periferia = drawFacade('periferia', false);
  const cascoGlow = drawFacade('casco', true);
  const ensancheGlow = drawFacade('ensanche', true);
  const periferiaGlow = drawFacade('periferia', true);
  const facade = (map: HTMLCanvasElement, glow: HTMLCanvasElement): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({
      map: canvasTexture(map, false),
      emissive: '#ffca77',
      emissiveMap: canvasTexture(glow, false),
      emissiveIntensity: 0,
      vertexColors: true,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
  const roof = (tile: boolean): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({
      map: canvasTexture(drawRoof(tile), true),
      vertexColors: true,
      roughness: tile ? 0.9 : 0.76,
      side: THREE.DoubleSide,
    });
  const monumentStone = new THREE.MeshStandardMaterial({
    map: canvasTexture(drawMonumentStone(), true),
    vertexColors: true,
    roughness: 0.94,
    side: THREE.DoubleSide,
  });
  return new Map([
    ['casco_facade', facade(casco, cascoGlow)],
    ['ensanche_facade', facade(ensanche, ensancheGlow)],
    ['periferia_facade', facade(periferia, periferiaGlow)],
    ['tile_roof', roof(true)],
    ['modern_roof', roof(false)],
    ['monument_stone', monumentStone],
  ]);
}
