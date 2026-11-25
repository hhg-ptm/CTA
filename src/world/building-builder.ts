import {
  collectBuildingDetails,
  computeExposedEdges,
  polygonSignedArea,
  type AnalyzedBuilding,
} from './building-details';
import { BuildingGeometryWriter, type BuildingColor, type BuildingUv } from './building-geometry';
import {
  classifyBuilding,
  effectiveRoofShape,
  isTowerFeature,
  stableBuildingHash,
  type BuildingStyleSpec,
} from './building-styles';
import { addLandmarkGeometry, isTowerLandmark } from './landmark-geometry';
import { clipToBounds, sampleHeight, type RoadPoint, type RoadPoint3 } from './road-geometry';
import type {
  BuiltBuildingChunk,
  BuiltTerrainChunk,
  BuildingLodGeometry,
  BuildingRoofAnchor,
  BuildingSignSlot,
  ChunkFeature,
  LandmarkModelInstance,
  ProjectedBounds,
} from './types';

interface Footprint extends AnalyzedBuilding {
  readonly fullPoints: readonly RoadPoint[];
  readonly ridgeAxis: 0 | 1;
  readonly ridgeHalfSpan: number;
}

function centroid(points: readonly RoadPoint[]): RoadPoint {
  const area = polygonSignedArea(points);
  if (Math.abs(area) < 1e-7) {
    const bounds = areaBounds(points);
    return [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2];
  }
  let x = 0;
  let z = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (!current || !next) continue;
    const cross = current[0] * next[1] - next[0] * current[1];
    x += (current[0] + next[0]) * cross;
    z += (current[1] + next[1]) * cross;
  }
  return [x / (3 * area), z / (3 * area)];
}

function areaBounds(points: readonly RoadPoint[]): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minZ, maxZ };
}

export function roofShapeFor(
  feature: ChunkFeature,
  points: readonly RoadPoint[],
): 'flat' | 'gabled' | 'hipped' {
  const tagged = feature.roofShape?.toLowerCase();
  if (tagged === 'flat') return 'flat';
  if (tagged === 'gabled' || tagged === 'saltbox' || tagged === 'gambrel') return 'gabled';
  if (tagged === 'hipped' || tagged === 'pyramidal') return 'hipped';
  if (isTowerLandmark(feature)) return 'flat';
  const b = areaBounds(points);
  const width = b.maxX - b.minX;
  const depth = b.maxZ - b.minZ;
  return Math.max(width, depth) / Math.max(0.1, Math.min(width, depth)) > 1.35
    ? 'gabled'
    : 'hipped';
}

function buildFootprint(
  feature: ChunkFeature,
  points: readonly RoadPoint[],
  shapePoints = points,
): Footprint | undefined {
  if (!feature.id || points.length < 3) return undefined;
  const totalHeight = Math.max(
    2.8,
    Math.min(80, feature.visualHeightMeters ?? (feature.visualFloors ?? 2) * 3),
  );
  const inferred = roofShapeFor(feature, shapePoints);
  const shape = effectiveRoofShape(feature, inferred);
  const style: BuildingStyleSpec = classifyBuilding(feature, shape);
  const seed = stableBuildingHash(feature.id);
  const defaultRoofH = style.isHistoric ? 1.25 : style.isIndustrial ? 0.65 : 0.85;
  const roofHeight =
    shape === 'flat' ? 0 : Math.max(0.35, Math.min(8, feature.roofHeightMeters ?? defaultRoofH));
  const b = areaBounds(shapePoints);
  const shapeWidth = b.maxX - b.minX;
  const shapeDepth = b.maxZ - b.minZ;
  const ridgeAxis: 0 | 1 = shapeWidth >= shapeDepth ? 1 : 0;
  const center = centroid(shapePoints);
  const wallHeight = Math.max(2.4, totalHeight - roofHeight);
  const floorCount = Math.max(1, Math.min(20, Math.round(feature.visualFloors ?? wallHeight / 3)));
  return {
    feature,
    points,
    fullPoints: shapePoints,
    centroid: center,
    minX: b.minX,
    maxX: b.maxX,
    minZ: b.minZ,
    maxZ: b.maxZ,
    area: Math.abs(polygonSignedArea(shapePoints)) * 0.5,
    wallHeight,
    roofHeight,
    shape,
    floorCount,
    style,
    seed,
    ridgeAxis,
    ridgeHalfSpan: Math.max(
      0.1,
      ...shapePoints.map((point) => Math.abs(point[ridgeAxis] - center[ridgeAxis])),
    ),
  };
}

