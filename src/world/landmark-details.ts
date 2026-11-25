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
const PIER_WIDTH_METERS = 0.38;
const PIER_DEPTH_METERS = 0.32;
const PIER_HEIGHT_METERS = 2.55;
const ARCH_DEPTH_METERS = 0.3;
const PORTAL_DEPTH_METERS = 0.38;

interface Axis {
  readonly x: number;
  readonly z: number;
}

function inBounds(point: RoadPoint, bounds: ProjectedBounds): boolean {
  return (
    point[0] >= bounds.minX &&
    point[0] < bounds.maxX &&
    point[1] >= bounds.minZ &&
    point[1] < bounds.maxZ
  );
}

function plazaCenter(features: readonly ChunkFeature[], name: string): RoadPoint | undefined {
  const plaza = features.find(
    (feature) =>
      feature.featureType === 'surface' &&
      feature.name === name &&
      feature.points &&
      feature.points.length > 2,
  );
  if (!plaza?.points) return undefined;
  const points = plaza.points;
  const count =
    points.length > 3 &&
    points[0]?.[0] === points.at(-1)?.[0] &&
    points[0]?.[1] === points.at(-1)?.[1]
      ? points.length - 1
      : points.length;
  if (count < 3) return undefined;
  const sum = points
    .slice(0, count)
    .reduce<RoadPoint>(
      (result, point) => [result[0] + point[0] / count, result[1] + point[1] / count],
      [0, 0],
    );
  return [sum[0], sum[1]];
}

function plazaFacingEdge(
  feature: ChunkFeature,
  center: RoadPoint,
):
  | {
      readonly start: RoadPoint;
      readonly end: RoadPoint;
      readonly length: number;
      readonly axis: Axis;
      readonly normal: Axis;
    }
  | undefined {
  const points = feature.points;
  if (!points || points.length < 4) return undefined;
  let best: { start: RoadPoint; end: RoadPoint; length: number; distance: number } | undefined;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) continue;
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const length = Math.hypot(dx, dz);
    if (length < 2.5) continue;
    const midpoint: RoadPoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    const distance = Math.hypot(center[0] - midpoint[0], center[1] - midpoint[1]);
    if (!best || distance < best.distance) best = { start, end, length, distance };
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
  const towardPlaza = { x: center[0] - midpoint[0], z: center[1] - midpoint[1] };
  const normal: Axis =
    Math.hypot(towardPlaza.x, towardPlaza.z) > 0
      ? {
          x: towardPlaza.x / Math.hypot(towardPlaza.x, towardPlaza.z),
          z: towardPlaza.z / Math.hypot(towardPlaza.x, towardPlaza.z),
        }
      : { x: -axis.z, z: axis.x };
  return { start: best.start, end: best.end, length: best.length, axis, normal };
}

function framePoint(
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

function addPier(
  writer: BuildingGeometryWriter,
  center: RoadPoint,
  axis: Axis,
  normal: Axis,
  y: number,
): void {
  const halfWidth = PIER_WIDTH_METERS / 2;
  const halfDepth = PIER_DEPTH_METERS / 2;
  const bottom = [
    framePoint(center, axis, normal, -halfWidth, -halfDepth, y),
    framePoint(center, axis, normal, halfWidth, -halfDepth, y),
    framePoint(center, axis, normal, halfWidth, halfDepth, y),
    framePoint(center, axis, normal, -halfWidth, halfDepth, y),
  ] as const;
  const top = bottom.map(
    (point) => [point[0], point[1] + PIER_HEIGHT_METERS, point[2]] as RoadPoint3,
  );
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4;
    const first = bottom[index];
    const second = bottom[next];
    const firstTop = top[index];
    const secondTop = top[next];
    if (first && second && firstTop && secondTop)
      writer.addQuad('monument_stone', [first, second, secondTop, firstTop], STONE, UV);
  }
}

