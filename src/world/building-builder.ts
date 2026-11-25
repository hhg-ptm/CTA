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
import {
  addCourtyardWalls,
  addFacadeReliefFrames,
  addGabledEndWalls,
  addRecessedWindowCell,
  addStylizedRoof,
  buildSetbackPenthouseSpec,
  solidTrimUv,
  type VolumeItem,
} from './building-volumes';
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

function pointInsidePolygon2d(x: number, z: number, points: readonly RoadPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i]?.[0] ?? 0;
    const zi = points[i]?.[1] ?? 0;
    const xj = points[j]?.[0] ?? 0;
    const zj = points[j]?.[1] ?? 0;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function filterValidInnerRings(
  outerPoints: readonly RoadPoint[],
  candidateRings: readonly (readonly (readonly [number, number])[])[] | undefined,
): RoadPoint[][] | undefined {
  if (!candidateRings || candidateRings.length === 0) return undefined;
  const ob = areaBounds(outerPoints);
  const valid: RoadPoint[][] = [];
  for (const ring of candidateRings) {
    if (ring.length < 3) continue;
    const clipped = clipToBounds(ring, {
      minX: ob.minX - 0.1,
      maxX: ob.maxX + 0.1,
      minZ: ob.minZ - 0.1,
      maxZ: ob.maxZ + 0.1,
    });
    if (clipped.length < 3) continue;
    const c = centroid(clipped);
    if (pointInsidePolygon2d(c[0], c[1], outerPoints)) {
      valid.push(clipped);
    }
  }
  return valid.length > 0 ? valid : undefined;
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
  overrideFloors?: number | null,
  overrideHeightMeters?: number | null,
): VolumeItem | undefined {
  if (!feature.id || points.length < 3) return undefined;
  const inferred = roofShapeFor(feature, shapePoints);
  const shape = effectiveRoofShape(feature, inferred);
  const style: BuildingStyleSpec = classifyBuilding(feature, shape);
  const seed = stableBuildingHash(feature.id);

  let rawFloors = overrideFloors ?? feature.visualFloors ?? feature.floors ?? 2;
  rawFloors = Math.max(1, Math.min(20, rawFloors));
  let totalHeight: number;
  if (overrideHeightMeters !== undefined && overrideHeightMeters !== null) {
    totalHeight = overrideHeightMeters;
  } else if (overrideFloors !== undefined && overrideFloors !== null) {
    totalHeight =
      style.floorHeightsMeters.ground + Math.max(0, rawFloors - 1) * style.floorHeightsMeters.upper;
  } else if (feature.visualHeightMeters !== undefined) {
    totalHeight = feature.visualHeightMeters;
  } else {
    totalHeight =
      style.floorHeightsMeters.ground + Math.max(0, rawFloors - 1) * style.floorHeightsMeters.upper;
  }
  totalHeight = Math.max(2.8, Math.min(80, totalHeight));

  const defaultRoofH = style.isHistoric ? 1.35 : style.isIndustrial ? 0.85 : 1.05;
  const roofHeight =
    shape === 'flat' ? 0 : Math.max(0.45, Math.min(8, feature.roofHeightMeters ?? defaultRoofH));
  const b = areaBounds(shapePoints);
  const shapeWidth = b.maxX - b.minX;
  const shapeDepth = b.maxZ - b.minZ;
  const ridgeAxis: 0 | 1 = shapeWidth >= shapeDepth ? 1 : 0;
  const center = centroid(shapePoints);
  const wallHeight = Math.max(2.4, totalHeight - roofHeight);
  const floorCount = Math.max(
    1,
    Math.min(20, Math.round(overrideFloors ?? feature.visualFloors ?? wallHeight / 3)),
  );

  const innerRings = filterValidInnerRings(points, feature.innerRings);

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
    innerRings,
  };
}

function expandRenderVolumes(
  baseVolumes: readonly VolumeItem[],
  bounds: ProjectedBounds,
): {
  readonly mainVolumes: readonly VolumeItem[];
  readonly setbackVolumes: readonly VolumeItem[];
} {
  const mainVolumes: VolumeItem[] = [];
  const setbackVolumes: VolumeItem[] = [];

  for (const base of baseVolumes) {
    const parts = base.feature.parts;
    if (parts && parts.length >= 2) {
      let emittedPart = false;
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i];
        if (!part || part.pts.length < 3) continue;
        const clipped = clipToBounds(part.pts, bounds);
        if (clipped.length < 3) continue;
        const partFeature: ChunkFeature = {
          ...base.feature,
          id: `${base.feature.id}#p${i}`,
        };
        const vol = buildFootprint(
          partFeature,
          clipped,
          part.pts,
          part.floors ?? undefined,
          part.heightMeters ?? undefined,
        );
        if (vol) {
          mainVolumes.push({
            ...vol,
            feature: base.feature,
            seed: stableBuildingHash(`${base.feature.id}:${i}`),
          });
          emittedPart = true;
        }
      }
      if (emittedPart) continue;
    }

    const attic = buildSetbackPenthouseSpec(base);
    if (attic && base.floorCount >= 5) {
      const clippedAttic = clipToBounds(attic.fullPoints, bounds);
      const reducedHeight = attic.baseElevationOffset ?? base.wallHeight;
      mainVolumes.push({
        ...base,
        wallHeight: reducedHeight,
        floorCount: Math.max(1, base.floorCount - 1),
      });
      if (clippedAttic.length >= 3) {
        setbackVolumes.push({ ...attic, points: clippedAttic });
      }
      continue;
    }
    mainVolumes.push(base);
  }
  return { mainVolumes, setbackVolumes };
}

