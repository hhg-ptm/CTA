import { BuildingGeometryWriter, type BuildingColor, type BuildingUv } from './building-geometry';
import { resolveLandmarkModelPath } from './custom-landmarks';
import { sampleHeight, type RoadPoint, type RoadPoint3 } from './road-geometry';
import type { BuiltTerrainChunk, ChunkFeature, ProjectedBounds } from './types';

const STONE: BuildingColor = [0.92, 0.86, 0.73];
const UV: readonly [BuildingUv, BuildingUv, BuildingUv, BuildingUv] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

interface Axis {
  readonly x: number;
  readonly z: number;
}

interface Edge {
  readonly start: RoadPoint;
  readonly end: RoadPoint;
  readonly axis: Axis;
  readonly normal: Axis;
}

function pointInBounds(point: RoadPoint, bounds: ProjectedBounds): boolean {
  return (
    point[0] >= bounds.minX &&
    point[0] < bounds.maxX &&
    point[1] >= bounds.minZ &&
    point[1] < bounds.maxZ
  );
}

function worldPoint(
  center: RoadPoint,
  axis: Axis,
  normal: Axis,
  along: number,
  across: number,
  y: number,
): RoadPoint3 {
  return [
    center[0] + axis.x * along + normal.x * across,
    y,
    center[1] + axis.z * along + normal.z * across,
  ];
}

function westernEndEdge(feature: ChunkFeature): Edge | undefined {
  const points = feature.points;
  if (!points || points.length < 4) return undefined;
  const centroid = points.reduce<RoadPoint>(
    (sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length],
    [0, 0],
  );
  let best: { start: RoadPoint; end: RoadPoint; length: number; west: number } | undefined;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) continue;
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const west = (start[0] + end[0]) / 2;
    if (length < 5.5 || (best && west >= best.west)) continue;
    best = { start, end, length, west };
  }
  if (!best) return undefined;
  const axis = {
    x: (best.end[0] - best.start[0]) / best.length,
    z: (best.end[1] - best.start[1]) / best.length,
  };
  const midpoint: RoadPoint = [
    (best.start[0] + best.end[0]) / 2,
    (best.start[1] + best.end[1]) / 2,
  ];
  const inward = { x: centroid[0] - midpoint[0], z: centroid[1] - midpoint[1] };
  const length = Math.hypot(inward.x, inward.z);
  if (length < 0.01) return undefined;
  return {
    start: best.start,
    end: best.end,
    axis,
    normal: { x: inward.x / length, z: inward.z / length },
  };
}

function addTowerBody(
  writer: BuildingGeometryWriter,
  center: RoadPoint,
  axis: Axis,
  normal: Axis,
  baseY: number,
  lowerSize: number,
  upperSize: number,
  height: number,
): void {
  for (let side = 0; side < 4; side += 1) {
    const firstAngle = (side * Math.PI) / 2;
    const secondAngle = ((side + 1) * Math.PI) / 2;
    const lowerFirst = worldPoint(
      center,
      axis,
      normal,
      (Math.cos(firstAngle) * lowerSize) / 2,
      (Math.sin(firstAngle) * lowerSize) / 2,
      baseY,
    );
    const lowerSecond = worldPoint(
      center,
      axis,
      normal,
      (Math.cos(secondAngle) * lowerSize) / 2,
      (Math.sin(secondAngle) * lowerSize) / 2,
      baseY,
    );
    const upperFirst = worldPoint(
      center,
      axis,
      normal,
      (Math.cos(firstAngle) * upperSize) / 2,
      (Math.sin(firstAngle) * upperSize) / 2,
      baseY + height,
    );
    const upperSecond = worldPoint(
      center,
      axis,
      normal,
      (Math.cos(secondAngle) * upperSize) / 2,
      (Math.sin(secondAngle) * upperSize) / 2,
      baseY + height,
    );
    writer.addQuad('monument_stone', [lowerFirst, lowerSecond, upperSecond, upperFirst], STONE, UV);
  }
}

function addFinial(
  writer: BuildingGeometryWriter,
  center: RoadPoint,
  axis: Axis,
  normal: Axis,
  along: number,
  across: number,
  baseY: number,
): void {
  const tip = worldPoint(center, axis, normal, along, across, baseY + 0.8);
  const ring = [0, 1, 2, 3].map((index) =>
    worldPoint(
      center,
      axis,
      normal,
      along + Math.cos((index * Math.PI) / 2) * 0.22,
      across + Math.sin((index * Math.PI) / 2) * 0.22,
      baseY,
    ),
  );
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    if (current && next)
      writer.addTriangle('monument_stone', [current, next, tip], STONE, [
        [0, 0],
        [1, 0],
        [0.5, 1],
      ]);
  }
}

/** Add the official three-body western tower; proportions and finials are visual estimates pending photo review. */
export function addConcatedralTower(
  writer: BuildingGeometryWriter,
  features: readonly ChunkFeature[],
  terrain: BuiltTerrainChunk,
  bounds: ProjectedBounds,
): void {
  const church = features.find(
    (feature) =>
      feature.featureType === 'building' && feature.id === 'w385037723' && feature.points,
  );
  if (!church?.points || resolveLandmarkModelPath(church)) return;
  const edge = westernEndEdge(church);
  if (!edge) return;
  const midpoint: RoadPoint = [
    (edge.start[0] + edge.end[0]) / 2,
    (edge.start[1] + edge.end[1]) / 2,
  ];
  const center: RoadPoint = [midpoint[0] + edge.normal.x * 2.5, midpoint[1] + edge.normal.z * 2.5];
  if (!pointInBounds(center, bounds)) return;
  const roof =
    sampleHeight(terrain, center[0], center[1]) +
    (church.visualHeightMeters ?? church.heightMeters ?? 15);
  addTowerBody(writer, center, edge.axis, edge.normal, roof, 5.6, 5.4, 3.5);
  addTowerBody(writer, center, edge.axis, edge.normal, roof + 3.5, 5.4, 5.0, 3.5);
  addTowerBody(writer, center, edge.axis, edge.normal, roof + 7, 5.0, 4.6, 4.2);
  const cap = [
    worldPoint(center, edge.axis, edge.normal, -2.3, -2.3, roof + 11.2),
    worldPoint(center, edge.axis, edge.normal, 2.3, -2.3, roof + 11.2),
    worldPoint(center, edge.axis, edge.normal, 2.3, 2.3, roof + 11.2),
    worldPoint(center, edge.axis, edge.normal, -2.3, 2.3, roof + 11.2),
  ] as const;
  writer.addQuad('monument_stone', cap, STONE, UV);
  for (const along of [-1.85, 1.85])
    for (const across of [-1.85, 1.85])
      addFinial(writer, center, edge.axis, edge.normal, along, across, roof + 11.2);
}
