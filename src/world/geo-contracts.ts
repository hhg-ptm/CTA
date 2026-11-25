import type { DistrictKind, WorldManifest } from './types';

/** Two-dimensional projected coordinates `[x, z]` in EPSG:25829 meters relative to Plaza Mayor. */
export type GeoPoint2D = readonly [number, number];

/** Three-dimensional world coordinates `[x, y, z]` (`+X` East, `+Y` elevation, `+Z` North). */
export type GeoPoint3D = readonly [number, number, number];

/** Coarse city zone tag matching `ChunkFeature.zone`. */
export type CityZoneKind = 'casco' | 'ensanche' | 'periferia';

/** Source classification for a Catastro portal point (`entrance` is preferred over parcel centroid). */
export type PortalKind = 'entrance' | 'parcel';

/** Privacy-safe land-use bucket assigned to a portal. */
export type PortalUsageKind = 'residential' | 'commercial' | 'civic' | 'industrial' | 'mixed';

/** Source attribution for bus stop display labels. */
export type BusStopNameSource = 'osm' | 'road_inferred';

/**
 * Real street address entrance derived from Spanish Catastro INSPIRE (`AD.10900`),
 * OSM footprints, road network and IGN MDT05 terrain.
 *
 * Raw cadastral references (`rc1`/`rc2`/`localId`) are never stored.
 */
export interface PortalRecord {
  /** Deterministic anonymized identifier (`p_<hash>`). */
  readonly id: string;
  /** Human-readable expanded street name in Spanish (for HUD/missions). */
  readonly street: string;
  /** Official street door number/designator (e.g. `"12"`, `"5A"`). */
  readonly number: string;
  /** Five-digit Spanish postal code. */
  readonly postalCode: string;
  /** Whether the coordinate sits on the facade entrance (`entrance`) or parcel interior (`parcel`). */
  readonly kind: PortalKind;
  readonly x: number;
  /** Bilinear MDT05 ground elevation in meters at `(x, z)`. */
  readonly y: number;
  readonly z: number;
  /** Facing angle in radians (`atan2(dx, dz)`, Three.js `+Z` forward) toward nearest street segment. */
  readonly heading: number;
  /** Owning 256 m chunk identifier (`"<cx>_<cz>"`). */
  readonly chunkId: string;
  readonly zone: CityZoneKind;
  readonly district: DistrictKind;
  readonly use: PortalUsageKind;
  /** Nearest OSM building id (`w...` or `r...`) when matched within 14 m, else `null`. */
  readonly buildingId: string | null;
  /** Nearest road-network node id (`RoadNetworkNode.id`) for navigation/drop-off routing. */
  readonly roadNodeId: string | null;
  /** Nearest projected street point `[x, z]` in front of the portal. */
  readonly roadPoint: GeoPoint2D | null;
}

/** Public JSON catalog served from `public/data/world/portals.json`. */
export interface PortalsCatalog {
  readonly schemaVersion: 1;
  readonly crs: 'EPSG:25829';
  readonly source: string;
  readonly rawInBoundsCount: number;
  readonly dedupedParcelCount: number;
  readonly count: number;
  readonly portals: readonly PortalRecord[];
}

/** Real bus stop entry extracted from OSM and projected onto the vehicular road graph + MDT05 terrain. */
export interface BusStopRecord {
  /** Stable OSM node/way identifier (`n...` or `w...`). */
  readonly id: string;
  /** Public stop name sanitized against `brand-blocklist.json`. */
  readonly name: string;
  readonly nameSource: BusStopNameSource;
  /** Official stop post code (`ref` tag in OSM) when mapped, else `null`. */
  readonly ref: string | null;
  /** Explicit OSM `route_ref` identifiers when present (`[]` if unmapped). */
  readonly lineRefs: readonly string[];
  readonly hasShelter: boolean;
  readonly hasBench: boolean;
  readonly hasBin: boolean;
  readonly tactilePaving: boolean;
  readonly x: number;
  /** MDT05 ground elevation in meters at shelter/pole `(x, z)`. */
  readonly y: number;
  readonly z: number;
  readonly chunkId: string;
  readonly zone: CityZoneKind;
  /** Nearest drivable (`!walkable`) node id in `road-network.json`. */
  readonly roadNodeId: string | null;
  /** Nearest drivable segment id in `road-network.json`. */
  readonly roadSegmentId: string | null;
  /** Point on the drivable carriageway `[x, z]` where buses should pull over. */
  readonly roadPoint: GeoPoint2D | null;
  readonly roadDistanceMeters: number | null;
  /** Tangent driving direction in radians (`atan2(dx, dz)`, matching `Vehicle` & Three.js `+Z` forward). */
  readonly heading: number;
}

/** Public JSON catalog served from `public/data/world/bus-stops.json`. */
export interface BusStopsCatalog {
  readonly schemaVersion: 1;
  readonly crs: 'EPSG:25829';
  readonly source: string;
  readonly count: number;
  readonly stops: readonly BusStopRecord[];
}