function localHeight(terrain: BuiltTerrainChunk, point: RoadPoint): number {
  return sampleHeight(terrain, point[0], point[1]);
}

function worldPoint(point: RoadPoint, y: number): RoadPoint3 {
  return [point[0], y, point[1]];
}

function tileUv(col: number, uvRow: number): BuildingUv[] {
  const columns = 8;
  const rows = 8;
  const inset = 0.002;
  const u0 = col / columns + inset;
  const u1 = (col + 1) / columns - inset;
  const v0 = uvRow / rows + inset;
  const v1 = (uvRow + 1) / rows - inset;
  return [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
}

function selectPanelColumn(
  seed: number,
  edge: number,
  panel: number,
  panels: number,
  floor: number,
  exposed: boolean,
  isIndustrial: boolean,
): number {
  if (!exposed) return 7; // Blind solid masonry on party walls
  if (panels >= 3 && (panel === 0 || panel === panels - 1) && (seed + edge) % 3 === 0) return 6;
  const baySeed = stableBuildingHash(`${seed}:${edge}:${panel}:${floor}`);
  if (floor === 0) {
    if (isIndustrial) return baySeed % 3 === 0 ? 2 : 7;
    if (panel === Math.floor(panels / 2)) return baySeed % 2 === 0 ? 2 : 1;
    return [0, 1, 3, 4][baySeed % 4] ?? 0;
  }
  return [0, 1, 2, 3, 4, 5][baySeed % 6] ?? 0;
}

function onChunkBoundary(a: RoadPoint, b: RoadPoint, bounds: ProjectedBounds): boolean {
  const tolerance = 0.02;
  return (
    (Math.abs(a[0] - bounds.minX) < tolerance && Math.abs(b[0] - bounds.minX) < tolerance) ||
    (Math.abs(a[0] - bounds.maxX) < tolerance && Math.abs(b[0] - bounds.maxX) < tolerance) ||
    (Math.abs(a[1] - bounds.minZ) < tolerance && Math.abs(b[1] - bounds.minZ) < tolerance) ||
    (Math.abs(a[1] - bounds.maxZ) < tolerance && Math.abs(b[1] - bounds.maxZ) < tolerance)
  );
}

function addProjectingStrip(
  writer: BuildingGeometryWriter,
  material: Footprint['style']['wallMaterial'],
  start: RoadPoint,
  end: RoadPoint,
  outward: RoadPoint,
  groundStart: number,
  groundEnd: number,
  bottomOffset: number,
  topOffset: number,
  projection: number,
  color: BuildingColor,
): void {
  const s: RoadPoint = [start[0] + outward[0] * projection, start[1] + outward[1] * projection];
  const e: RoadPoint = [end[0] + outward[0] * projection, end[1] + outward[1] * projection];
  writer.addQuad(
    material,
    [
      worldPoint(s, groundStart + bottomOffset),
      worldPoint(e, groundEnd + bottomOffset),
      worldPoint(e, groundEnd + topOffset),
      worldPoint(s, groundStart + topOffset),
    ],
    color,
    tileUv(7, 0) as [BuildingUv, BuildingUv, BuildingUv, BuildingUv],
  );
}

function addWalls(
  writer: BuildingGeometryWriter,
  item: Footprint,
  exposedEdges: readonly boolean[],
  terrain: BuiltTerrainChunk,
  bounds: ProjectedBounds,
  detailed: boolean,
  makeCollider = false,
): void {
  const polygon = item.points;
  const signedArea = polygonSignedArea(polygon);
  const { style, floorCount, seed } = item;

  for (let edge = 0; edge < polygon.length; edge += 1) {
    const start = polygon[edge];
    const end = polygon[(edge + 1) % polygon.length];
    if (!start || !end) continue;
    if (onChunkBoundary(start, end, bounds)) continue;
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (length < 0.1) continue;
    const outward: RoadPoint =
      signedArea >= 0
        ? [(end[1] - start[1]) / length, -(end[0] - start[0]) / length]
        : [-(end[1] - start[1]) / length, (end[0] - start[0]) / length];
    const exposed = exposedEdges[edge] ?? true;
    const panels = detailed ? Math.max(1, Math.ceil(length / 3.8)) : 1;
    const floors = detailed ? floorCount : 1;
    const startGround = localHeight(terrain, start);
    const endGround = localHeight(terrain, end);

    for (let panel = 0; panel < panels; panel += 1) {
      const t0 = panel / panels;
      const t1 = (panel + 1) / panels;
      const panelStart: RoadPoint = [
        start[0] + (end[0] - start[0]) * t0,
        start[1] + (end[1] - start[1]) * t0,
      ];
      const panelEnd: RoadPoint = [
        start[0] + (end[0] - start[0]) * t1,
        start[1] + (end[1] - start[1]) * t1,
      ];
      const groundStart = startGround + (endGround - startGround) * t0;
      const groundEnd = startGround + (endGround - startGround) * t1;

      for (let floor = 0; floor < floors; floor += 1) {
        const floorBottom = (item.wallHeight * floor) / floors;
        const floorTop = (item.wallHeight * (floor + 1)) / floors;
        const uvRow = style.atlasBand * 2 + (floor === 0 ? 0 : 1);
        const col = detailed
          ? selectPanelColumn(seed, edge, panel, panels, floor, exposed, style.isIndustrial)
          : 7;
        writer.addQuad(
          style.wallMaterial,
          [
            worldPoint(panelStart, groundStart + floorBottom),
            worldPoint(panelEnd, groundEnd + floorBottom),
            worldPoint(panelEnd, groundEnd + floorTop),
            worldPoint(panelStart, groundStart + floorTop),
          ],
          style.tint,
          tileUv(col, uvRow) as [BuildingUv, BuildingUv, BuildingUv, BuildingUv],
        );
      }
    }

    if (detailed && exposed) {
      // Emit one belt course strip per exposed (edge, floor) rather than per panel.
      for (let floor = 0; floor < floors - 1; floor += 1) {
        const floorTop = (item.wallHeight * (floor + 1)) / floors;
        addProjectingStrip(
          writer,
          style.wallMaterial,
          start,
          end,
          outward,
          startGround,
          endGround,
          floorTop - 0.1,
          floorTop - 0.02,
          0.055,
          [style.tint[0] * 0.84, style.tint[1] * 0.84, style.tint[2] * 0.84],
        );
      }
      // Ground-floor stone plinth ("zócalo") anchors every facade cleanly onto sloped sidewalks
      addProjectingStrip(
        writer,
        style.wallMaterial,
        start,
        end,
        outward,
        startGround,
        endGround,
        -0.25,
        0.72,
        0.05,
        style.plinthColor,
      );
      // Top cornice molding ("cornisa") or flat roof raised parapet ("peto de azotea")
      if (style.parapetHeightMeters > 0) {
        const ph = style.parapetHeightMeters;
        addProjectingStrip(
          writer,
          style.wallMaterial,
          start,
          end,
          outward,
          startGround,
          endGround,
          item.wallHeight - 0.12,
          item.wallHeight + ph,
          0.06,
          [style.tint[0] * 0.9, style.tint[1] * 0.9, style.tint[2] * 0.9],
        );
      } else {
        addProjectingStrip(
          writer,
          style.wallMaterial,
          start,
          end,
          outward,
          startGround,
          endGround,
          item.wallHeight - 0.18,
          item.wallHeight,
          0.11,
          [style.tint[0] * 0.88, style.tint[1] * 0.88, style.tint[2] * 0.88],
        );
      }
    }

    if (makeCollider) {
      const bottomStart = worldPoint(start, startGround);
      const bottomEnd = worldPoint(end, endGround);
      const topStart = worldPoint(start, startGround + item.wallHeight);
      const topEnd = worldPoint(end, endGround + item.wallHeight);
      writer.addColliderTriangle([bottomStart, bottomEnd, topEnd]);
      writer.addColliderTriangle([bottomStart, topEnd, topStart]);
    }
  }
}

function clipHalf(
  points: readonly RoadPoint[],
  axis: 0 | 1,
  middle: number,
  keepBelow: boolean,
): RoadPoint[] {
  const clipped: RoadPoint[] = [];
  let previous = points.at(-1);
  for (const current of points) {
    if (!previous) continue;
    const previousInside = keepBelow ? previous[axis] <= middle : previous[axis] >= middle;
    const currentInside = keepBelow ? current[axis] <= middle : current[axis] >= middle;
    if (currentInside !== previousInside) {
      const delta = current[axis] - previous[axis];
      const t = Math.abs(delta) < 1e-8 ? 0 : (middle - previous[axis]) / delta;
      clipped.push([
        previous[0] + (current[0] - previous[0]) * t,
        previous[1] + (current[1] - previous[1]) * t,
      ]);
    }
    if (currentInside) clipped.push(current);
    previous = current;
  }
  return clipped;
}

function expandForEaves(
  points: readonly RoadPoint[],
  overhang: number,
  center: RoadPoint,
): RoadPoint[] {
  if (overhang <= 0.01) return [...points];
  return points.map((pt) => {
    const dx = pt[0] - center[0];
    const dz = pt[1] - center[1];
    const dist = Math.hypot(dx, dz);
    if (dist < 0.25) return pt;
    return [pt[0] + (dx / dist) * overhang, pt[1] + (dz / dist) * overhang];
  });
}

function addRoof(
  writer: BuildingGeometryWriter,
  item: Footprint,
  terrain: BuiltTerrainChunk,
  detailed: boolean,
): void {
  const overhang = detailed && item.shape !== 'flat' ? item.style.eaveOverhangMeters : 0;
  const roofPoints = expandForEaves(item.points, overhang, item.centroid);
  const eaveDrop = overhang > 0 ? 0.14 : 0;
  const top: RoadPoint3[] = roofPoints.map((point) =>
    worldPoint(point, localHeight(terrain, point) + item.wallHeight - eaveDrop),
  );
  const roofTint: BuildingColor = item.style.isIndustrial ? [0.78, 0.82, 0.85] : [1, 1, 1];
  const mat = item.style.roofMaterial;

  if (item.shape === 'flat' || !detailed) {
    writer.addPolygon(mat, top, roofTint, (point) => [point[0] / 4, point[2] / 4]);
    return;
  }
  if (item.shape === 'hipped') {
    const centerY = localHeight(terrain, item.centroid) + item.wallHeight + item.roofHeight;
    const center = worldPoint(item.centroid, centerY);
    for (let index = 0; index < top.length; index += 1) {
      const first = top[index];
      const second = top[(index + 1) % top.length];
      if (!first || !second) continue;
      writer.addTriangle(mat, [first, second, center], roofTint, [
        [first[0] / 4, first[2] / 4],
        [second[0] / 4, second[2] / 4],
        [center[0] / 4, center[2] / 4],
      ]);
    }
    return;
  }
  const splitAxis = item.ridgeAxis;
  const middle = item.centroid[splitAxis];
  const maxDistance = item.ridgeHalfSpan + overhang;
  for (const keepBelow of [true, false]) {
    const half = clipHalf(roofPoints, splitAxis, middle, keepBelow);
    if (half.length < 3) continue;
    const roof = half.map((point) => {
      const rise =
        item.roofHeight * Math.min(1, Math.abs(point[splitAxis] - middle) / maxDistance) - eaveDrop;
      return worldPoint(point, localHeight(terrain, point) + item.wallHeight + rise);
    });
    writer.addPolygon(mat, roof, roofTint, (point) => [point[0] / 4, point[2] / 4]);
  }
}

function roadDistance(point: RoadPoint, roads: readonly ChunkFeature[]): number {
  let bestDistance = Infinity;
  for (const road of roads) {
    if (road.featureType !== 'road' && road.featureType !== 'pedestrian') continue;
    for (let index = 1; index < (road.points?.length ?? 0); index += 1) {
      const a = road.points?.[index - 1];
      const b = road.points?.[index];
      if (!a || !b) continue;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const lengthSquared = dx * dx + dz * dz;
      const t =
        lengthSquared < 1e-6
          ? 0
          : Math.max(
              0,
              Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSquared),
            );
      const distance = Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dz * t);
      bestDistance = Math.min(bestDistance, distance);
    }
  }
  return bestDistance;
}

