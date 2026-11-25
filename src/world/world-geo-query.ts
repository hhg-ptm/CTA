import type {
  BusStopRecord,
  BusStopsCatalog,
  GeoEnvironmentBridge,
  GeoNearestOptions,
  GeoSpatialMatch,
  LandmarkCatalogRecord,
  LandmarksCatalog,
  PortalQueryFilter,
  PortalRecord,
  PortalsCatalog,
  VehicleRouteStopAnchor,
  WorldGeoQuery,
} from './geo-contracts';
import type { WorldManifest } from './types';

const PORTAL_GRID_METERS = 64;
const SECONDARY_GRID_METERS = 128;

function cellKey(gx: number, gz: number): number {
  return (gx + 1_048_576) * 2_097_152 + (gz + 1_048_576);
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-ES')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesPortalFilter(portal: PortalRecord, filter?: PortalQueryFilter): boolean {
  if (!filter) return true;
  if (filter.kind && portal.kind !== filter.kind) return false;
  if (filter.use && portal.use !== filter.use) return false;
  if (filter.zone && portal.zone !== filter.zone) return false;
  if (filter.district && portal.district !== filter.district) return false;
  return true;
}

class SpatialPointGrid<T> {
  private readonly cellMeters: number;
  private readonly buckets = new Map<number, T[]>();
  private readonly getX: (item: T) => number;
  private readonly getZ: (item: T) => number;

  constructor(
    items: readonly T[],
    cellMeters: number,
    getX: (item: T) => number,
    getZ: (item: T) => number,
  ) {
    this.cellMeters = cellMeters;
    this.getX = getX;
    this.getZ = getZ;
    for (const item of items) {
      const gx = Math.floor(getX(item) / cellMeters);
      const gz = Math.floor(getZ(item) / cellMeters);
      const key = cellKey(gx, gz);
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = [];
        this.buckets.set(key, bucket);
      }
      bucket.push(item);
    }
  }

  queryRadius(
    x: number,
    z: number,
    radiusMeters: number,
    predicate?: (item: T) => boolean,
  ): GeoSpatialMatch<T>[] {
    if (radiusMeters < 0) return [];
    const r2 = radiusMeters * radiusMeters;
    const minGx = Math.floor((x - radiusMeters) / this.cellMeters);
    const maxGx = Math.floor((x + radiusMeters) / this.cellMeters);
    const minGz = Math.floor((z - radiusMeters) / this.cellMeters);
    const maxGz = Math.floor((z + radiusMeters) / this.cellMeters);
    const results: GeoSpatialMatch<T>[] = [];
    for (let gz = minGz; gz <= maxGz; gz += 1) {
      for (let gx = minGx; gx <= maxGx; gx += 1) {
        const bucket = this.buckets.get(cellKey(gx, gz));
        if (!bucket) continue;
        for (const item of bucket) {
          if (predicate && !predicate(item)) continue;
          const dx = this.getX(item) - x;
          const dz = this.getZ(item) - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2) {
            results.push({ item, distanceMeters: Math.sqrt(d2) });
          }
        }
      }
    }
    results.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return results;
  }

  findNearest(
    x: number,
    z: number,
    maxDistanceMeters: number,
    predicate?: (item: T) => boolean,
  ): GeoSpatialMatch<T> | null {
    const gx0 = Math.floor(x / this.cellMeters);
    const gz0 = Math.floor(z / this.cellMeters);
    const maxRings = Math.max(0, Math.ceil(maxDistanceMeters / this.cellMeters) + 1);
    let bestItem: T | undefined;
    let bestD2 = maxDistanceMeters * maxDistanceMeters;

    for (let ring = 0; ring <= maxRings; ring += 1) {
      // Stop expanding rings once the minimum possible distance to this ring exceeds bestD2.
      if (ring > 1) {
        const minRingMeters = (ring - 1) * this.cellMeters;
        if (minRingMeters * minRingMeters > bestD2) break;
      }
      for (let dz = -ring; dz <= ring; dz += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const bucket = this.buckets.get(cellKey(gx0 + dx, gz0 + dz));
          if (!bucket) continue;
          for (const item of bucket) {
            if (predicate && !predicate(item)) continue;
            const ddx = this.getX(item) - x;
            const ddz = this.getZ(item) - z;
            const d2 = ddx * ddx + ddz * ddz;
            if (d2 <= bestD2) {
              bestD2 = d2;
              bestItem = item;
            }
          }
        }
      }
    }
    return bestItem !== undefined ? { item: bestItem, distanceMeters: Math.sqrt(bestD2) } : null;
  }
}

export class IndexedWorldGeoQuery implements WorldGeoQuery {
  readonly portalCount: number;
  readonly busStopCount: number;
  readonly landmarkCount: number;

