import { describe, expect, it } from 'vitest';
import { buildBuildingChunk } from '../src/world/building-builder';
import { buildRoadChunk } from '../src/world/road-builder';
import { buildTerrainChunk } from '../src/world/mesh-builder';
import { insetPolygon, triangulatePolygonWithHoles } from '../src/world/polygon-holes';
import type { ChunkFeature, RawTerrainChunk } from '../src/world/types';

const bounds = { minX: -24, minZ: -24, maxX: 24, maxZ: 24 };
const terrain = buildTerrainChunk({
  id: '0_0',
  bounds,
  terrain: {
    samples: 5,
    stepMeters: 12,
    quantizationMeters: 0.25,
    heights: Array.from({ length: 25 }, () => 1600),
  },
  features: [],
} satisfies RawTerrainChunk);

describe('Phase 2 Stylized 3D building & vegetation geometry', () => {
  it('triangulates polygons with courtyard holes preserving exact open patio area', () => {
    const outer = [
      [-8, -8],
      [8, -8],
      [8, 8],
      [-8, 8],
    ] as const;
    const hole = [
      [-3, -3],
      [3, -3],
      [3, 3],
      [-3, 3],
    ] as const;
    const { vertices, triangles } = triangulatePolygonWithHoles(outer, [hole]);
    expect(triangles.length).toBeGreaterThanOrEqual(8);
    let area = 0;
    for (const [a, b, c] of triangles) {
      const va = vertices[a];
      const vb = vertices[b];
      const vc = vertices[c];
      if (!va || !vb || !vc) continue;
      area += Math.abs((vb[0] - va[0]) * (vc[1] - va[1]) - (vc[0] - va[0]) * (vb[1] - va[1])) * 0.5;
    }
    expect(area).toBeCloseTo(16 * 16 - 6 * 6, 3);
  });

  it('computes clean setback attic polygons and rejects collapsing ones', () => {
    const rect = [
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
    ] as const;
    const inset = insetPolygon(rect, 1.5);
    expect(inset).toHaveLength(4);
    expect(Math.abs(inset[0]?.[0] ?? 0)).toBeCloseTo(8.5, 2);
    expect(
      insetPolygon(
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ],
        1.5,
      ),
    ).toEqual([]);
  });

  it('builds real inner courtyard walls, closed gable tympanums, stepped parts, and portal orientation', () => {
    const courtyardPalace: ChunkFeature = {
      id: 'w90001',
      featureType: 'building',
      zone: 'casco',
      historic: 'palace',
      catastroUse: '4_3_publicServices',
      visualFloors: 4,
      visualHeightMeters: 13.5,
      roofShape: 'flat',
      roofMaterial: 'tile',
      points: [
        [-12, -12],
        [12, -12],
        [12, 12],
        [-12, 12],
        [-12, -12],
      ],
      innerRings: [
        [
          [-4, -4],
          [4, -4],
          [4, 4],
          [-4, 4],
        ],
      ],
      portalPoints: [[0, -12.6]],
    };
    const steppedBlock: ChunkFeature = {
      id: 'w90002',
      featureType: 'building',
      zone: 'ensanche',
      buildingType: 'apartments',
      catastroUse: '1_residential',
      catastroEra: 'ensanche_1950_1985',
      commercial: true,
      visualFloors: 6,
      roofShape: 'flat',
      points: [
        [14, -10],
        [22, -10],
        [22, 10],
        [14, 10],
        [14, -10],
      ],
      parts: [
        {
          pts: [
            [14, -10],
            [22, -10],
            [22, 0],
            [14, 0],
          ],
          floors: 6,
        },
        {
          pts: [
            [14, 0],
            [22, 0],
            [22, 10],
            [14, 10],
          ],
          floors: 2,
        },
      ],
    };
    const road: ChunkFeature = {
      id: 'r900',
      featureType: 'road',
      highway: 'residential',
      points: [
        [-20, -15],
        [23, -15],
      ],
    };
    const built = buildBuildingChunk([courtyardPalace, steppedBlock, road], terrain, bounds);
    expect(built.levels[0]?.triangleCount).toBeGreaterThan(
      (built.levels[1]?.triangleCount ?? 0) * 2,
    );
    const portals = built.detailBatches?.find((b) => b.kind === 'portal_casco');
    expect(portals).toBeDefined();
    expect(portals?.positions[2]).toBeLessThan(-10);
  });

  it('classifies Mediterranean tree variants and street furniture props', () => {
    const props: ChunkFeature[] = [
      { id: 't1', featureType: 'prop', kind: 'tree', treeSpecies: 'pine', position: [-6, -4] },
      { id: 't2', featureType: 'prop', kind: 'tree', treeSpecies: 'palm', position: [2, -4] },
      { id: 't3', featureType: 'prop', kind: 'tree', treeSpecies: 'oak', position: [6, 3] },
      { id: 'b1', featureType: 'prop', kind: 'bus_stop', position: [-4, 4] },
      { id: 'b2', featureType: 'prop', kind: 'bench', position: [0, 5] },
      { id: 'f1', featureType: 'prop', kind: 'fountain', position: [8, 8] },
      { id: 'l1', featureType: 'prop', kind: 'street_lamp', position: [0, 0] },
    ];
    const roads = buildRoadChunk(props, terrain, bounds);
    const kinds = new Set(roads.props.map((p) => p.kind));
    expect(kinds.has('tree_pine')).toBe(true);
    expect(kinds.has('tree_palm')).toBe(true);
    expect(kinds.has('tree_oak')).toBe(true);
    expect(kinds.has('bus_shelter')).toBe(true);
    expect(kinds.has('bench')).toBe(true);
    expect(kinds.has('fountain')).toBe(true);
    expect(kinds.has('street_lamp')).toBe(true);
  });
});
