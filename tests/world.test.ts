import { describe, expect, it } from 'vitest';
import * as RAPIER from '@dimforge/rapier3d-compat';
import { buildTerrainChunk } from '../src/world/mesh-builder';
import { buildChunkBorderGeometry } from '../src/world/chunk-debug';
import { classifyGround } from '../src/world/materials';
import {
  createPhysicsWorld,
  TerrainColliders,
  toRapierColumnMajor,
} from '../src/world/terrain-physics';
import type { RawTerrainChunk } from '../src/world/types';

const rawChunk: RawTerrainChunk = {
  id: '0_0',
  bounds: { minX: -2, minZ: -2, maxX: 2, maxZ: 2 },
  terrain: {
    samples: 5,
    stepMeters: 1,
    quantizationMeters: 0.25,
    heights: Array.from({ length: 25 }, () => 1600),
  },
  features: [
    {
      featureType: 'surface',
      kind: 'landuse',
      value: 'residential',
      surface: '',
      points: [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
        [-2, -2],
      ],
    },
  ],
};

describe('terrain meshes', () => {
  it('builds three LOD grids with upward normals and closed skirts', () => {
    const chunk = buildTerrainChunk(rawChunk);
    expect(chunk.levels.map((level) => level.size)).toEqual([5, 3, 2]);
    expect(Array.from(chunk.levels[0]?.normals.slice(0, 3) ?? [])).toEqual([0, 1, 0]);
    expect(Array.from(chunk.levels[0]?.indices.slice(0, 6) ?? [])).toEqual([0, 5, 1, 1, 5, 6]);
    expect(chunk.levels[0]?.indices).toHaveLength(192);
    expect(chunk.minimumHeight).toBe(400);
    expect(chunk.maximumHeight).toBe(400);
  });

  it('colors terrain from mapped land use without adding road geometry', () => {
    const chunk = buildTerrainChunk(rawChunk);
    const centerColorOffset = (2 * 5 + 2) * 3;
    const centerColor =
      chunk.levels[0]?.colors.slice(centerColorOffset, centerColorOffset + 3) ?? [];
    expect(centerColor[0]).toBeCloseTo(0.59, 6);
    expect(centerColor[1]).toBeCloseTo(0.547, 6);
    expect(centerColor[2]).toBeCloseTo(0.454, 6);
    expect(classifyGround('water', 'water', '')).toBe('water');
    expect(classifyGround('natural', 'bare_rock', '')).toBe('rock');
    expect(classifyGround('surface', 'paving', 'paving_stones')).toBe('stone');
  });
});

describe('chunk debug borders', () => {
  it('draws a lifted perimeter that follows the terrain sample edges', () => {
    const chunk = buildTerrainChunk(rawChunk);
    const geometry = buildChunkBorderGeometry(chunk);
    const positions = geometry.getAttribute('position').array;
    expect(positions).toHaveLength(96);
    expect(positions[0]).toBe(-2);
    expect(positions[1]).toBeCloseTo(400.15, 4);
    expect(positions[2]).toBe(-2);
    expect(positions[3]).toBe(-1);
    geometry.dispose();
  });
});

describe('Rapier terrain grid layout', () => {
  it('converts row-major heights into Rapier column-major order', () => {
    expect(Array.from(toRapierColumnMajor(new Float32Array([1, 2, 3, 4]), 2))).toEqual([
      1, 3, 2, 4,
    ]);
  });

  it('creates a heightfield collider for a complete sample grid', async () => {
    const world = await createPhysicsWorld();
    const colliders = new TerrainColliders(world);
    try {
      colliders.add('0_0', rawChunk.bounds, 4, new Float32Array(25).fill(400), 5);
      expect(colliders.count).toBe(1);
    } finally {
      colliders.clear();
      world.free();
    }
  });

  it('refreshes scene queries so camera raycasts see new building colliders', async () => {
    const world = await createPhysicsWorld();
    const colliders = new TerrainColliders(world);
    try {
      // Quad in the YZ plane so the +X ray hits its face head-on.
      const positions = new Float32Array([0, -1, -1, 0, -1, 1, 0, 1, 1, 0, 1, -1]);
      const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
      colliders.addBuildings('building', 5, 0, positions, indices);
      const ray = new RAPIER.Ray({ x: 0, y: 0.5, z: 0 }, { x: 1, y: 0, z: 0 });
      expect(world.castRay(ray, 10, true)).toBeNull();
      colliders.refreshQueries();
      const hit = world.castRay(ray, 10, true);
      expect(hit).not.toBeNull();
      expect(hit?.toi).toBeCloseTo(5, 1);
    } finally {
      colliders.clear();
      world.free();
    }
  });
});
