export interface ProjectedBounds {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

export interface ChunkEntry {
  readonly id: string;
  readonly path: string;
  readonly bounds: ProjectedBounds;
  readonly bytes: number;
  readonly sha256: string;
  readonly featureCount: number;
}

export interface WorldManifest {
  readonly schemaVersion: number;
  readonly region: string;
  readonly extentMeters: number;
  readonly chunkMeters: number;
  readonly roadNetwork?: {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly nodes: number;
    readonly segments: number;
    readonly connections: number;
  };
  readonly walkRoute?: {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly lengthMeters: number;
    readonly segments: number;
  };
  readonly chunks: readonly ChunkEntry[];
}

export interface BuildingPartVolume {
  readonly pts: readonly (readonly [number, number])[];
  readonly floors?: number | null;
  readonly heightMeters?: number | null;
}

export type TreeSpeciesKind = 'deciduous' | 'oak' | 'pine' | 'palm' | 'cypress';

export type DetailBudgetProfile = '600k' | '1200k' | '2000k';

export interface ChunkFeature {
  readonly featureType: 'road' | 'pedestrian' | 'building' | 'surface' | 'prop' | 'poi';
  readonly id?: string;
  readonly name?: string;
  readonly kind?: string;
  readonly value?: string;
  readonly surface?: string;
  readonly highway?: string;
  readonly nodeIds?: readonly number[];
  readonly lanes?: number | null;
  readonly maxSpeedKph?: number | null;
  readonly widthMeters?: number | null;
  readonly oneway?: -1 | 0 | 1;
  readonly sidewalk?: string;
  readonly sidewalkLeft?: string;
  readonly sidewalkRight?: string;
  readonly turnLanes?: string;
  readonly bridge?: boolean;
  readonly tunnel?: boolean;
  readonly layer?: number;
  readonly incline?: string;
  readonly junction?: string;
  readonly area?: boolean;
  readonly floors?: number | null;
  readonly heightMeters?: number | null;
  readonly visualFloors?: number;
  readonly visualHeightMeters?: number;
  readonly heightOrigin?: 'osm_explicit' | 'catastro_floors' | 'estimated' | 'unknown';
  readonly roofHeightMeters?: number | null;
  readonly roofShape?: string;
  readonly roofMaterial?: 'tile' | 'modern';
  readonly roofColour?: string;
  readonly facadeColour?: string;
  readonly buildingType?: string;
  readonly historic?: string;
  readonly zone?: 'casco' | 'ensanche' | 'periferia';
  readonly commercial?: boolean;
  readonly commercialCategory?: string;
  readonly catastroUse?: string;
  readonly catastroEra?: string;
  readonly innerRings?: readonly (readonly (readonly [number, number])[])[];
  readonly parts?: readonly BuildingPartVolume[];
  readonly portalPoints?: readonly (readonly [number, number])[];
  readonly category?: string;
  readonly fictional?: boolean;
  readonly landmarkModelPath?: string;
  readonly directionDegrees?: number | null;
  readonly trafficSign?: string;
  readonly treeSpecies?: TreeSpeciesKind;
  readonly points?: readonly (readonly [number, number])[];
  readonly position?: readonly [number, number];
}

export interface RawTerrainChunk {
  readonly id: string;
  readonly bounds: ProjectedBounds;
  readonly terrain: {
    readonly samples: number;
    readonly stepMeters: number;
    readonly quantizationMeters: number;
    readonly heights: readonly number[];
  };
  readonly features: readonly ChunkFeature[];
}

export interface TerrainLodData {
  readonly level: number;
  readonly size: number;
  readonly stepMeters: number;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly indices: Uint32Array;
}

export type RoadSurfaceStyle = 'asphalt' | 'stone' | 'sidewalk' | 'concrete' | 'earth' | 'marking';

export type BuildingMaterial =
  | 'casco_facade'
  | 'ensanche_facade'
  | 'periferia_facade'
  | 'tile_roof'
  | 'modern_roof'
  | 'monument_stone';

export interface BuildingSurfaceGeometry {
  readonly material: BuildingMaterial;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
}

export interface BuildingLodGeometry {
  readonly level: number;
  readonly surfaces: readonly BuildingSurfaceGeometry[];
  readonly triangleCount: number;
}

export interface BuildingSignSlot {
  readonly buildingId: string;
  readonly category: string;
  readonly name: string;
  readonly position: readonly [number, number, number];
  readonly heading: number;
  readonly width: number;
}

export interface BuildingRoofAnchor {
  readonly buildingId: string;
  readonly position: readonly [number, number, number];
  readonly roofShape: string;
}

export interface LandmarkModelInstance {
  readonly buildingId: string;
  readonly path: string;
  readonly position: readonly [number, number, number];
}

export interface StorkInstance {
  readonly buildingId: string;
  readonly position: readonly [number, number, number];
}

export type BuildingDetailKind =
  | 'balcony'
  | 'balcony_modern'
  | 'window_casco'
  | 'window_ensanche'
  | 'window_modern'
  | 'window_awning'
  | 'portal_casco'
  | 'portal_modern'
  | 'shopfront_awning'
  | 'industrial_door'
  | 'pilaster_corner'
  | 'chimney'
  | 'dormer_roof'
  | 'rooftop_penthouse'
  | 'rooftop_hvac'
  | 'rooftop_solar'
  | 'bell_gable'
  | 'corner_turret'
  | 'heraldic_crest';

export interface BuildingDetailBatch {
  readonly kind: BuildingDetailKind;
  readonly maxLod: 0 | 1;
  readonly positions: Float32Array;
  readonly headings: Float32Array;
  readonly scales: Float32Array;
}

export interface BuiltBuildingChunk {
  readonly levels: readonly BuildingLodGeometry[];
  readonly colliderPositions: Float32Array;
  readonly colliderIndices: Uint32Array;
  readonly signSlots: readonly BuildingSignSlot[];
  readonly roofAnchors: readonly BuildingRoofAnchor[];
  readonly detailBatches?: readonly BuildingDetailBatch[];
  readonly landmarkModels: readonly LandmarkModelInstance[];
  readonly storks: readonly StorkInstance[];
  readonly footprints: readonly (readonly (readonly [number, number])[])[];
}

export interface RoadSurfaceGeometry {
  readonly style: RoadSurfaceStyle;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
}

export type RoadPropKind =
  | 'traffic_signals'
  | 'stop'
  | 'give_way'
  | 'street_lamp'
  | 'street_lamp_modern'
  | 'tree'
  | 'tree_deciduous'
  | 'tree_oak'
  | 'tree_pine'
  | 'tree_palm'
  | 'tree_cypress'
  | 'shrub'
  | 'hedge'
  | 'bus_shelter'
  | 'bench'
  | 'waste_basket'
  | 'fountain';

export interface RoadPropBatch {
  readonly kind: RoadPropKind;
  readonly positions: Float32Array;
  readonly headings: Float32Array;
}

export interface BuiltRoadChunk {
  readonly surfaces: readonly RoadSurfaceGeometry[];
  readonly markings: RoadSurfaceGeometry;
  readonly colliderPositions: Float32Array;
  readonly colliderIndices: Uint32Array;
  readonly props: readonly RoadPropBatch[];
  readonly triangleCount: number;
}

export interface BuiltTerrainChunk {
  readonly id: string;
  readonly bounds: ProjectedBounds;
  readonly samples: number;
  readonly stepMeters: number;
  readonly heights: Float32Array;
  readonly minimumHeight: number;
  readonly maximumHeight: number;
  readonly levels: readonly TerrainLodData[];
  roads?: BuiltRoadChunk;
  buildings?: BuiltBuildingChunk;
}

export interface TerrainChunkEvents {
  chunkLoaded: { readonly id: string; readonly lod: number; readonly memoryBytes: number };
  chunkUnloaded: { readonly id: string };
}

export interface RoadNetworkNode {
  readonly id: string;
  readonly position: readonly [number, number];
  readonly segmentIds: readonly string[];
  readonly intersection: boolean;
}

export interface RoadNetworkSegment {
  readonly id: string;
  readonly wayId: string;
  readonly fromNode: string;
  readonly toNode: string;
  readonly lengthMeters: number;
  readonly highway: string;
  readonly surface: string;
  readonly laneCount: number;
  readonly forwardLanes: number;
  readonly reverseLanes: number;
  readonly oneWay: -1 | 0 | 1;
  readonly forwardAllowed: boolean;
  readonly reverseAllowed: boolean;
  readonly walkable: boolean;
  readonly maxSpeedKph: number | null;
  readonly bridge: boolean;
  readonly tunnel: boolean;
}

export interface RoadNetworkConnection {
  readonly intersectionNode: string;
  readonly fromSegment: string;
  readonly toSegment: string;
  readonly maneuver: 'left' | 'right' | 'straight' | 'uturn';
}

export interface RoadNetwork {
  readonly schemaVersion: number;
  readonly crs: 'EPSG:25829';
  readonly nodes: readonly RoadNetworkNode[];
  readonly segments: readonly RoadNetworkSegment[];
  readonly connections: readonly RoadNetworkConnection[];
  readonly intersections: readonly string[];
}