  private readonly portals: readonly PortalRecord[];
  private readonly portalsById = new Map<string, PortalRecord>();
  private readonly portalsByBuilding = new Map<string, PortalRecord[]>();
  private readonly portalsByChunk = new Map<string, PortalRecord[]>();
  private readonly portalSearchIndex: readonly {
    readonly portal: PortalRecord;
    readonly key: string;
  }[];
  private readonly portalGrid: SpatialPointGrid<PortalRecord>;

  private readonly busStops: readonly BusStopRecord[];
  private readonly busStopsById = new Map<string, BusStopRecord>();
  private readonly busStopGrid: SpatialPointGrid<BusStopRecord>;

  private readonly landmarks: readonly LandmarkCatalogRecord[];
  private readonly landmarksById = new Map<string, LandmarkCatalogRecord>();
  private readonly landmarkGrid: SpatialPointGrid<LandmarkCatalogRecord>;

  constructor(
    portalsCatalog: PortalsCatalog,
    busStopsCatalog: BusStopsCatalog,
    landmarksCatalog: LandmarksCatalog,
  ) {
    this.portals = portalsCatalog.portals;
    this.portalCount = this.portals.length;
    const searchRows: { readonly portal: PortalRecord; readonly key: string }[] = [];

    for (const portal of this.portals) {
      this.portalsById.set(portal.id, portal);
      if (portal.buildingId) {
        let list = this.portalsByBuilding.get(portal.buildingId);
        if (!list) {
          list = [];
          this.portalsByBuilding.set(portal.buildingId, list);
        }
        list.push(portal);
      }
      let chunkList = this.portalsByChunk.get(portal.chunkId);
      if (!chunkList) {
        chunkList = [];
        this.portalsByChunk.set(portal.chunkId, chunkList);
      }
      chunkList.push(portal);
      searchRows.push({
        portal,
        key: normalizeSearchText(`${portal.street} ${portal.number} ${portal.district}`),
      });
    }
    this.portalSearchIndex = searchRows;
    this.portalGrid = new SpatialPointGrid(
      this.portals,
      PORTAL_GRID_METERS,
      (p) => p.x,
      (p) => p.z,
    );

    this.busStops = busStopsCatalog.stops;
    this.busStopCount = this.busStops.length;
    for (const stop of this.busStops) {
      this.busStopsById.set(stop.id, stop);
    }
    this.busStopGrid = new SpatialPointGrid(
      this.busStops,
      SECONDARY_GRID_METERS,
      (s) => s.x,
      (s) => s.z,
    );

    this.landmarks = landmarksCatalog.landmarks.filter((item) => item.position?.localMeters);
    this.landmarkCount = landmarksCatalog.landmarks.length;
    for (const landmark of landmarksCatalog.landmarks) {
      this.landmarksById.set(landmark.id, landmark);
    }
    this.landmarkGrid = new SpatialPointGrid(
      this.landmarks,
      SECONDARY_GRID_METERS,
      (l) => l.position?.localMeters[0] ?? 0,
      (l) => l.position?.localMeters[1] ?? 0,
    );
  }

  getPortalById(id: string): PortalRecord | undefined {
    return this.portalsById.get(id);
  }

  getPortalsForBuilding(buildingId: string): readonly PortalRecord[] {
    return this.portalsByBuilding.get(buildingId) ?? [];
  }

  getPortalsInChunk(chunkId: string): readonly PortalRecord[] {
    return this.portalsByChunk.get(chunkId) ?? [];
  }

  findNearestPortal(
    x: number,
    z: number,
    options?: GeoNearestOptions,
  ): GeoSpatialMatch<PortalRecord> | null {
    const maxDist = options?.maxDistanceMeters ?? 250;
    const hasFilter = Boolean(options?.kind || options?.use || options?.zone || options?.district);
    return this.portalGrid.findNearest(
      x,
      z,
      maxDist,
      hasFilter ? (p) => matchesPortalFilter(p, options) : undefined,
    );
  }

  queryPortalsInRadius(
    x: number,
    z: number,
    radiusMeters: number,
    filter?: PortalQueryFilter,
  ): readonly GeoSpatialMatch<PortalRecord>[] {
    const hasFilter = Boolean(filter?.kind || filter?.use || filter?.zone || filter?.district);
    return this.portalGrid.queryRadius(
      x,
      z,
      radiusMeters,
      hasFilter ? (p) => matchesPortalFilter(p, filter) : undefined,
    );
  }

