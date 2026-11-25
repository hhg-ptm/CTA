import * as THREE from 'three';
import type { RoadSurfaceStyle } from './types';

// Stronger contrast between surfaces so the player can read sidewalk edges,
// crossings and intersections at a glance while driving.
const ROAD_PALETTES: Record<
  Exclude<RoadSurfaceStyle, 'marking'>,
  readonly [number, number, number]
> = {
  asphalt: [55, 58, 65],
  stone: [200, 184, 153],
  sidewalk: [225, 218, 198],
  concrete: [165, 167, 160],
  earth: [172, 134, 94],
};

export function createRoadMaterials(): Map<RoadSurfaceStyle, THREE.MeshStandardMaterial> {
  const materials = new Map<RoadSurfaceStyle, THREE.MeshStandardMaterial>();
  for (const style of ['asphalt', 'stone', 'sidewalk', 'concrete', 'earth'] as const) {
    const texture = makeRoadTexture(style);
    materials.set(
      style,
      new THREE.MeshStandardMaterial({
        map: texture,
        vertexColors: true,
        roughness: 0.92,
        side: THREE.DoubleSide,
      }),
    );
  }
  materials.set(
    'marking',
    new THREE.MeshStandardMaterial({
      color: '#ffffff',
      vertexColors: true,
      roughness: 0.8,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  return materials;
}

export function createRoadPropMaterial(kind: string): THREE.MeshStandardMaterial {
  if (kind === 'street_lamp' || kind === 'street_lamp_modern') {
    return new THREE.MeshStandardMaterial({
      color: '#26292b',
      roughness: 0.6,
      metalness: 0.65,
      emissive: '#ffd988',
      emissiveIntensity: 0.25,
    });
  }
  const colors: Record<string, string> = {
    traffic_signals: '#34443d',
    stop: '#ab443b',
    give_way: '#d8d1bb',
    bus_shelter: '#3b648f',
    bench: '#7a5232',
    waste_basket: '#333940',
    fountain: '#a89f8d',
    shrub: '#3d7434',
    hedge: '#29572a',
  };
  return new THREE.MeshStandardMaterial({
    color: colors[kind] ?? '#d8d1bb',
    roughness: 0.8,
    metalness: 0.12,
  });
}

function makeRoadTexture(style: Exclude<RoadSurfaceStyle, 'marking'>): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create procedural road texture.');
  const [red, green, blue] = ROAD_PALETTES[style];
  context.fillStyle = `rgb(${red} ${green} ${blue})`;
  context.fillRect(0, 0, 256, 256);

  let seed = style.length * 9187 + 41;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  if (style === 'stone') {
    // Historic Cáceres granite cobblestones (adoquines de granito)
    const blockW = 32;
    const blockH = 20;
    const rows = 256 / blockH;
    for (let row = 0; row < rows; row += 1) {
      const y = row * blockH;
      const xOffset = (row % 2) * (blockW / 2);
      for (let x = -blockW; x <= 256 + blockW; x += blockW) {
        const curX = x + xOffset;
        const toneVar = Math.round((random() - 0.5) * 36);
        const r = Math.max(0, Math.min(255, red + toneVar));
        const g = Math.max(0, Math.min(255, green + toneVar - 2));
        const b = Math.max(0, Math.min(255, blue + toneVar - 6));
        context.fillStyle = `rgb(${r} ${g} ${b})`;
        context.fillRect(curX + 1.5, y + 1.5, blockW - 3, blockH - 3);

        // Chiseled stone bevel highlight (top edge) and shadow (bottom edge)
        context.fillStyle = 'rgb(255 255 255 / 16%)';
        context.fillRect(curX + 2, y + 2, blockW - 4, 1.5);
        context.fillStyle = 'rgb(0 0 0 / 22%)';
        context.fillRect(curX + 2, y + blockH - 3.5, blockW - 4, 1.5);

        // Granite mineral flecks
        for (let k = 0; k < 6; k += 1) {
          const fx = curX + 3 + random() * (blockW - 6);
          const fy = y + 3 + random() * (blockH - 6);
          context.fillStyle = random() > 0.5 ? 'rgb(255 255 255 / 35%)' : 'rgb(30 30 30 / 30%)';
          context.fillRect(fx, fy, 1.5, 1.5);
        }
      }
    }
  } else if (style === 'sidewalk') {
    // Large dressed granite paving slabs (losas de granito serradas)
    const slabW = 64;
    const slabH = 32;
    for (let row = 0; row < 8; row += 1) {
      const y = row * slabH;
      const xOffset = (row % 2) * (slabW / 2);
      for (let x = -slabW; x <= 256 + slabW; x += slabW) {
        const curX = x + xOffset;
        const toneVar = Math.round((random() - 0.5) * 18);
        context.fillStyle = `rgb(${red + toneVar} ${green + toneVar} ${blue + toneVar})`;
        context.fillRect(curX + 1.5, y + 1.5, slabW - 3, slabH - 3);

        // Clean grooved joints with soft shadow
        context.fillStyle = 'rgb(255 255 255 / 18%)';
        context.fillRect(curX + 2, y + 2, slabW - 4, 1.5);
        context.fillStyle = 'rgb(40 35 30 / 25%)';
        context.fillRect(curX + 2, y + slabH - 3, slabW - 4, 1.5);

        // Anti-slip stone texture flecks
        for (let k = 0; k < 12; k += 1) {
          const fx = curX + 3 + random() * (slabW - 6);
          const fy = y + 3 + random() * (slabH - 6);
          context.fillStyle = random() > 0.5 ? 'rgb(255 255 255 / 25%)' : 'rgb(40 40 40 / 18%)';
          context.fillRect(fx, fy, 1.5, 1.5);
        }
      }
    }
  } else {
    // Aggregate asphalt or compacted earth
    const count = style === 'earth' ? 1400 : 1800;
    for (let index = 0; index < count; index += 1) {
      const shade = random() > 0.5 ? 1 : -1;
      const alpha = style === 'asphalt' ? 0.08 + random() * 0.22 : 0.06 + random() * 0.2;
      const gray = shade > 0 ? 255 : 20;
      context.fillStyle = `rgb(${gray} ${gray} ${gray} / ${alpha})`;
      const size = 1 + random() * (style === 'earth' ? 3.5 : 2.2);
      context.fillRect(random() * 256, random() * 256, size, size);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
