import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface BuildingLibraryEntry {
  readonly key: string;
  readonly label: string;
  readonly lod0Tris: number;
  readonly lod1Tris: number;
  readonly lod0GlbBytes: number;
  readonly lod1GlbBytes: number;
  readonly materialsCount: number;
}

describe('System A: Blender artistic building library', () => {
  it('exports valid glTF 2.0 LOD0 and LOD1 binaries for all 4 hero archetypes', () => {
    const baseDir = resolve('public/models/buildings');
    const manifestPath = resolve(baseDir, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      readonly models: readonly BuildingLibraryEntry[];
    };
    expect(manifest.models.map((m) => m.key)).toEqual([
      '01_casco_house',
      '02_modern_residential',
      '03_chalet',
      '04_commercial',
    ]);

    for (const model of manifest.models) {
      expect(model.lod0Tris).toBeGreaterThan(model.lod1Tris * 3);
      expect(model.materialsCount).toBeGreaterThanOrEqual(10);

      for (const lod of [0, 1] as const) {
        const file = resolve(baseDir, `${model.key}-lod${lod}.glb`);
        expect(existsSync(file)).toBe(true);
        const bytes = readFileSync(file);
        expect(bytes.subarray(0, 4).toString('ascii')).toBe('glTF');
        const version = bytes.readUInt32LE(4);
        expect(version).toBe(2);
      }
    }
  });
});
