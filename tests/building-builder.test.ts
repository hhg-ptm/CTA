import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBuildingChunk, roofShapeFor } from '../src/world/building-builder';
import { classifyBuilding, effectiveRoofShape } from '../src/world/building-styles';
import { buildTerrainChunk } from '../src/world/mesh-builder';
import type { ChunkFeature, RawTerrainChunk } from '../src/world/types';

const bounds = { minX: -8, minZ: -8, maxX: 8, maxZ: 8 };
const terrain = buildTerrainChunk({
  id: '0_0',
  bounds,
  terrain: {
    samples: 5,
    stepMeters: 4,
    quantizationMeters: 0.25,
    heights: Array.from({ length: 25 }, () => 1600),
  },
  features: [],
} satisfies RawTerrainChunk);

const commercialBuilding: ChunkFeature = {
  id: 'w200',
  featureType: 'building',
  zone: 'casco',
  visualFloors: 3,
  visualHeightMeters: 9,
  roofHeightMeters: 1,
  roofShape: 'gabled',
  roofMaterial: 'tile',
  commercial: true,
  commercialCategory: 'shop:bakery',
  points: [
    [-2, -2],
    [2, -2],
    [2, 2],
    [-2, 2],
    [-2, -2],
  ],
};
const road: ChunkFeature = {
  id: 'w1',
  featureType: 'road',
  highway: 'residential',
  points: [
    [-8, -3],
    [8, -3],
  ],
};

