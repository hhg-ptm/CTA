import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { optionValue } from './cli-args.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_ROAD_NETWORK_BYTES = 64 * 1024 * 1024;
const regionName = optionValue(process.argv.slice(2), '--region', 'cc-monumental');
const directory = path.join(ROOT, 'public/world', regionName);
const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
const listedChunks = new Set(manifest.chunks.map((chunk) => chunk.path));
const staleChunks = (await readdir(directory)).filter(
  (fileName) => /^-?\d+_-?\d+\.bin$/.test(fileName) && !listedChunks.has(fileName),
);
if (staleChunks.length > 0)
  throw new Error(`World contains ${staleChunks.length} unreferenced chunk files.`);
const sourceGeometryMetadata = manifest.sourceGeometry;
if (
  !sourceGeometryMetadata ||
  sourceGeometryMetadata.path !== 'source-fidelity.json' ||
  sourceGeometryMetadata.bytes > 32 * 1024 * 1024
) {
  throw new Error('World manifest has missing or unsafe source geometry metadata.');
}
const sourceGeometryBytes = await readFile(path.join(directory, sourceGeometryMetadata.path));
if (
  sourceGeometryBytes.length !== sourceGeometryMetadata.bytes ||
  createHash('sha256').update(sourceGeometryBytes).digest('hex') !== sourceGeometryMetadata.sha256
) {
  throw new Error('Source geometry overlay size or SHA-256 does not match the manifest.');
}
const sourceGeometry = JSON.parse(sourceGeometryBytes.toString('utf8'));
if (
  sourceGeometry.region !== regionName ||
  sourceGeometry.roads.length !== sourceGeometryMetadata.roads ||
  sourceGeometry.buildings.length !== sourceGeometryMetadata.buildings
) {
  throw new Error('Source geometry overlay counts do not match the manifest.');
}
const blocklist = JSON.parse(await readFile(path.join(ROOT, 'tools/brand-blocklist.json'), 'utf8'));
const forbidden = blocklist.brands
  .flatMap((brand) => brand.aliases)
  .map((value) => value.toLocaleLowerCase('es'));
let totalFeatures = 0;
let totalMissingHeights = 0;
const buildingsById = new Map();

const allowRelationBuildings = manifest.buildingPipeline === 'blender-library';

for (const chunk of manifest.chunks) {
  if (!/^(-?\d+)_(-?\d+)\.bin$/.test(chunk.path) || chunk.bytes > 16 * 1024 * 1024)
    throw new Error(`Unsafe chunk metadata: ${chunk.id}`);
  const binary = await readFile(path.join(directory, chunk.path));
  if (binary.toString('ascii', 0, 4) !== 'CTA2' || binary.readUInt16LE(4) !== 1)
    throw new Error(`Invalid CTA2 header: ${chunk.path}`);
  if (createHash('sha256').update(binary).digest('hex') !== chunk.sha256)
    throw new Error(`SHA-256 mismatch: ${chunk.path}`);
  if (binary.readUInt32LE(8) > 16 * 1024 * 1024)
    throw new Error(`Uncompressed chunk exceeds safety limit: ${chunk.path}`);
  const payloadBytes = inflateSync(binary.subarray(12), { maxOutputLength: 16 * 1024 * 1024 });
  if (payloadBytes.length !== binary.readUInt32LE(8))
    throw new Error(`Uncompressed size mismatch: ${chunk.path}`);
  const payload = JSON.parse(payloadBytes.toString('utf8'));
  if (payload.id !== chunk.id || payload.features.length !== chunk.featureCount)
    throw new Error(`Chunk metadata mismatch: ${chunk.path}`);
  if (payload.terrain.heights.includes(-32768))
    throw new Error(`No-data terrain sample found: ${chunk.path}`);
  for (const feature of payload.features) {
    if (feature.featureType !== 'building') continue;
    const validBuildingId = allowRelationBuildings
      ? /^(w|r)\d+$/.test(feature.id ?? '')
      : /^w\d+$/.test(feature.id ?? '');
    if (!validBuildingId || !Array.isArray(feature.points) || feature.points.length < 4)
      throw new Error(`Building lacks a stable OSM id or closed footprint in ${chunk.path}.`);
    const sourceMargin = 200;
    if (
      feature.points.some(
        (point) =>
          !Array.isArray(point) ||
          point.length !== 2 ||
          point.some(
            (value) =>
              !Number.isFinite(value) || Math.abs(value) > manifest.extentMeters / 2 + sourceMargin,
          ),
      )
    ) {
      throw new Error(`Building ${feature.id} has an invalid projected footprint.`);
    }
    if (
      !['casco', 'ensanche', 'periferia'].includes(feature.zone) ||
      !Number.isFinite(feature.visualFloors) ||
      feature.visualFloors < 1 ||
      feature.visualFloors > 40 ||
      !Number.isFinite(feature.visualHeightMeters) ||
      feature.visualHeightMeters < 2.8 ||
      feature.visualHeightMeters > 80 ||
      !['flat', 'gabled', 'hipped', 'unknown', 'many'].includes(feature.roofShape)
    ) {
      throw new Error(`Building ${feature.id} has invalid visual height, zone, or roof metadata.`);
    }
    if (feature.landmarkModelPath && !/^landmarks\/w\d+\.glb$/.test(feature.landmarkModelPath))
      throw new Error(`Building ${feature.id} references an unsafe landmark model path.`);
    const prior = buildingsById.get(feature.id);
    if (
      prior &&
      (prior.zone !== feature.zone ||
        prior.visualHeightMeters !== feature.visualHeightMeters ||
        JSON.stringify(prior.points) !== JSON.stringify(feature.points))
    ) {
      throw new Error(`Building ${feature.id} changes identity or visual metadata across chunks.`);
    }
    buildingsById.set(feature.id, feature);
  }
  const commercialNames = payload.features
    .filter(
      (feature) =>
        feature.fictional === true ||
        (feature.featureType === 'building' && feature.commercial === true),
    )
    .map((feature) => String(feature.name ?? '').toLocaleLowerCase('es'));
  const leakedAlias = forbidden.find((alias) => {
    const pattern = new RegExp(
      `(^|[^a-záéíóúñü])${alias.toLocaleLowerCase('es').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-záéíóúñü]|$)`,
      'i',
    );
    return commercialNames.some((name) => pattern.test(name));
  });
  if (leakedAlias)
    throw new Error(`Blocklisted real business name leaked into ${chunk.path}: ${leakedAlias}.`);
  totalFeatures += payload.features.length;
  totalMissingHeights += chunk.missingTerrainSamples;
}

