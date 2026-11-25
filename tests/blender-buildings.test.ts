import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BLENDER_MODEL_SPECS,
  buildBlenderGeoPlacements,
  selectBlenderArchetype,
} from '../src/world/blender-geo-adapter';
import { buildBuildingChunk } from '../src/world/building-builder';
import { buildTerrainChunk } from '../src/world/mesh-builder';
import type { ChunkFeature, RawTerrainChunk } from '../src/world/types';

interface BuildingLibraryEntry {
  readonly key: string;
  readonly label: string;
  readonly category: string;
  readonly floors: number;
  readonly nominalWidthMeters: number;
  readonly nominalDepthMeters: number;
  readonly nominalHeightMeters: number;
  readonly lod0Tris: number;
  readonly lod1Tris: number;
  readonly lod2Tris: number;
  readonly lod0GlbBytes: number;
  readonly lod1GlbBytes: number;
  readonly lod2GlbBytes: number;
  readonly materialsCount: number;
  readonly lod1MaterialsCount: number;
  readonly lod2MaterialsCount: number;
}

const ALL_8_KEYS = [
  '01_casco_house',
  '02_modern_residential',
  '03_chalet',
  '04_commercial',
  '05_extremadura_traditional',
  '06_casco_palace',
  '07_midrise_residential',
  '08_civic_equipment',
] as const;