function addArch(
  writer: BuildingGeometryWriter,
  center: RoadPoint,
  axis: Axis,
  normal: Axis,
  y: number,
  innerRadius: number,
  outerRadius: number,
  segments: number,
): void {
  for (let index = 0; index < segments; index += 1) {
    const firstAngle = (Math.PI * index) / segments;
    const secondAngle = (Math.PI * (index + 1)) / segments;
    const firstInner = framePoint(
      center,
      axis,
      normal,
      Math.cos(firstAngle) * innerRadius,
      0.04,
      y + Math.sin(firstAngle) * innerRadius,
    );
    const secondInner = framePoint(
      center,
      axis,
      normal,
      Math.cos(secondAngle) * innerRadius,
      0.04,
      y + Math.sin(secondAngle) * innerRadius,
    );
    const firstOuter = framePoint(
      center,
      axis,
      normal,
      Math.cos(firstAngle) * outerRadius,
      0.04,
      y + Math.sin(firstAngle) * outerRadius,
    );
    const secondOuter = framePoint(
      center,
      axis,
      normal,
      Math.cos(secondAngle) * outerRadius,
      0.04,
      y + Math.sin(secondAngle) * outerRadius,
    );
    const farFirstInner = framePoint(
      center,
      axis,
      normal,
      Math.cos(firstAngle) * innerRadius,
      ARCH_DEPTH_METERS,
      y + Math.sin(firstAngle) * innerRadius,
    );
    const farSecondInner = framePoint(
      center,
      axis,
      normal,
      Math.cos(secondAngle) * innerRadius,
      ARCH_DEPTH_METERS,
      y + Math.sin(secondAngle) * innerRadius,
    );
    const farFirstOuter = framePoint(
      center,
      axis,
      normal,
      Math.cos(firstAngle) * outerRadius,
      ARCH_DEPTH_METERS,
      y + Math.sin(firstAngle) * outerRadius,
    );
    const farSecondOuter = framePoint(
      center,
      axis,
      normal,
      Math.cos(secondAngle) * outerRadius,
      ARCH_DEPTH_METERS,
      y + Math.sin(secondAngle) * outerRadius,
    );
    writer.addQuad('monument_stone', [firstInner, firstOuter, secondOuter, secondInner], STONE, UV);
    writer.addQuad(
      'monument_stone',
      [farFirstOuter, farFirstInner, farSecondInner, farSecondOuter],
      STONE,
      UV,
    );
    writer.addQuad(
      'monument_stone',
      [firstOuter, farFirstOuter, farSecondOuter, secondOuter],
      STONE,
      UV,
    );
  }
}