if (manifest.roadNetwork) {
  const metadata = manifest.roadNetwork;
  if (metadata.path !== 'road-network.json' || metadata.bytes > MAX_ROAD_NETWORK_BYTES)
    throw new Error('Unsafe road network metadata.');
  const networkBytes = await readFile(path.join(directory, metadata.path));
  if (networkBytes.byteLength !== metadata.bytes) throw new Error('Road network size mismatch.');
  if (createHash('sha256').update(networkBytes).digest('hex') !== metadata.sha256)
    throw new Error('Road network SHA-256 mismatch.');
  const network = JSON.parse(networkBytes.toString('utf8'));
  const nodeIds = new Set(network.nodes.map((node) => node.id));
  const segmentIds = new Set(network.segments.map((segment) => segment.id));
  if (
    network.nodes.length !== metadata.nodes ||
    network.segments.length !== metadata.segments ||
    network.connections.length !== metadata.connections
  ) {
    throw new Error('Road network manifest counts do not match its payload.');
  }
  if (
    network.segments.some(
      (segment) => !nodeIds.has(segment.fromNode) || !nodeIds.has(segment.toNode),
    )
  )
    throw new Error('Road network contains a segment with a missing endpoint.');
  if (
    network.connections.some(
      (connection) =>
        !nodeIds.has(connection.intersectionNode) ||
        !segmentIds.has(connection.fromSegment) ||
        !segmentIds.has(connection.toSegment),
    )
  ) {
    throw new Error('Road network contains a connection with a missing reference.');
  }
  if (manifest.walkRoute) {
    const routeMetadata = manifest.walkRoute;
    if (routeMetadata.path !== 'walk-route.json' || routeMetadata.bytes > 1024 * 1024)
      throw new Error('Unsafe walking route metadata.');
    const routeBytes = await readFile(path.join(directory, routeMetadata.path));
    if (routeBytes.byteLength !== routeMetadata.bytes)
      throw new Error('Walking route size mismatch.');
    if (createHash('sha256').update(routeBytes).digest('hex') !== routeMetadata.sha256)
      throw new Error('Walking route SHA-256 mismatch.');
    const route = JSON.parse(routeBytes.toString('utf8'));
    if (
      route.lengthMeters !== routeMetadata.lengthMeters ||
      route.segmentIds.length !== routeMetadata.segments ||
      route.mode !== 'pedestrian'
    ) {
      throw new Error('Walking route manifest metadata does not match its payload.');
    }
    if (
      route.nodeIds.some((id) => !nodeIds.has(id)) ||
      route.segmentIds.some((id) => !segmentIds.has(id))
    ) {
      throw new Error('Walking route contains a missing graph reference.');
    }
    if (
      route.points.length < 2 ||
      route.points.some(
        (point) =>
          point.length !== 2 ||
          point.some(
            (value) => !Number.isFinite(value) || Math.abs(value) > manifest.extentMeters / 2 + 1,
          ),
      )
    ) {
      throw new Error('Walking route contains an invalid geographic position.');
    }
    if (
      route.landmarks.length !== 3 ||
      route.landmarks.some(
        (landmark) => !nodeIds.has(landmark.nodeId) || landmark.snapDistanceMeters > 60,
      )
    ) {
      throw new Error('Walking route landmark snap is invalid.');
    }
  }
}