describe('building geometry', () => {
  it('builds three progressively lighter merged LODs and stable chunk-local geometry', () => {
    const features = [commercialBuilding, road];
    const first = buildBuildingChunk(features, terrain, bounds);
    const second = buildBuildingChunk(features, terrain, bounds);
    expect(first.levels).toHaveLength(3);
    const detailed = first.levels[0]?.triangleCount ?? 0;
    expect(detailed).toBeGreaterThan(first.levels[1]?.triangleCount ?? 0);
    // The far LOD keeps the inferred roof shape and can exceed the flat-roofed
    // middle LOD by a couple of triangles; both stay far below full detail.
    expect(first.levels[1]?.triangleCount ?? 0).toBeLessThan(detailed / 2);
    expect(first.levels[2]?.triangleCount ?? 0).toBeLessThan(detailed / 2);
    expect(first.levels[0]?.surfaces.map((surface) => surface.material)).toEqual([
      'casco_facade',
      'tile_roof',
    ]);
    expect(Array.from(first.levels[0]?.surfaces[0]?.positions ?? [])).toEqual(
      Array.from(second.levels[0]?.surfaces[0]?.positions ?? []),
    );
    expect(first.colliderIndices.length).toBeGreaterThan(0);
    for (let index = 0; index < first.colliderPositions.length; index += 3) {
      expect(first.colliderPositions[index]).toBeGreaterThanOrEqual(-8.001);
      expect(first.colliderPositions[index]).toBeLessThanOrEqual(8.001);
      expect(first.colliderPositions[index + 2]).toBeGreaterThanOrEqual(-8.001);
      expect(first.colliderPositions[index + 2]).toBeLessThanOrEqual(8.001);
    }
  });

  it('reserves the closest street-facing sign slot and a historic roof anchor', () => {
    const built = buildBuildingChunk([commercialBuilding, road], terrain, bounds);
    expect(built.signSlots).toEqual([
      expect.objectContaining({ buildingId: 'w200', category: 'shop:bakery', width: 2.8 }),
    ]);
    expect(built.signSlots[0]?.position[2]).toBeCloseTo(-2);
    expect(built.roofAnchors).toEqual([
      expect.objectContaining({ buildingId: 'w200', roofShape: 'gabled' }),
    ]);
    expect(built.roofAnchors[0]?.position[1]).toBeCloseTo(409);
  });

  it('uses roof tags when known and a footprint heuristic otherwise', () => {
    expect(
      roofShapeFor({ featureType: 'building', roofShape: 'flat' }, [
        [0, 0],
        [4, 0],
        [4, 2],
        [0, 2],
      ]),
    ).toBe('flat');
    expect(
      roofShapeFor({ featureType: 'building', roofShape: 'unknown' }, [
        [0, 0],
        [8, 0],
        [8, 2],
        [0, 2],
      ]),
    ).toBe('gabled');
    expect(
      roofShapeFor({ featureType: 'building' }, [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ]),
    ).toBe('hipped');
  });

  it('keeps validated landmark replacements stable by their OSM id', () => {
    const feature = { ...commercialBuilding, landmarkModelPath: 'landmarks/w200.glb' };
    const built = buildBuildingChunk([feature, road], terrain, bounds);
    expect(built.landmarkModels).toEqual([
      { buildingId: 'w200', path: 'landmarks/w200.glb', position: [0, 400, 0] },
    ]);
    expect(built.levels[0]?.triangleCount).toBe(0);
  });

  it('assigns distinct architectural styles and Blender detail batches across building types', () => {
    const palaceStyle = classifyBuilding(
      {
        id: 'w467504813',
        featureType: 'building',
        zone: 'casco',
        historic: 'monument',
        buildingType: 'house',
        visualFloors: 3,
      },
      'hipped',
    );
    const chaletStyle = classifyBuilding(
      {
        id: 'w9001',
        featureType: 'building',
        zone: 'periferia',
        buildingType: 'terrace',
        roofMaterial: 'modern',
        visualFloors: 3,
      },
      'gabled',
    );
    const industrialStyle = classifyBuilding(
      {
        id: 'w9002',
        featureType: 'building',
        zone: 'periferia',
        buildingType: 'industrial',
        visualFloors: 2,
      },
      'flat',
    );
    expect(palaceStyle.archetype).toBe('casco_palace');
    expect(palaceStyle.portalKind).toBe('portal_casco');
    expect(chaletStyle.archetype).toBe('periferia_chalet');
    expect(chaletStyle.roofMaterial).toBe('tile_roof');
    expect(industrialStyle.archetype).toBe('periferia_industrial');
    expect(industrialStyle.roofMaterial).toBe('modern_roof');

    expect(
      effectiveRoofShape(
        {
          id: 'w9003',
          featureType: 'building',
          zone: 'ensanche',
          buildingType: 'apartments',
          visualFloors: 6,
        },
        'gabled',
      ),
    ).toBe('flat');

    const church: ChunkFeature = {
      id: 'w501',
      featureType: 'building',
      zone: 'casco',
      buildingType: 'chapel',
      visualFloors: 3,
      visualHeightMeters: 9,
      points: [
        [-7, -7],
        [7, -7],
        [7, 7],
        [-7, 7],
        [-7, -7],
      ],
    };
    const warehouse: ChunkFeature = {
      id: 'w502',
      featureType: 'building',
      zone: 'periferia',
      buildingType: 'industrial',
      roofShape: 'flat',
      visualFloors: 2,
      visualHeightMeters: 6,
      points: [
        [-6, -6],
        [6, -6],
        [6, 6],
        [-6, 6],
        [-6, -6],
      ],
    };
    const largeBounds = { minX: -20, minZ: -20, maxX: 20, maxZ: 20 };
    const largeTerrain = buildTerrainChunk({
      id: '0_0',
      bounds: largeBounds,
      terrain: {
        samples: 5,
        stepMeters: 10,
        quantizationMeters: 0.25,
        heights: Array.from({ length: 25 }, () => 1600),
      },
      features: [],
    } satisfies RawTerrainChunk);
    const churchBuilt = buildBuildingChunk([church, road], largeTerrain, largeBounds);
    const warehouseBuilt = buildBuildingChunk([warehouse, road], largeTerrain, largeBounds);
    expect(churchBuilt.detailBatches?.some((b) => b.kind === 'bell_gable')).toBe(true);
    expect(warehouseBuilt.detailBatches?.some((b) => b.kind === 'industrial_door')).toBe(true);
    expect(warehouseBuilt.detailBatches?.some((b) => b.kind === 'rooftop_hvac')).toBe(true);
  });

  it('skips hidden party-wall edges when two buildings abut directly', () => {
    const left: ChunkFeature = {
      id: 'w701',
      featureType: 'building',
      zone: 'casco',
      visualFloors: 3,
      visualHeightMeters: 9,
      points: [
        [-6, -4],
        [0, -4],
        [0, 4],
        [-6, 4],
        [-6, -4],
      ],
    };
    const right: ChunkFeature = {
      id: 'w702',
      featureType: 'building',
      zone: 'casco',
      visualFloors: 3,
      visualHeightMeters: 9,
      points: [
        [0.05, -4],
        [6, -4],
        [6, 4],
        [0.05, 4],
        [0.05, -4],
      ],
    };
    const wideBounds = { minX: -16, minZ: -16, maxX: 16, maxZ: 16 };
    const wideTerrain = buildTerrainChunk({
      id: '0_0',
      bounds: wideBounds,
      terrain: {
        samples: 5,
        stepMeters: 8,
        quantizationMeters: 0.25,
        heights: Array.from({ length: 25 }, () => 1600),
      },
      features: [],
    } satisfies RawTerrainChunk);
    const solo = buildBuildingChunk([left], wideTerrain, wideBounds);
    const paired = buildBuildingChunk([left, right], wideTerrain, wideBounds);
    const countWallDetails = (built: ReturnType<typeof buildBuildingChunk>) =>
      (built.detailBatches ?? [])
        .filter(
          (b) => b.kind === 'window_casco' || b.kind === 'balcony' || b.kind === 'portal_casco',
        )
        .reduce((sum, b) => sum + b.headings.length, 0);
    // Two abutting houses share a party wall at x ≈ 0, so combined wall details must stay
    // well below double a single isolated house's 4 exposed facades.
    expect(countWallDetails(paired)).toBeLessThan(countWallDetails(solo) * 2);
  });

  it('keeps the city kit manifest aligned with all exported GLB files', () => {
    const manifestPath = resolve('public/models/citykit/manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      models: Record<string, { path: string; triangles: number; bytes: number }>;
    };
    const entries = Object.entries(manifest.models);
    expect(entries.length).toBeGreaterThanOrEqual(44);
    for (const [, entry] of entries) {
      expect(entry.triangles).toBeGreaterThan(0);
      expect(entry.bytes).toBeGreaterThan(0);
      expect(existsSync(resolve('public', entry.path))).toBe(true);
    }
  });
});
