import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverLandmarkModels } from '../tools/landmark-assets.mjs';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function glb(jsonValue: unknown): Buffer {
  const json = Buffer.from(
    JSON.stringify(jsonValue).padEnd(Math.ceil(JSON.stringify(jsonValue).length / 4) * 4, ' '),
  );
  const bytes = Buffer.alloc(20 + json.length);
  bytes.write('glTF', 0, 4, 'ascii');
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(json.length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  json.copy(bytes, 20);
  return bytes;
}

describe('landmark GLB discovery', () => {
  it('accepts a bounded embedded GLB whose name matches a stable OSM id', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cta-landmarks-'));
    directories.push(root);
    await mkdir(path.join(root, 'landmarks'));
    await writeFile(
      path.join(root, 'landmarks', 'w123.glb'),
      glb({
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [] }],
        nodes: [],
        buffers: [{ byteLength: 0 }],
      }),
    );
    expect([...(await discoverLandmarkModels(root))]).toEqual(['w123']);
  });

  it('rejects external resources referenced by GLB JSON', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cta-landmarks-'));
    directories.push(root);
    await mkdir(path.join(root, 'landmarks'));
    await writeFile(
      path.join(root, 'landmarks', 'w456.glb'),
      glb({
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [] }],
        nodes: [],
        buffers: [{ uri: '../payload.bin', byteLength: 0 }],
      }),
    );
    await expect(discoverLandmarkModels(root)).rejects.toThrow('External URIs are forbidden');
  });

  it('validates all committed custom Blender monument GLBs in public/landmarks', async () => {
    const discovered = await discoverLandmarkModels(path.resolve(process.cwd(), 'public'));
    expect(discovered.has('w22358108')).toBe(true);
    expect(discovered.has('w382363931')).toBe(true);
    expect(discovered.has('w385037723')).toBe(true);
    expect(discovered.has('w385037728')).toBe(true);
    expect(discovered.has('w467504814')).toBe(true);
  });
});
