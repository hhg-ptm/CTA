import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

interface DataManifest {
  crs: { code: string; chunkGrid: { totalChunks: number } };
  safetyPolicy: { productionWorldStatus: string };
  phase1CrossMatchMetrics: {
    osmBuildingsInWorld: number;
    heightProvenance: {
      osm_explicit: number;
      catastro_floors: number;
      realVerifiedTotal: number;
      heuristic_fallback: number;
    };
  };
  existingAssetsSummary: {
    cityKitGlbCount: number;
    cityKitModulesCount: number;
    cityKitBuildingModulesCount: number;
    cityKitRoadModulesCount: number;
  };
}

interface BuildingStylesSpec {
  baselineArchetypes: { archetype: string }[];
  cityKitAudit: {
    buildingModules: { id: string; trisLod0: number; trisLod1: number }[];
    roadAndVegetationModules: { id: string; trisLod0: number; trisLod1: number }[];
  };
}

describe('Phase 1 Cáceres reconstruction specs', () => {
  it('reconciles height provenance counts and preserves production world status', () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'caceres_data_manifest.json'), 'utf8'),
    ) as DataManifest;
    const { osmBuildingsInWorld, heightProvenance } = manifest.phase1CrossMatchMetrics;

    expect(manifest.crs.code).toBe('EPSG:25829');
    expect(manifest.crs.chunkGrid.totalChunks).toBe(900);
    expect(manifest.safetyPolicy.productionWorldStatus).toBe('preserved_untouched');
    expect(heightProvenance.osm_explicit + heightProvenance.catastro_floors).toBe(
      heightProvenance.realVerifiedTotal,
    );
    expect(heightProvenance.realVerifiedTotal + heightProvenance.heuristic_fallback).toBe(
      osmBuildingsInWorld,
    );
    expect(manifest.existingAssetsSummary.cityKitGlbCount).toBe(44);
  });

  it('audits all 12 building archetypes and all 22 CityKit modules', () => {
    const styles = JSON.parse(
      readFileSync(join(ROOT, 'caceres_building_styles.json'), 'utf8'),
    ) as BuildingStylesSpec;
    const kitManifest = JSON.parse(
      readFileSync(join(ROOT, 'public/models/citykit/manifest.json'), 'utf8'),
    ) as { models: Record<string, { triangles: number; bytes: number }> };

    expect(styles.baselineArchetypes).toHaveLength(12);
    const audited = [
      ...styles.cityKitAudit.buildingModules,
      ...styles.cityKitAudit.roadAndVegetationModules,
    ];
    expect(audited).toHaveLength(22);

    for (const item of audited) {
      const lod0 = kitManifest.models[`${item.id}-lod0`];
      const lod1 = kitManifest.models[`${item.id}-lod1`];
      expect(lod0).toBeDefined();
      expect(lod1).toBeDefined();
      expect(item.trisLod0).toBe(lod0?.triangles);
      expect(item.trisLod1).toBe(lod1?.triangles);
    }
  });
});