function signSlot(
  item: Footprint,
  terrain: BuiltTerrainChunk,
  roads: readonly ChunkFeature[],
): BuildingSignSlot | undefined {
  if (!item.feature.commercial || item.points.length < 3) return undefined;
  let bestIndex = -1;
  let bestLength = 0;
  let bestRoadDistance = Infinity;
  for (let index = 0; index < item.points.length; index += 1) {
    const a = item.points[index];
    const b = item.points[(index + 1) % item.points.length];
    if (!a || !b) continue;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1.5) continue;
    const midpoint: RoadPoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const distance = roadDistance(midpoint, roads);
    if (distance < bestRoadDistance || (distance === bestRoadDistance && length > bestLength)) {
      bestIndex = index;
      bestLength = length;
      bestRoadDistance = distance;
    }
  }
  if (bestIndex < 0 || bestRoadDistance > 40) return undefined;
  const start = item.points[bestIndex];
  const end = item.points[(bestIndex + 1) % item.points.length];
  if (!start || !end || bestLength < 1.5) return undefined;
  const midpoint: RoadPoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const signedArea = polygonSignedArea(item.points);
  const edgeDx = end[0] - start[0];
  const edgeDz = end[1] - start[1];
  const normalX = signedArea >= 0 ? edgeDz : -edgeDz;
  const normalZ = signedArea >= 0 ? -edgeDx : edgeDx;
  return {
    buildingId: item.feature.id ?? '',
    category: item.feature.commercialCategory ?? 'business:shop',
    name: item.feature.name ?? item.feature.commercialCategory ?? 'Tienda',
    position: [midpoint[0], localHeight(terrain, midpoint) + item.wallHeight * 0.55, midpoint[1]],
    heading: Math.atan2(normalX, normalZ),
    width: Math.min(bestLength * 0.7, 3.5),
  };
}