  searchPortals(
    queryText: string,
    limit = 20,
    filter?: PortalQueryFilter,
  ): readonly PortalRecord[] {
    const normalized = normalizeSearchText(queryText);
    if (!normalized || limit <= 0) return [];
    const tokens = normalized.split(' ').filter(Boolean);
    const matches: PortalRecord[] = [];
    for (const entry of this.portalSearchIndex) {
      if (!matchesPortalFilter(entry.portal, filter)) continue;
      if (tokens.every((token) => entry.key.includes(token))) {
        matches.push(entry.portal);
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }

  getBusStopById(id: string): BusStopRecord | undefined {
    return this.busStopsById.get(id);
  }

  getAllBusStops(): readonly BusStopRecord[] {
    return this.busStops;
  }

  findNearestBusStop(
    x: number,
    z: number,
    maxDistanceMeters = 500,
  ): GeoSpatialMatch<BusStopRecord> | null {
    return this.busStopGrid.findNearest(x, z, maxDistanceMeters);
  }

  queryBusStopsInRadius(
    x: number,
    z: number,
    radiusMeters: number,
  ): readonly GeoSpatialMatch<BusStopRecord>[] {
    return this.busStopGrid.queryRadius(x, z, radiusMeters);
  }

  toVehicleStopAnchor(stop: BusStopRecord, toleranceMeters = 5.5): VehicleRouteStopAnchor {
    const px = stop.roadPoint ? stop.roadPoint[0] : stop.x;
    const pz = stop.roadPoint ? stop.roadPoint[1] : stop.z;
    return {
      stopId: stop.id,
      name: stop.name,
      ref: stop.ref,
      roadNodeId: stop.roadNodeId,
      roadSegmentId: stop.roadSegmentId,
      stopPosition: [px, stop.y, pz],
      heading: stop.heading,
      stopRadiusMeters: toleranceMeters,
    };
  }

  getLandmarkById(id: string): LandmarkCatalogRecord | undefined {
    return this.landmarksById.get(id);
  }

  getAllLandmarks(): readonly LandmarkCatalogRecord[] {
    return this.landmarks;
  }

  findNearestLandmark(
    x: number,
    z: number,
    maxDistanceMeters = 1000,
  ): GeoSpatialMatch<LandmarkCatalogRecord> | null {
    return this.landmarkGrid.findNearest(x, z, maxDistanceMeters);
  }

  queryLandmarksInRadius(
    x: number,
    z: number,
    radiusMeters: number,
  ): readonly GeoSpatialMatch<LandmarkCatalogRecord>[] {
    return this.landmarkGrid.queryRadius(x, z, radiusMeters);
  }
}

export interface LoadWorldGeoQueryOptions {
  readonly fetcher?: typeof fetch;
  readonly portalsPath?: string;
  readonly busStopsPath?: string;
  readonly landmarksPath?: string;
}

async function fetchCatalog<T>(url: string, fetcher: typeof fetch, label: string): Promise<T> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Could not load ${label} catalog (${response.status}) at ${url}.`);
  }
  return (await response.json()) as T;
}

/**
 * Loads `portals.json`, `bus-stops.json`, and `landmarks.json` relative to `baseUrl`
 * (compatible with Vite subpath deployments such as GitHub Pages `./`) and builds
 * spatial indexes for O(1) cell lookups.
 */
export async function loadWorldGeoQuery(
  baseUrl: string | URL,
  options?: LoadWorldGeoQueryOptions,
): Promise<IndexedWorldGeoQuery> {
  const fetcher = options?.fetcher ?? fetch;
  const resolvedBase = baseUrl instanceof URL ? baseUrl : new URL(baseUrl, 'http://localhost/');
  const portalsUrl = new URL(options?.portalsPath ?? 'data/world/portals.json', resolvedBase).href;
  const busStopsUrl = new URL(options?.busStopsPath ?? 'data/world/bus-stops.json', resolvedBase)
    .href;
  const landmarksUrl = new URL(
    options?.landmarksPath ?? 'data/landmarks/landmarks.json',
    resolvedBase,
  ).href;

  const [portals, busStops, landmarks] = await Promise.all([
    fetchCatalog<PortalsCatalog>(portalsUrl, fetcher, 'portals'),
    fetchCatalog<BusStopsCatalog>(busStopsUrl, fetcher, 'bus-stops'),
    fetchCatalog<LandmarksCatalog>(landmarksUrl, fetcher, 'landmarks'),
  ]);
  return new IndexedWorldGeoQuery(portals, busStops, landmarks);
}

/**
 * Creates a lightweight read-only `GeoEnvironmentBridge` from minimal terrain and
 * collision callbacks without exposing `ChunkManager` or `Rapier` internals.
 */
export function createGeoEnvironmentBridge(params: {
  readonly geo: WorldGeoQuery;
  readonly worldRegion: WorldManifest['region'];
  readonly groundHeightAt: (x: number, z: number) => number | undefined;
  readonly collidesWithBuilding: (x: number, z: number, radius?: number) => boolean;
}): GeoEnvironmentBridge {
  return {
    geo: params.geo,
    worldRegion: params.worldRegion,
    sampleGroundHeight: params.groundHeightAt,
    isFootprintFree: (x, z, radius = 0.5) => !params.collidesWithBuilding(x, z, radius),
  };
}