if (totalMissingHeights > 0)
  throw new Error(`World has ${totalMissingHeights} missing terrain samples.`);
if (manifest.counts?.buildingsInWorld !== buildingsById.size)
  throw new Error('Unique in-world building count does not match the world manifest.');
const buildingZoneCounts = Object.fromEntries(
  ['casco', 'ensanche', 'periferia'].map((zone) => [
    zone,
    [...buildingsById.values()].filter((building) => building.zone === zone).length,
  ]),
);
for (const zone of Object.keys(buildingZoneCounts)) {
  if (manifest.counts?.buildingsInWorldByZone?.[zone] !== buildingZoneCounts[zone])
    throw new Error(`Building count mismatch for zone ${zone}.`);
}
const portalsDataPath = path.join(ROOT, 'public/data/world/portals.json');
const busStopsDataPath = path.join(ROOT, 'public/data/world/bus-stops.json');

if (regionName === 'cc-monumental') {
  try {
    const portalsRaw = await readFile(portalsDataPath, 'utf8');
    const portalsDoc = JSON.parse(portalsRaw);
    if (
      portalsDoc.schemaVersion !== 1 ||
      !Array.isArray(portalsDoc.portals) ||
      portalsDoc.portals.length !== portalsDoc.count
    ) {
      throw new Error('Portals catalog metadata is malformed.');
    }
    for (const p of portalsDoc.portals) {
      if (
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        !Number.isFinite(p.z) ||
        Math.abs(p.x) > manifest.extentMeters / 2 + 50 ||
        Math.abs(p.z) > manifest.extentMeters / 2 + 50 ||
        p.y < 200 ||
        p.y > 900
      ) {
        throw new Error(`Portal ${p.id} has invalid coordinates or elevation.`);
      }
      if (/ES\.SDGC\.|[0-9]{7}[A-Z]{2}[0-9]{4}[A-Z]/i.test(`${p.id} ${p.street}`)) {
        throw new Error(`Portal ${p.id} leaked a raw cadastral identifier.`);
      }
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }

  try {
    const stopsRaw = await readFile(busStopsDataPath, 'utf8');
    const stopsDoc = JSON.parse(stopsRaw);
    if (
      stopsDoc.schemaVersion !== 1 ||
      !Array.isArray(stopsDoc.stops) ||
      stopsDoc.stops.length !== stopsDoc.count
    ) {
      throw new Error('Bus stops catalog metadata is malformed.');
    }
    for (const s of stopsDoc.stops) {
      if (
        !Number.isFinite(s.x) ||
        !Number.isFinite(s.y) ||
        !Number.isFinite(s.z) ||
        !Number.isFinite(s.heading) ||
        s.y < 200 ||
        s.y > 900
      ) {
        throw new Error(`Bus stop ${s.id} has invalid spatial coordinates.`);
      }
      const lowerName = String(s.name ?? '').toLocaleLowerCase('es');
      if (
        forbidden.some((alias) =>
          new RegExp(
            `(^|[^a-záéíóúñü])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-záéíóúñü]|$)`,
            'i',
          ).test(lowerName),
        )
      ) {
        throw new Error(`Blocklisted commercial name leaked into bus stop ${s.id}: ${s.name}`);
      }
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
}

console.info(
  `Verified ${manifest.chunks.length} chunks, ${totalFeatures} feature records, ${buildingsById.size} zoned buildings, road network, walking route and all hashes/terrain samples; no blocklisted names.`,
);
