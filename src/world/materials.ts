import * as THREE from 'three';

export type GroundMaterial = 'grass' | 'stone' | 'asphalt' | 'soil' | 'rock' | 'water';

export const GROUND_COLORS: Readonly<Record<GroundMaterial, readonly [number, number, number]>> = {
  grass: [0.35, 0.49, 0.27],
  stone: [0.58, 0.54, 0.45],
  asphalt: [0.25, 0.27, 0.28],
  soil: [0.52, 0.41, 0.29],
  rock: [0.5, 0.48, 0.43],
  water: [0.2, 0.38, 0.45],
};

export function createTerrainDetailTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create terrain detail canvas.');

  // Base neutral tone for clean vertex color modulation
  context.fillStyle = '#dcd7ce';
  context.fillRect(0, 0, 512, 512);

  // Multi-frequency noise and surface flecks
  let seed = 0x7a39b2;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // Broad organic patches
  for (let i = 0; i < 400; i += 1) {
    const x = rnd() * 512;
    const y = rnd() * 512;
    const r = 8 + rnd() * 24;
    const shade = rnd() > 0.5 ? 245 : 190;
    context.fillStyle = `rgb(${shade} ${shade - 6} ${shade - 14} / 0.12)`;
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fill();
  }

  // Micro gravel, stone chips and blade marks
  for (let i = 0; i < 4000; i += 1) {
    const x = rnd() * 512;
    const y = rnd() * 512;
    const isDark = rnd() > 0.45;
    const val = isDark ? 60 + rnd() * 50 : 220 + rnd() * 35;
    const alpha = 0.08 + rnd() * 0.16;
    context.fillStyle = `rgb(${val} ${val - 4} ${val - 10} / ${alpha})`;
    const size = 1 + rnd() * 2.5;
    context.fillRect(x, y, size, size);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function classifyGround(
  kind: string | undefined,
  value: string | undefined,
  surface: string | undefined,
): GroundMaterial {
  const surfaceName = surface?.toLowerCase() ?? '';
  if (['paving_stones', 'sett', 'cobblestone', 'stone'].includes(surfaceName)) return 'stone';
  if (['asphalt', 'concrete', 'paved', 'concrete:plates'].includes(surfaceName)) return 'asphalt';
  if (['unpaved', 'gravel', 'fine_gravel', 'ground', 'earth', 'dirt', 'sand'].includes(surfaceName))
    return 'soil';
  if (kind === 'square') return 'stone';
  if (kind === 'water' || kind === 'waterway' || value === 'water') return 'water';
  if (kind === 'natural' && ['bare_rock', 'rock', 'scree', 'shingle'].includes(value ?? ''))
    return 'rock';
  if (kind === 'natural' && ['sand', 'scrub', 'heath'].includes(value ?? '')) return 'soil';
  if (
    kind === 'landuse' &&
    ['residential', 'commercial', 'industrial', 'retail', 'construction'].includes(value ?? '')
  )
    return 'stone';
  if (
    kind === 'landuse' &&
    ['farmland', 'farmyard', 'orchard', 'vineyard', 'brownfield', 'quarry'].includes(value ?? '')
  )
    return 'soil';
  return 'grass';
}