/** Historical landmark catalog record stored in `public/data/landmarks/landmarks.json`. */
export interface LandmarkCatalogRecord {
  readonly id: string;
  readonly name: string;
  readonly scope: string;
  readonly aliases: readonly string[];
  readonly keyFeatures: readonly string[];
  readonly references: readonly string[];
  readonly sourceIds: readonly string[];
  readonly position: {
    readonly lon: number;
    readonly lat: number;
    readonly localMeters: GeoPoint2D;
  } | null;
  readonly heightMeters: number | null;
  readonly heightSource: string | null;
  readonly heightFromLevelsMeters: number | null;
  readonly footprintLocalMeters?: readonly (readonly GeoPoint2D[])[];
}

/** Public JSON catalog served from `public/data/landmarks/landmarks.json`. */
export interface LandmarksCatalog {
  readonly schemaVersion: 1;
  readonly region: string;
  readonly crs: string;
  readonly landmarks: readonly LandmarkCatalogRecord[];
}

/** Common spatial filtering options for portal queries. */
export interface PortalQueryFilter {
  readonly kind?: PortalKind;
  readonly use?: PortalUsageKind;
  readonly zone?: CityZoneKind;
  readonly district?: DistrictKind;
}

/** Options for radial queries over geo entities. */
export interface GeoNearestOptions extends PortalQueryFilter {
  readonly maxDistanceMeters?: number;
}

/** Spatial query result wrapping any geographic record with its squared/linear planar distance. */
export interface GeoSpatialMatch<T> {
  readonly item: T;
  readonly distanceMeters: number;
}

/**
 * Decoupled vehicle stop anchor contract exposed to OpenCode (`VehicleSimulationApi`)
 * and Gemini B (Bus Line jobs) without exposing `ChunkManager` internals.
 */
export interface VehicleRouteStopAnchor {
  readonly stopId: string;
  readonly name: string;
  readonly ref: string | null;
  readonly roadNodeId: string | null;
  readonly roadSegmentId: string | null;
  /** Stop position directly on the drivable carriageway (`roadPoint` if snapped, else stop coords). */
  readonly stopPosition: GeoPoint3D;
  /** Aligned vehicle tangent heading in radians (`atan2(dx, dz)`). */
  readonly heading: number;
  readonly stopRadiusMeters: number;
}

/**
 * Decoupled geographic query contract provided by Gemini A.
 *
 * Consumers (Gemini B gameplay/missions and OpenCode `VehicleSimulationApi`) depend only
 * on this interface and never import `BlenderGeoAdapter`, `ChunkManager`, or renderer internals.
 */
export interface WorldGeoQuery {
  readonly portalCount: number;
  readonly busStopCount: number;
  readonly landmarkCount: number;
  getPortalById(id: string): PortalRecord | undefined;
  getPortalsForBuilding(buildingId: string): readonly PortalRecord[];
  getPortalsInChunk(chunkId: string): readonly PortalRecord[];
  findNearestPortal(
    x: number,
    z: number,
    options?: GeoNearestOptions,
  ): GeoSpatialMatch<PortalRecord> | null;
  queryPortalsInRadius(
    x: number,
    z: number,
    radiusMeters: number,
    filter?: PortalQueryFilter,
  ): readonly GeoSpatialMatch<PortalRecord>[];
  searchPortals(
    queryText: string,
    limit?: number,
    filter?: PortalQueryFilter,
  ): readonly PortalRecord[];
  getBusStopById(id: string): BusStopRecord | undefined;
  getAllBusStops(): readonly BusStopRecord[];
  findNearestBusStop(
    x: number,
    z: number,
    maxDistanceMeters?: number,
  ): GeoSpatialMatch<BusStopRecord> | null;
  queryBusStopsInRadius(
    x: number,
    z: number,
    radiusMeters: number,
  ): readonly GeoSpatialMatch<BusStopRecord>[];
  toVehicleStopAnchor(stop: BusStopRecord, toleranceMeters?: number): VehicleRouteStopAnchor;
  getLandmarkById(id: string): LandmarkCatalogRecord | undefined;
  getAllLandmarks(): readonly LandmarkCatalogRecord[];
  findNearestLandmark(
    x: number,
    z: number,
    maxDistanceMeters?: number,
  ): GeoSpatialMatch<LandmarkCatalogRecord> | null;
  queryLandmarksInRadius(
    x: number,
    z: number,
    radiusMeters: number,
  ): readonly GeoSpatialMatch<LandmarkCatalogRecord>[];
}

/**
 * Minimal runtime environment contract for OpenCode (`VehicleSimulationApi`) and Gemini B
 * combining loaded terrain/road heights, building footprint collision checks, and `WorldGeoQuery`.
 */
export interface GeoEnvironmentBridge {
  readonly geo: WorldGeoQuery;
  readonly worldRegion: WorldManifest['region'];
  /** Samples live road or terrain height at `(x, z)` when the owning chunk is loaded. */
  sampleGroundHeight(x: number, z: number): number | undefined;
  /** Returns `true` if a circle of `radiusMeters` at `(x, z)` avoids all loaded building footprints. */
  isFootprintFree(x: number, z: number, radiusMeters?: number): boolean;
}