describe('System A: 8-Building Blender Artistic Library & 2-Material UV Atlas', () => {
  it('exports valid glTF 2.0 LOD0/LOD1 binaries for all 8 heroes with <= 2 shared atlas materials', () => {
    const baseDir = resolve('public/models/buildings');
    const manifestPath = resolve(baseDir, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(resolve(baseDir, 'caceres_buildings_atlas.png'))).toBe(true);
    expect(existsSync(resolve(baseDir, 'caceres_buildings_mr.png'))).toBe(true);
    expect(existsSync(resolve(baseDir, 'caceres_buildings_emissive.png'))).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      readonly schemaVersion: number;
      readonly models: readonly BuildingLibraryEntry[];
    };
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.models.map((m) => m.key)).toEqual([...ALL_8_KEYS]);

    for (const model of manifest.models) {
      expect(model.lod0Tris).toBeGreaterThan(model.lod1Tris);
      expect(model.lod1Tris).toBeGreaterThan(model.lod2Tris * 3);
      expect(model.lod2Tris).toBeLessThanOrEqual(400);
      expect(model.materialsCount).toBeLessThanOrEqual(2);
      expect(model.lod1MaterialsCount).toBeLessThanOrEqual(2);
      expect(model.lod2MaterialsCount).toBeLessThanOrEqual(2);
      expect(model.nominalWidthMeters).toBeGreaterThan(8);
      expect(model.nominalDepthMeters).toBeGreaterThan(7);
      expect(model.nominalHeightMeters).toBeGreaterThan(6);

      const codeSpec = BLENDER_MODEL_SPECS[model.key as keyof typeof BLENDER_MODEL_SPECS];
      expect(codeSpec).toBeDefined();
      expect(codeSpec.nominalWidthMeters).toBeCloseTo(model.nominalWidthMeters, 2);
      expect(codeSpec.nominalDepthMeters).toBeCloseTo(model.nominalDepthMeters, 2);
      expect(codeSpec.nominalHeightMeters).toBeCloseTo(model.nominalHeightMeters, 2);

      for (const lod of [0, 1, 2] as const) {
        const file = resolve(baseDir, `${model.key}-lod${lod}.glb`);
        expect(existsSync(file)).toBe(true);
        const bytes = readFileSync(file);
        expect(bytes.subarray(0, 4).toString('ascii')).toBe('glTF');
        expect(bytes.readUInt32LE(4)).toBe(2);

        const jsonLen = bytes.readUInt32LE(12);
        const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8')) as {
          materials?: unknown[];
        };
        expect((gltf.materials ?? []).length).toBeLessThanOrEqual(2);
        expect((gltf.materials ?? []).length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('System B: Geographic adaptation onto Catastro & OSM footprints', () => {
  const bounds = { minX: -64, minZ: -64, maxX: 64, maxZ: 64 };
  const terrain = buildTerrainChunk({
    id: '0_0',
    bounds,
    terrain: {
      samples: 5,
      stepMeters: 32,
      quantizationMeters: 0.25,
      heights: Array.from({ length: 25 }, () => 1600),
    },
    features: [],
  } satisfies RawTerrainChunk);

  it('classifies historic, palace, rural, civic, residential, commercial, and chalet buildings deterministically', () => {
    expect(
      selectBlenderArchetype(
        { id: 'a1', featureType: 'building', zone: 'casco', historic: 'palace', visualFloors: 3 },
        260,
        3,
        12,
      ),
    ).toBe('06_casco_palace');
    expect(
      selectBlenderArchetype(
        {
          id: 'a2',
          featureType: 'building',
          zone: 'ensanche',
          catastroUse: '4_2_cultural',
          visualFloors: 2,
        },
        380,
        2,
        10,
      ),
    ).toBe('08_civic_equipment');
    expect(
      selectBlenderArchetype(
        { id: 'a3', featureType: 'building', zone: 'ensanche', commercial: true, visualFloors: 2 },
        140,
        2,
        8,
      ),
    ).toBe('04_commercial');
    expect(
      selectBlenderArchetype(
        {
          id: 'a4',
          featureType: 'building',
          zone: 'ensanche',
          buildingType: 'apartments',
          visualFloors: 4,
        },
        220,
        4,
        13.5,
      ),
    ).toBe('07_midrise_residential');
    expect(
      selectBlenderArchetype(
        {
          id: 'a5',
          featureType: 'building',
          zone: 'ensanche',
          buildingType: 'apartments',
          visualFloors: 6,
        },
        220,
        6,
        20.5,
      ),
    ).toBe('02_modern_residential');
  });

  it('tiles elongated lots without disproportionate stretch and decomposes courtyard rings cleanly', () => {
    const features: ChunkFeature[] = [
      {
        id: 'w_long_block',
        featureType: 'building',
        zone: 'ensanche',
        buildingType: 'apartments',
        visualFloors: 4,
        visualHeightMeters: 14.0,
        points: [
          [-26, -20],
          [16, -20],
          [16, -10],
          [-26, -10],
          [-26, -20],
        ],
      },
      {
        id: 'w_palace_patio',
        featureType: 'building',
        zone: 'casco',
        historic: 'palace',
        visualFloors: 3,
        visualHeightMeters: 13.0,
        points: [
          [-16, 4],
          [16, 4],
          [16, 36],
          [-16, 36],
          [-16, 4],
        ],
        innerRings: [
          [
            [-6, 14],
            [6, 14],
            [6, 26],
            [-6, 26],
          ],
        ],
        portalPoints: [[0, 4]],
      },
      {
        id: 'street_main',
        featureType: 'road',
        points: [
          [-40, -6],
          [40, -6],
        ],
      },
    ];

    const geo = buildBlenderGeoPlacements(features, terrain, bounds);
    expect(geo.placements.length).toBeGreaterThanOrEqual(5);

    const longBlockPlacements = geo.placements.filter((p) =>
      p.buildingId.startsWith('w_long_block'),
    );
    expect(longBlockPlacements.length).toBeGreaterThanOrEqual(3);
    for (const p of longBlockPlacements) {
      expect(p.scaleX).toBeGreaterThanOrEqual(0.7);
      expect(p.scaleX).toBeLessThanOrEqual(1.3);
      expect(Math.max(p.scaleX / p.scaleZ, p.scaleZ / p.scaleX)).toBeLessThanOrEqual(1.3);
    }

    // Patio hole around (0, 20) must remain clear of center module placement
    const patioPlacements = geo.placements.filter((p) => p.buildingId.startsWith('w_palace_patio'));
    expect(patioPlacements.length).toBeGreaterThanOrEqual(4);
    for (const p of patioPlacements) {
      const distFromCourtyardCenter = Math.hypot(p.x - 0, p.z - 20);
      expect(distFromCourtyardCenter).toBeGreaterThan(5.0);
    }

    // Building chunk preserves full colliders & footprints while suppressing flat procedural walls
    const built = buildBuildingChunk(features, terrain, bounds, '1200k', 'blender-library');
    expect(built.blenderPlacements?.length).toBeGreaterThanOrEqual(5);
    expect(built.colliderPositions.length).toBeGreaterThan(0);
    expect(built.footprints).toHaveLength(2);
    expect(built.levels[0]?.triangleCount ?? 0).toBe(0);
  });
});