function addPointedPortal(
  writer: BuildingGeometryWriter,
  center: RoadPoint,
  axis: Axis,
  normal: Axis,
  y: number,
): void {
  const depth = PORTAL_DEPTH_METERS;
  const innerHalfWidth = 1.0;
  const outerHalfWidth = 1.27;
  const springHeight = 2.0;
  const apexHeight = 3.25;
  const frontInnerLeftBase = framePoint(center, axis, normal, -innerHalfWidth, 0.08, y);
  const frontOuterLeftBase = framePoint(center, axis, normal, -outerHalfWidth, 0.08, y);
  const frontInnerRightBase = framePoint(center, axis, normal, innerHalfWidth, 0.08, y);
  const frontOuterRightBase = framePoint(center, axis, normal, outerHalfWidth, 0.08, y);
  const frontInnerLeftSpring = framePoint(
    center,
    axis,
    normal,
    -innerHalfWidth,
    0.08,
    y + springHeight,
  );
  const frontOuterLeftSpring = framePoint(
    center,
    axis,
    normal,
    -outerHalfWidth,
    0.08,
    y + springHeight,
  );
  const frontInnerRightSpring = framePoint(
    center,
    axis,
    normal,
    innerHalfWidth,
    0.08,
    y + springHeight,
  );
  const frontOuterRightSpring = framePoint(
    center,
    axis,
    normal,
    outerHalfWidth,
    0.08,
    y + springHeight,
  );
  const frontInnerApex = framePoint(center, axis, normal, 0, 0.08, y + apexHeight);
  const frontOuterApex = framePoint(center, axis, normal, 0, 0.08, y + apexHeight + 0.27);
  const back = (point: RoadPoint3): RoadPoint3 =>
    framePoint(
      center,
      axis,
      normal,
      (point[0] - center[0]) * axis.x + (point[2] - center[1]) * axis.z,
      depth,
      point[1],
    );
  const backInnerLeftBase = back(frontInnerLeftBase);
  const backOuterLeftBase = back(frontOuterLeftBase);
  const backInnerRightBase = back(frontInnerRightBase);
  const backOuterRightBase = back(frontOuterRightBase);
  const backInnerLeftSpring = back(frontInnerLeftSpring);
  const backOuterLeftSpring = back(frontOuterLeftSpring);
  const backInnerRightSpring = back(frontInnerRightSpring);
  const backOuterRightSpring = back(frontOuterRightSpring);
  const backInnerApex = back(frontInnerApex);
  const backOuterApex = back(frontOuterApex);
  const quads: readonly (readonly [RoadPoint3, RoadPoint3, RoadPoint3, RoadPoint3])[] = [
    [frontInnerLeftBase, frontOuterLeftBase, frontOuterLeftSpring, frontInnerLeftSpring],
    [frontInnerLeftSpring, frontOuterLeftSpring, frontOuterApex, frontInnerApex],
    [frontInnerRightBase, frontOuterRightBase, frontOuterRightSpring, frontInnerRightSpring],
    [frontInnerRightSpring, frontOuterRightSpring, frontOuterApex, frontInnerApex],
    [backOuterLeftBase, backInnerLeftBase, backInnerLeftSpring, backOuterLeftSpring],
    [backOuterLeftSpring, backInnerLeftSpring, backInnerApex, backOuterApex],
    [backOuterRightBase, backInnerRightBase, backInnerRightSpring, backOuterRightSpring],
    [backOuterRightSpring, backInnerRightSpring, backInnerApex, backOuterApex],
    [frontOuterLeftBase, backOuterLeftBase, backOuterLeftSpring, frontOuterLeftSpring],
    [frontOuterLeftSpring, backOuterLeftSpring, backOuterApex, frontOuterApex],
    [frontOuterRightBase, backOuterRightBase, backOuterRightSpring, frontOuterRightSpring],
    [frontOuterRightSpring, backOuterRightSpring, backOuterApex, frontOuterApex],
  ];
  for (const quad of quads) writer.addQuad('monument_stone', quad, STONE, UV);
}

/** Place the documented pointed portal on the Concatedral side facing Plaza Mayor. */
export function addConcatedralPortal(
  writer: BuildingGeometryWriter,
  features: readonly ChunkFeature[],
  terrain: BuiltTerrainChunk,
  bounds: ProjectedBounds,
): void {
  const plaza = plazaCenter(features, 'Plaza Mayor');
  if (!plaza) return;
  const church = features.find(
    (feature) =>
      feature.featureType === 'building' && feature.id === 'w385037723' && feature.points,
  );
  if (!church?.points || resolveLandmarkModelPath(church)) return;
  const edge = plazaFacingEdge(church, plaza);
  if (!edge || edge.length < 4) return;
  const center: RoadPoint = [(edge.start[0] + edge.end[0]) / 2, (edge.start[1] + edge.end[1]) / 2];
  if (!inBounds(center, bounds)) return;
  addPointedPortal(
    writer,
    center,
    edge.axis,
    edge.normal,
    sampleHeight(terrain, center[0], center[1]),
  );
}

function addSquareTower(
  writer: BuildingGeometryWriter,
  center: RoadPoint,
  axis: Axis,
  normal: Axis,
  baseY: number,
  white: BuildingColor,
): void {
  const size = 1.55;
  const half = size / 2;
  const corners = [
    framePoint(center, axis, normal, -half, -half, baseY),
    framePoint(center, axis, normal, half, -half, baseY),
    framePoint(center, axis, normal, half, half, baseY),
    framePoint(center, axis, normal, -half, half, baseY),
  ] as const;
  const top = corners.map((point) => [point[0], point[1] + 7.5, point[2]] as RoadPoint3);
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4;
    const lower = corners[index];
    const lowerNext = corners[next];
    const upper = top[index];
    const upperNext = top[next];
    if (lower && lowerNext && upper && upperNext)
      writer.addQuad('monument_stone', [lower, lowerNext, upperNext, upper], white, UV);
  }
  const apex: RoadPoint3 = [center[0], baseY + 9, center[1]];
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4;
    const first = top[index];
    const second = top[next];
    if (first && second)
      writer.addTriangle('monument_stone', [first, second, apex], white, [
        [0, 0],
        [1, 0],
        [0.5, 1],
      ]);
  }
}