function buildLod(
  analyzed: readonly Footprint[],
  exposedMap: ReadonlyMap<string, readonly boolean[]>,
  features: readonly ChunkFeature[],
  terrain: BuiltTerrainChunk,
  bounds: ProjectedBounds,
  lod: number,
): BuildingLodGeometry {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const writer = new BuildingGeometryWriter(centerX, centerZ);
  for (const item of analyzed) {
    if (
      item.feature.landmarkModelPath &&
      /^landmarks\/w\d+\.glb$/.test(item.feature.landmarkModelPath)
    )
      continue;
    const exposed = exposedMap.get(item.feature.id ?? '') ?? [];
    addWalls(writer, item, exposed, terrain, bounds, lod === 0);
    addRoof(writer, item, terrain, lod === 0);
  }
  addLandmarkGeometry(writer, features, terrain, bounds, lod);
  const surfaces = writer.build();
  return {
    level: lod,
    surfaces,
    triangleCount: surfaces.reduce((sum, surface) => sum + surface.indices.length / 3, 0),
  };
}

function buildExtras(
  analyzed: readonly Footprint[],
  exposedMap: ReadonlyMap<string, readonly boolean[]>,
  features: readonly ChunkFeature[],
  terrain: BuiltTerrainChunk,
  bounds: ProjectedBounds,
): {
  signs: BuildingSignSlot[];
  anchors: BuildingRoofAnchor[];
  detailBatches: ReturnType<typeof collectBuildingDetails>;
  models: LandmarkModelInstance[];
  storks: { buildingId: string; position: RoadPoint3 }[];
} {
  const signs: BuildingSignSlot[] = [];
  const anchors: BuildingRoofAnchor[] = [];
  const models: LandmarkModelInstance[] = [];
  const storks: { buildingId: string; position: RoadPoint3 }[] = [];
  const roads = features.filter(
    (feature) => feature.featureType === 'road' || feature.featureType === 'pedestrian',
  );
  for (const item of analyzed) {
    const feature = item.feature;
    const center = item.centroid;
    const owner =
      center[0] >= bounds.minX &&
      center[0] < bounds.maxX &&
      center[1] >= bounds.minZ &&
      center[1] < bounds.maxZ;
    if (
      owner &&
      feature.landmarkModelPath &&
      /^landmarks\/w\d+\.glb$/.test(feature.landmarkModelPath)
    ) {
      models.push({
        buildingId: feature.id ?? '',
        path: feature.landmarkModelPath,
        position: [center[0], localHeight(terrain, center), center[1]],
      });
    }
    if (owner && feature.zone === 'casco' && item.wallHeight >= 5) {
      anchors.push({
        buildingId: feature.id ?? '',
        position: [
          center[0],
          localHeight(terrain, center) + item.wallHeight + item.roofHeight,
          center[1],
        ],
        roofShape: item.shape,
      });
    }
    const landmarkTower = isTowerFeature(feature);
    const roofId = feature.id ?? '';
    const roofHash = [...roofId].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);
    if (
      owner &&
      feature.zone === 'casco' &&
      item.wallHeight >= 5 &&
      (landmarkTower || roofHash % 11 === 0)
    ) {
      storks.push({
        buildingId: roofId,
        position: [
          center[0],
          localHeight(terrain, center) + item.wallHeight + item.roofHeight + 0.85,
          center[1],
        ],
      });
    }
    if (owner) {
      const slot = signSlot(item, terrain, roads);
      if (slot) signs.push(slot);
    }
  }
  const ciguenas = features.find(
    (feature) => feature.featureType === 'poi' && feature.id === 'n13723182454',
  );
  if (ciguenas?.position) {
    const [px, pz] = ciguenas.position;
    if (px >= bounds.minX && px < bounds.maxX && pz >= bounds.minZ && pz < bounds.maxZ) {
      const ground = localHeight(terrain, [px, pz] as RoadPoint);
      storks.push({ buildingId: ciguenas.id ?? '', position: [px, ground + 24 + 0.85 + 0.75, pz] });
    }
  }
  const detailBatches = collectBuildingDetails(analyzed, exposedMap, roads, terrain, bounds);
  return { signs, anchors, detailBatches, models, storks };
}

