import { buildTerrainChunk } from './mesh-builder';
import { buildRoadChunk } from './road-builder';
import { buildBuildingChunk } from './building-builder';
import type { BuiltTerrainChunk, RawTerrainChunk } from './types';

interface BuildRequest {
  readonly id: string;
  readonly buffer: ArrayBuffer;
}

interface BuildResponse {
  readonly id: string;
  readonly result?: BuiltTerrainChunk;
  readonly error?: string;
}

const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<BuildRequest>) => void) | null;
  postMessage(message: BuildResponse, transfer: Transferable[]): void;
};

async function decodeChunk(request: BuildRequest): Promise<BuiltTerrainChunk> {
  const bytes = new Uint8Array(request.buffer);
  if (bytes.byteLength < 12 || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'CTA2')
    throw new Error(`Unknown chunk format: ${request.id}`);
  const view = new DataView(request.buffer);
  if (view.getUint16(4, true) !== 1) throw new Error(`Unsupported chunk version: ${request.id}`);
  const payloadLength = view.getUint32(8, true);
  if (payloadLength > MAX_PAYLOAD_BYTES)
    throw new Error(`Chunk ${request.id} exceeds the uncompressed size limit.`);
  const compressed = new Blob([bytes.subarray(12)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'));
  const payload = await new Response(compressed).arrayBuffer();
  if (payload.byteLength !== payloadLength)
    throw new Error(`Chunk ${request.id} payload size does not match its header.`);
  const raw = JSON.parse(new TextDecoder().decode(payload)) as RawTerrainChunk;
  if (raw.id !== request.id) throw new Error(`Chunk identity mismatch: ${request.id}`);
  const terrain = buildTerrainChunk(raw);
  return {
    ...terrain,
    roads: buildRoadChunk(raw.features, terrain, raw.bounds),
    buildings: buildBuildingChunk(raw.features, terrain, raw.bounds),
  };
}

function transferables(result: BuiltTerrainChunk): Transferable[] {
  const terrainBuffers: Transferable[] = [
    result.heights.buffer,
    ...result.levels.flatMap((level) => [
      level.positions.buffer,
      level.normals.buffer,
      level.colors.buffer,
      level.indices.buffer,
    ]),
  ];
  const roads = result.roads;
  const buildings = result.buildings;
  const buildingBuffers: Transferable[] = buildings
    ? [
        ...buildings.levels.flatMap((level) =>
          level.surfaces.flatMap((surface) => [
            surface.positions.buffer,
            surface.normals.buffer,
            surface.colors.buffer,
            surface.uvs.buffer,
            surface.indices.buffer,
          ]),
        ),
        ...(buildings.detailBatches ?? []).flatMap((batch) => [
          batch.positions.buffer,
          batch.headings.buffer,
          batch.scales.buffer,
        ]),
        buildings.colliderPositions.buffer,
        buildings.colliderIndices.buffer,
      ]
    : [];
  if (!roads) return [...terrainBuffers, ...buildingBuffers];
  const roadBuffers: Transferable[] = [
    ...roads.surfaces.flatMap((surface) => [
      surface.positions.buffer,
      surface.normals.buffer,
      surface.colors.buffer,
      surface.uvs.buffer,
      surface.indices.buffer,
    ]),
    roads.markings.positions.buffer,
    roads.markings.normals.buffer,
    roads.markings.colors.buffer,
    roads.markings.uvs.buffer,
    roads.markings.indices.buffer,
    roads.colliderPositions.buffer,
    roads.colliderIndices.buffer,
    ...roads.props.flatMap((prop) => [prop.positions.buffer, prop.headings.buffer]),
  ];
  return [...terrainBuffers, ...roadBuffers, ...buildingBuffers];
}

scope.onmessage = (event): void => {
  const request = event.data;
  void decodeChunk(request)
    .then((result) => {
      scope.postMessage({ id: request.id, result }, transferables(result));
    })
    .catch((error: unknown) => {
      scope.postMessage(
        { id: request.id, error: error instanceof Error ? error.message : String(error) },
        [],
      );
    });
};