function localHeight(terrain: BuiltTerrainChunk, point: RoadPoint): number {
  return sampleHeight(terrain, point[0], point[1]);
}

function worldPoint(point: RoadPoint, y: number): RoadPoint3 {
  return [point[0], y, point[1]];
}

export function tileUv(col: number, uvRow: number): BuildingUv[] {
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
  exposed: boolean,
  isHistoric: boolean,
  lod: number,
  floor: number,
  commercial: boolean,
): number {
  if (!exposed) return 7;
  if (lod === 1) {
    if (floor === 0) return commercial ? 1 : 3;
    return (seed + edge + panel + floor) % 2 === 0 ? 1 : 4;
  }
  if (isHistoric && panels >= 3 && (panel === 0 || panel === panels - 1) && (seed + edge) % 3 === 0)
    return 6;
  return 7;
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
  material: VolumeItem['style']['wallMaterial'],
  start: RoadPoint,
  end: RoadPoint,
  outward: RoadPoint,
  groundStart: number,
  groundEnd: number,
  bottomOffset: number,
  topOffset: number,
  projection: number,
  color: BuildingColor,
  trimRow = 0,
): void {
  const s: RoadPoint = [start[0] + outward[0] * projection, start[1] + outward[1] * projection];
  const e: RoadPoint = [end[0] + outward[0] * projection, end[1] + outward[1] * projection];
  const uv = solidTrimUv(7, trimRow);
  writer.addQuad(
    material,
    [
      worldPoint(s, groundStart + bottomOffset),
      worldPoint(e, groundEnd + bottomOffset),
      worldPoint(e, groundEnd + topOffset),
      worldPoint(s, groundStart + topOffset),
    ],
    color,
    uv,
  );
}