export function buildBuildingChunk(
  features: readonly ChunkFeature[],
  terrain: BuiltTerrainChunk,
  bounds: ProjectedBounds,
): BuiltBuildingChunk {
  const analyzed: Footprint[] = [];
  for (const feature of features) {
    if (feature.featureType !== 'building' || !feature.points || feature.points.length < 3)
      continue;
    const item = buildFootprint(feature, clipToBounds(feature.points, bounds), feature.points);
    if (item) analyzed.push(item);
  }
  const exposedMap = new Map<string, readonly boolean[]>();
  for (const item of analyzed)
    exposedMap.set(item.feature.id ?? '', computeExposedEdges(item, analyzed));

  const levels = [0, 1, 2].map((lod) =>
    buildLod(analyzed, exposedMap, features, terrain, bounds, lod),
  );
  const extras = buildExtras(analyzed, exposedMap, features, terrain, bounds);
  const colliderWriter = new BuildingGeometryWriter(
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  );
  for (const item of analyzed) addWalls(colliderWriter, item, [], terrain, bounds, false, true);
  const collider = colliderWriter.buildCollider();
  const footprints = features
    .filter(
      (feature) =>
        feature.featureType === 'building' &&
        Array.isArray(feature.points) &&
        (feature.points?.length ?? 0) >= 3,
    )
    .map((feature) => feature.points as (readonly [number, number])[]);
  return {
    levels,
    colliderPositions: collider.positions,
    colliderIndices: collider.indices,
    signSlots: extras.signs,
    roofAnchors: extras.anchors,
    detailBatches: extras.detailBatches,
    landmarkModels: extras.models,
    storks: extras.storks,
    footprints,
  };
}