/** Add paired white tower masses; all dimensions are visual defaults pending photo review. */
export function addSanFranciscoTowers(
  writer: BuildingGeometryWriter,
  features: readonly ChunkFeature[],
  terrain: BuiltTerrainChunk,
  bounds: ProjectedBounds,
): void {
  const plaza = plazaCenter(features, 'Plaza de San Jorge');
  if (!plaza) return;
  const church = features.find(
    (feature) =>
      feature.featureType === 'building' && feature.id === 'w385037722' && feature.points,
  );
  if (!church?.points) return;
  const edge = plazaFacingEdge(church, plaza);
  if (!edge || edge.length < 5.5) return;
  const baseHeight = church.visualHeightMeters ?? church.heightMeters ?? 6;
  const color: BuildingColor = [0.96, 0.94, 0.88];
  for (const fraction of [0.18, 0.82]) {
    const center: RoadPoint = [
      edge.start[0] + (edge.end[0] - edge.start[0]) * fraction,
      edge.start[1] + (edge.end[1] - edge.start[1]) * fraction,
    ];
    if (!inBounds(center, bounds)) continue;
    addSquareTower(
      writer,
      center,
      edge.axis,
      edge.normal,
      sampleHeight(terrain, center[0], center[1]) + baseHeight,
      color,
    );
  }
}

/** Add a conservative arcade relief to the Ayuntamiento frontage documented in Plaza Mayor. */
export function addPlazaMayorArcade(
  writer: BuildingGeometryWriter,
  features: readonly ChunkFeature[],
  terrain: BuiltTerrainChunk,
  bounds: ProjectedBounds,
  lod: number,
): void {
  const plaza = plazaCenter(features, 'Plaza Mayor');
  if (!plaza) return;
  const townHall = features.find(
    (feature) => feature.featureType === 'building' && feature.id === 'w22358108' && feature.points,
  );
  if (!townHall?.points || resolveLandmarkModelPath(townHall)) return;
  const edge = plazaFacingEdge(townHall, plaza);
  if (!edge) return;
  const edgeCenter: RoadPoint = [
    (edge.start[0] + edge.end[0]) / 2,
    (edge.start[1] + edge.end[1]) / 2,
  ];
  if (!inBounds(edgeCenter, bounds)) return;
  const count = Math.max(1, Math.floor(edge.length / 3.1));
  const spacing = edge.length / count;
  const segments = lod === 0 ? 8 : lod === 1 ? 4 : 2;
  for (let index = 0; index < count; index += 1) {
    const distance = (index + 0.5) * spacing;
    const center: RoadPoint = [
      edge.start[0] + edge.axis.x * distance,
      edge.start[1] + edge.axis.z * distance,
    ];
    const ground = sampleHeight(terrain, center[0], center[1]);
    const innerRadius = Math.max(0.8, spacing / 2 - PIER_WIDTH_METERS / 2);
    addArch(
      writer,
      center,
      edge.axis,
      edge.normal,
      ground + PIER_HEIGHT_METERS,
      innerRadius,
      innerRadius + 0.26,
      segments,
    );
  }
  for (let index = 0; index <= count; index += 1) {
    const distance = index * spacing;
    const support: RoadPoint = [
      edge.start[0] + edge.axis.x * distance,
      edge.start[1] + edge.axis.z * distance,
    ];
    const ground = sampleHeight(terrain, support[0], support[1]);
    addPier(writer, support, edge.axis, edge.normal, ground);
  }
}