function addWalls(
  writer: BuildingGeometryWriter,
  item: VolumeItem,
  exposedEdges: readonly boolean[],
  terrain: BuiltTerrainChunk,
  bounds: ProjectedBounds,
  lod: number,
  makeCollider = false,
): void {
  const polygon = item.points;
  const signedArea = polygonSignedArea(polygon);
  const { style, floorCount, seed } = item;
  const baseOffset = item.baseElevationOffset ?? 0;
  const isSetback = baseOffset > 0.1;
  const detailed = lod === 0;

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
    const exposed = isSetback ? true : (exposedEdges[edge] ?? true);
    const activeDetail = detailed && exposed && length >= 3.2;
    const panels = activeDetail
      ? Math.max(1, Math.min(5, Math.round(length / 5.6)))
      : lod === 1 && exposed && length >= 7.0
        ? 2
        : 1;
    const floors = activeDetail
      ? Math.min(floorCount, 7)
      : lod === 1 && exposed
        ? Math.min(floorCount, 5)
        : 1;
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
        const floorBottom = baseOffset + (item.wallHeight * floor) / floors;
        const floorTop = baseOffset + (item.wallHeight * (floor + 1)) / floors;
        if (activeDetail) {
          addRecessedWindowCell(
            writer,
            item,
            panelStart,
            panelEnd,
            outward,
            groundStart,
            groundEnd,
            floorBottom,
            floorTop,
            floor,
            panel,
            exposed,
            isSetback,
          );
        } else {
          const uvRow = style.atlasBand * 2 + (floor === 0 && !isSetback ? 0 : 1);
          const col = selectPanelColumn(
            seed,
            edge,
            panel,
            panels,
            exposed,
            style.isHistoric,
            lod,
            floor,
            Boolean(item.feature.commercial),
          );
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
    }

    if (detailed && exposed) {
      addFacadeReliefFrames(
        writer,
        item,
        start,
        end,
        outward,
        startGround,
        endGround,
        panels,
        floors,
      );
      // Floor belt courses ("impostas")
      for (let floor = 0; floor < floors - 1; floor += 1) {
        const floorTop = baseOffset + (item.wallHeight * (floor + 1)) / floors;
        addProjectingStrip(
          writer,
          style.wallMaterial,
          start,
          end,
          outward,
          startGround,
          endGround,
          floorTop - 0.11,
          floorTop + 0.02,
          floor === 0 && item.feature.commercial ? 0.14 : 0.075,
          style.trimColor,
          style.atlasBand * 2,
        );
      }
      if (!isSetback) {
        // Ground-floor carved plinth ("zócalo") anchoring facades cleanly onto slopes
        addProjectingStrip(
          writer,
          style.wallMaterial,
          start,
          end,
          outward,
          startGround,
          endGround,
          -0.25,
          item.feature.commercial ? 0.85 : 0.72,
          0.07,
          style.plinthColor,
          style.atlasBand * 2,
        );
      }
      // Top cornice molding ("cornisa") or flat roof parapet ("peto de azotea")
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
          baseOffset + item.wallHeight - 0.14,
          baseOffset + item.wallHeight + ph,
          0.09,
          style.trimColor,
          style.atlasBand * 2 + 1,
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
          baseOffset + item.wallHeight - 0.22,
          baseOffset + item.wallHeight,
          0.13,
          style.trimColor,
          style.atlasBand * 2 + 1,
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

  if (detailed) {
    if (item.innerRings && item.innerRings.length > 0) {
      addCourtyardWalls(writer, item, item.innerRings, terrain, bounds, true, tileUv);
    }
    if (item.shape === 'gabled') {
      addGabledEndWalls(writer, item, terrain, bounds);
    }
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
  item: VolumeItem,
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
  renderVolumes: readonly VolumeItem[],
  exposedMap: ReadonlyMap<string, readonly boolean[]>,
  lod1Base: readonly VolumeItem[],
  features: readonly ChunkFeature[],
  terrain: BuiltTerrainChunk,
  bounds: ProjectedBounds,
  lod: number,
): BuildingLodGeometry {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const writer = new BuildingGeometryWriter(centerX, centerZ);
  const detailed = lod === 0;
  const list = detailed ? renderVolumes : lod1Base;

  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (!item) continue;
    if (
      item.feature.landmarkModelPath &&
      /^landmarks\/w\d+\.glb$/.test(item.feature.landmarkModelPath)
    )
      continue;
    const exposed = detailed ? (exposedMap.get(`${item.feature.id ?? ''}:${i}`) ?? []) : [];
    addWalls(writer, item, exposed, terrain, bounds, lod);
    addStylizedRoof(writer, item, terrain, detailed);
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
  baseAnalyzed: readonly VolumeItem[],
  detailVolumes: readonly VolumeItem[],
  exposedLod0Map: ReadonlyMap<string, readonly boolean[]>,
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
  for (const item of baseAnalyzed) {
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
      (landmarkTower ||
        ((item.style.archetype === 'casco_palace' || item.style.isSacred) && roofHash % 7 === 0))
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
  const detailBatches = collectBuildingDetails(
    detailVolumes as readonly AnalyzedBuilding[],
    exposedLod0Map,
    roads,
    terrain,
    bounds,
  );
  return { signs, anchors, detailBatches, models, storks };
}

export function buildBuildingChunk(
  features: readonly ChunkFeature[],
  terrain: BuiltTerrainChunk,
  bounds: ProjectedBounds,
): BuiltBuildingChunk {
  const baseAnalyzed: VolumeItem[] = [];
  for (const feature of features) {
    if (feature.featureType !== 'building' || !feature.points || feature.points.length < 3)
      continue;
    const item = buildFootprint(feature, clipToBounds(feature.points, bounds), feature.points);
    if (item) baseAnalyzed.push(item);
  }

  const { mainVolumes, setbackVolumes } = expandRenderVolumes(baseAnalyzed, bounds);
  const allLod0Volumes = [...mainVolumes, ...setbackVolumes];
  const exposedLod0Map = new Map<string, readonly boolean[]>();
  const exposedByVolumeIndex = new Map<string, readonly boolean[]>();
  for (let i = 0; i < allLod0Volumes.length; i += 1) {
    const vol = allLod0Volumes[i];
    if (!vol) continue;
    const neighbors = vol.baseElevationOffset ? [] : mainVolumes;
    const exp = computeExposedEdges(vol, neighbors, vol.wallHeight - 0.35);
    exposedLod0Map.set(`${vol.feature.id ?? ''}:${i}`, exp);
    exposedByVolumeIndex.set(`${vol.feature.id ?? ''}#${i}`, exp);
  }

  const levels = [0, 1, 2].map((lod) =>
    buildLod(allLod0Volumes, exposedLod0Map, baseAnalyzed, features, terrain, bounds, lod),
  );
  const detailVolumes = allLod0Volumes.map((vol, i) => ({
    ...vol,
    detailKey: `${vol.feature.id ?? ''}#${i}`,
  }));
  const extras = buildExtras(
    baseAnalyzed,
    detailVolumes,
    exposedByVolumeIndex,
    features,
    terrain,
    bounds,
  );
  const colliderWriter = new BuildingGeometryWriter(
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  );
  for (const item of baseAnalyzed) addWalls(colliderWriter, item, [], terrain, bounds, 2, true);
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
