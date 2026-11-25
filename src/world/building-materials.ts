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
    const bh = 8;
    const bw = 20;
    for (let by = 0; by < tile; by += bh) {
      const offset = ((by / bh) % 2) * (bw / 2);
      ctx.fillStyle = 'rgb(232 222 206 / 22%)';
      ctx.fillRect(x, y + by, tile, 1);
      for (let bx = -offset; bx < tile; bx += bw) {
        ctx.fillStyle = next() > 0.5 ? 'rgb(28 10 6 / 16%)' : 'rgb(255 190 140 / 10%)';
        ctx.fillRect(x + Math.max(0, bx + 1), y + by + 1, Math.min(bw - 1.5, tile - bx), bh - 1.2);
        ctx.fillStyle = 'rgb(232 222 206 / 20%)';
        if (bx >= 0) ctx.fillRect(x + bx, y + by, 1, bh);
      }
    }
    return;
  }
  if (theme.masonry === 'ashlar') {
    const bh = 22;
    for (let by = 0; by < tile; by += bh) {
      const offset = ((by / bh) % 2) * 24;
      for (let bx = -offset; bx < tile; bx += 48) {
        const w = Math.min(46, tile - Math.max(0, bx));
        const rx = x + Math.max(0, bx);
        ctx.fillStyle = next() > 0.5 ? 'rgb(255 248 228 / 12%)' : 'rgb(52 42 30 / 10%)';
        ctx.fillRect(rx + 1, y + by + 1, Math.max(1, w - 2), bh - 2);
        ctx.fillStyle = 'rgb(70 58 44 / 26%)';
        ctx.fillRect(x, y + by, tile, 1.5);
        if (bx >= 0) ctx.fillRect(x + bx, y + by, 1.5, bh);
      }
    }
    return;
  }
  if (theme.masonry === 'corrugated') {
    for (let bx = 0; bx < tile; bx += 8) {
      ctx.fillStyle = 'rgb(255 255 255 / 16%)';
      ctx.fillRect(x + bx, y, 2, tile);
      ctx.fillStyle = 'rgb(30 35 40 / 18%)';
      ctx.fillRect(x + bx + 4, y, 2.5, tile);
    }
    ctx.fillStyle = 'rgb(45 50 56 / 28%)';
    ctx.fillRect(x, y + tile / 2, tile, 2);
    return;
  }
  if (theme.masonry === 'curtain') {
    ctx.fillStyle = '#33464f';
    ctx.fillRect(x + 4, y + 6, tile - 8, tile - 14);
    const grad = ctx.createLinearGradient(x, y, x + tile, y + tile);
    grad.addColorStop(0, '#7292a1');
    grad.addColorStop(1, '#314c59');
    ctx.fillStyle = grad;
    ctx.fillRect(x + 8, y + 10, tile - 16, tile - 22);
    ctx.fillStyle = theme.trim;
    ctx.fillRect(x, y, tile, 10);
    ctx.fillRect(x, y + tile - 10, tile, 10);
    ctx.fillRect(x + tile * 0.48, y + 8, 4, tile - 16);
    return;
  }
  // Limewash / warm plaster subtle mineral flecks
  for (let i = 0; i < 36; i += 1) {
    ctx.fillStyle = next() > 0.5 ? 'rgb(255 252 242 / 14%)' : 'rgb(75 60 44 / 8%)';
    const sz = 1.5 + next() * 3.5;
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
  ctx.fillStyle = '#2d2824';
  ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, '#698591');
  grad.addColorStop(1, '#263942');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  // Crisp sky diagonal reflection
  ctx.fillStyle = 'rgb(235 247 255 / 26%)';
  ctx.beginPath();
  ctx.moveTo(x + 2, y + 2);
  ctx.lineTo(x + Math.min(w - 2, 16), y + 2);
  ctx.lineTo(x + 2, y + Math.min(h - 2, 26));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = frame;
  ctx.fillRect(x + w * 0.5 - 1.5, y, 3, h);
  ctx.fillRect(x, y + h * 0.52, w, 2.5);
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
  ctx.fillStyle = tile ? '#945235' : '#898882';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (tile) {
    const colW = 16;
    const tileH = 20;
    const cols = 256 / colW;
    const rows = 256 / tileH + 1;
    const tones = ['#a45534', '#b0613d', '#8e482b', '#ba6b44', '#974d30', '#a65a38'];
    for (let col = 0; col < cols; col += 1) {
      const x = col * colW;
      for (let row = -1; row < rows; row += 1) {
        const y = row * tileH;
        const seed = (col * 37 + row * 19 + 71) % tones.length;
        ctx.fillStyle = tones[seed] ?? '#9e5334';
        ctx.fillRect(x + 1, y, colW - 2, tileH);
        const grad = ctx.createLinearGradient(x, y, x + colW, y);
        grad.addColorStop(0, 'rgb(0 0 0 / 38%)');
        grad.addColorStop(0.45, 'rgb(255 255 255 / 32%)');
        grad.addColorStop(1, 'rgb(0 0 0 / 42%)');
        ctx.fillStyle = grad;
        ctx.fillRect(x + 1, y, colW - 2, tileH);
        ctx.fillStyle = 'rgb(0 0 0 / 35%)';
        ctx.fillRect(x, y + tileH - 2.5, colW, 2.5);
      }
    }
  } else {
    ctx.strokeStyle = '#a4a29b';
    ctx.lineWidth = 3;
    for (let offset = 0; offset <= 256; offset += 32) {
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, offset);
      ctx.lineTo(256, offset);
      ctx.stroke();
    }
    const next = seededSequence(411);
    for (let i = 0; i < 600; i += 1) {
      ctx.fillStyle = next() > 0.5 ? 'rgb(255 255 255 / 8%)' : 'rgb(40 40 40 / 8%)';
      ctx.fillRect(next() * 256, next() * 256, 2, 2);
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
