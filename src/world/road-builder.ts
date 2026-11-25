import type {
  BuiltRoadChunk,
  BuiltTerrainChunk,
  ChunkFeature,
  ProjectedBounds,
  RoadPropBatch,
  RoadPropKind,
  RoadSurfaceStyle,
} from './types';
import {
  RoadGeometryBuilder,
  roadStyle,
  roadWidth,
  sampleHeight,
  smoothRoadCenterline,
  sidewalkSides,
  type RoadPoint,
} from './road-geometry';
import { addCrossingAndControlMarkings, addLaneMarkings } from './road-markings';

const CURB_WIDTH = 0.2;
const SIDEWALK_WIDTH = 1.65;
const ROAD_LIFT = 0.055;

export function buildRoadChunk(
  features: readonly ChunkFeature[],
  terrain: BuiltTerrainChunk,
  bounds: ProjectedBounds,
): BuiltRoadChunk {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const roads = features.filter(
    (feature) =>
      (feature.featureType === 'road' || feature.featureType === 'pedestrian') &&
      feature.points &&
      feature.points.length >= 2,
  );
  const props = features.filter((feature) => feature.featureType === 'prop');
  const builders = new Map<Exclude<RoadSurfaceStyle, 'marking'>, RoadGeometryBuilder>();
  const builderFor = (style: Exclude<RoadSurfaceStyle, 'marking'>): RoadGeometryBuilder => {
    let builder = builders.get(style);
    if (!builder) {
      builder = new RoadGeometryBuilder(style, terrain, centerX, centerZ);
      builders.set(style, builder);
    }
    return builder;
  };

  for (const road of roads) {
    const centerline = smoothRoadCenterline(road.points ?? []);
    if (centerline.length < 2) continue;
    const width = roadWidth(road);
    const lift = road.tunnel ? ROAD_LIFT + 0.015 : ROAD_LIFT;
    const offsetAt = road.bridge ? bridgeOffset(centerline) : undefined;
    if (road.featureType === 'pedestrian' && road.area) {
      builderFor(roadStyle(road)).addPolygon(
        road.points ?? [],
        bounds,
        lift,
        `${road.id ?? 'pedestrian'}:area`,
      );
      continue;
    }
    addCorridor(
      builderFor(road.tunnel ? 'asphalt' : roadStyle(road)),
      centerline,
      width,
      bounds,
      lift,
      `${road.id ?? 'road'}:surface`,
      offsetAt,
    );
    for (const side of sidewalkSides(road)) {
      const sidewalk =
        side > 0
          ? ([width / 2 + CURB_WIDTH, width / 2 + CURB_WIDTH + SIDEWALK_WIDTH] as const)
          : ([-width / 2 - CURB_WIDTH - SIDEWALK_WIDTH, -width / 2 - CURB_WIDTH] as const);
      addCorridor(
        builderFor('sidewalk'),
        centerline,
        SIDEWALK_WIDTH,
        bounds,
        lift + 0.15,
        `${road.id ?? 'road'}:sidewalk:${side}`,
        offsetAt,
        sidewalk,
      );
      const curb =
        side > 0
          ? ([width / 2, width / 2 + CURB_WIDTH] as const)
          : ([-width / 2 - CURB_WIDTH, -width / 2] as const);
      addCorridor(
        builderFor('concrete'),
        centerline,
        CURB_WIDTH,
        bounds,
        lift + 0.075,
        `${road.id ?? 'road'}:curb:${side}`,
        offsetAt,
        curb,
      );
    }
    if (road.highway === 'steps')
      addStairTreads(builderFor(roadStyle(road)), centerline, width, terrain, bounds, road);
  }

  addIntersectionPatches(roads, builders, builderFor, bounds);
  const markingBuilder = new RoadGeometryBuilder('marking', terrain, centerX, centerZ);
  addLaneMarkings(markingBuilder, roads, terrain, bounds);
  addCrossingAndControlMarkings(markingBuilder, roads, props, bounds);
  const surfaces = [...builders.values()]
    .map((builder) => builder.build())
    .filter((geometry) => geometry.indices.length > 0);
  const markings = markingBuilder.build();
  const collider = mergeSurfaces(surfaces);
  const batches = buildPropBatches(props, terrain, centerX, centerZ);
  return {
    surfaces,
    markings,
    colliderPositions: collider.positions,
    colliderIndices: collider.indices,
    props: batches,
    triangleCount: [...surfaces, markings].reduce(
      (sum, surface) => sum + surface.indices.length / 3,
      0,
    ),
  };
}

function addCorridor(
  builder: RoadGeometryBuilder,
  line: readonly RoadPoint[],
  width: number,
  bounds: ProjectedBounds,
  lift: number,
  seed: string,
  offsetAt?: (point: RoadPoint) => number,
  sideRange?: readonly [number, number],
): void {
  const leftOffset = sideRange?.[1] ?? width / 2;
  const rightOffset = sideRange?.[0] ?? -width / 2;
  const left = offsetPolyline(line, leftOffset);
  const right = offsetPolyline(line, rightOffset);
  for (let index = 0; index < line.length - 1; index += 1) {
    const a = left[index];
    const b = left[index + 1];
    const c = right[index + 1];
    const d = right[index];
    if (!a || !b || !c || !d) continue;
    const polygon = [a, b, c, d];
    if (offsetAt) builder.addPolygonAtHeight(polygon, bounds, lift, seed, offsetAt);
    else builder.addPolygon(polygon, bounds, lift, seed);
  }
}

function offsetPolyline(line: readonly RoadPoint[], offset: number): RoadPoint[] {
  return line.map((point, index) => {
    const previous = line[Math.max(0, index - 1)] ?? point;
    const next = line[Math.min(line.length - 1, index + 1)] ?? point;
    const previousLength = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    const nextLength = Math.hypot(next[0] - point[0], next[1] - point[1]);
    const before: RoadPoint =
      previousLength > 1e-4
        ? [(point[0] - previous[0]) / previousLength, (point[1] - previous[1]) / previousLength]
        : [0, 0];
    const after: RoadPoint =
      nextLength > 1e-4
        ? [(next[0] - point[0]) / nextLength, (next[1] - point[1]) / nextLength]
        : before;
    const normalBefore: RoadPoint = [-before[1], before[0]];
    const normalAfter: RoadPoint = [-after[1], after[0]];
    const sumX = normalBefore[0] + normalAfter[0];
    const sumZ = normalBefore[1] + normalAfter[1];
    const sumLength = Math.hypot(sumX, sumZ);
    if (sumLength < 1e-4)
      return [point[0] + normalAfter[0] * offset, point[1] + normalAfter[1] * offset];
    const bisector: RoadPoint = [sumX / sumLength, sumZ / sumLength];
    const denominator = Math.max(
      0.5,
      Math.abs(bisector[0] * normalAfter[0] + bisector[1] * normalAfter[1]),
    );
    const miter =
      Math.min(Math.abs(offset) / denominator, Math.abs(offset) * 2) * Math.sign(offset);
    return [point[0] + bisector[0] * miter, point[1] + bisector[1] * miter];
  });
}

function bridgeOffset(line: readonly RoadPoint[]): (point: RoadPoint) => number {
  const lengths: number[] = [0];
  for (let index = 0; index < line.length - 1; index += 1) {
    const a = line[index];
    const b = line[index + 1];
    lengths.push((lengths.at(-1) ?? 0) + (a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0));
  }
  const total = lengths.at(-1) ?? 0;
  return (point) => {
    let nearestDistance = Infinity;
    let chainage = 0;
    for (let index = 0; index < line.length - 1; index += 1) {
      const a = line[index];
      const b = line[index + 1];
      if (!a || !b) continue;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const lengthSquared = dx * dx + dz * dz;
      const t =
        lengthSquared < 1e-8
          ? 0
          : Math.max(
              0,
              Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSquared),
            );
      const distance = Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dz * t);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        chainage = (lengths[index] ?? 0) + Math.sqrt(lengthSquared) * t;
      }
    }
    return Math.min(1.8, chainage * 0.12, Math.max(0, total - chainage) * 0.12);
  };
}

function addStairTreads(
  builder: RoadGeometryBuilder,
  line: readonly RoadPoint[],
  width: number,
  terrain: BuiltTerrainChunk,
  bounds: ProjectedBounds,
  road: ChunkFeature,
): void {
  const distances = cumulativeDistances(line);
  const total = distances.at(-1) ?? 0;
  if (total < 0.4) return;
  const step = 0.32;
  for (let distance = 0, index = 0; distance < total; distance += step, index += 1) {
    const start = pointAtDistance(line, distances, distance);
    const end = pointAtDistance(line, distances, Math.min(total, distance + step - 0.035));
    const segment = pointAtDistance(line, distances, Math.min(total, distance + step));
    if (!start || !end || !segment) continue;
    const directionLength = Math.hypot(segment[0] - start[0], segment[1] - start[1]);
    if (directionLength < 0.03) continue;
    const tangent: RoadPoint = [
      (segment[0] - start[0]) / directionLength,
      (segment[1] - start[1]) / directionLength,
    ];
    const normal: RoadPoint = [-tangent[1], tangent[0]];
    const elevation =
      sampleHeight(terrain, start[0], start[1]) +
      ROAD_LIFT +
      0.02 +
      (distance / total) * inclineRise(road, total);
    const polygon: RoadPoint[] = [
      [start[0] + (normal[0] * width) / 2, start[1] + (normal[1] * width) / 2],
      [end[0] + (normal[0] * width) / 2, end[1] + (normal[1] * width) / 2],
      [end[0] - (normal[0] * width) / 2, end[1] - (normal[1] * width) / 2],
      [start[0] - (normal[0] * width) / 2, start[1] - (normal[1] * width) / 2],
    ];
    builder.addFlatPolygon(polygon, elevation, bounds, `${road.id ?? 'steps'}:tread:${index}`);
  }
}

function inclineRise(road: ChunkFeature, total: number): number {
  const incline = road.incline?.toLowerCase() ?? '';
  if (incline === 'up') return total * 0.08;
  if (incline === 'down') return -total * 0.08;
  const percent = Number.parseFloat(incline.replace('%', ''));
  return Number.isFinite(percent) ? (total * percent) / 100 : 0;
}

function cumulativeDistances(line: readonly RoadPoint[]): number[] {
  const result = [0];
  for (let index = 0; index < line.length - 1; index += 1) {
    const a = line[index];
    const b = line[index + 1];
    result.push((result.at(-1) ?? 0) + (a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0));
  }
  return result;
}

function pointAtDistance(
  line: readonly RoadPoint[],
  distances: readonly number[],
  distance: number,
): RoadPoint | undefined {
  for (let index = 0; index < line.length - 1; index += 1) {
    const start = distances[index] ?? 0;
    const end = distances[index + 1] ?? start;
    if (distance > end && index < line.length - 2) continue;
    const a = line[index];
    const b = line[index + 1];
    if (!a || !b) continue;
    const t = end - start < 1e-6 ? 0 : Math.max(0, Math.min(1, (distance - start) / (end - start)));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  return line.at(-1);
}

function addIntersectionPatches(
  roads: readonly ChunkFeature[],
  builders: Map<Exclude<RoadSurfaceStyle, 'marking'>, RoadGeometryBuilder>,
  builderFor: (style: Exclude<RoadSurfaceStyle, 'marking'>) => RoadGeometryBuilder,
  bounds: ProjectedBounds,
): void {
  const nodes = new Map<
    string,
    {
      point: RoadPoint;
      directions: Set<string>;
      radius: number;
      style: Exclude<RoadSurfaceStyle, 'marking'>;
    }
  >();
  for (const road of roads) {
    const points = road.points ?? [];
    const refs = road.nodeIds ?? [];
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      if (!point) continue;
      const nodeId =
        refs.length === points.length
          ? `n${refs[index]}`
          : `${Math.round(point[0] * 2)}:${Math.round(point[1] * 2)}`;
      const node = nodes.get(nodeId) ?? {
        point,
        directions: new Set<string>(),
        radius: roadWidth(road) / 2 + 0.35,
        style: roadStyle(road),
      };
      node.radius = Math.max(node.radius, roadWidth(road) / 2 + 0.35);
      for (const adjacent of [points[index - 1], points[index + 1]]) {
        if (!adjacent) continue;
        const dx = adjacent[0] - point[0];
        const dz = adjacent[1] - point[1];
        const length = Math.hypot(dx, dz);
        if (length > 0.1)
          node.directions.add(
            `${Math.round((dx / length) * 10)}:${Math.round((dz / length) * 10)}`,
          );
      }
      nodes.set(nodeId, node);
    }
  }
  for (const node of nodes.values()) {
    if (node.directions.size < 3) continue;
    const builder = builders.get(node.style) ?? builderFor(node.style);
    const polygon: RoadPoint[] = Array.from({ length: 16 }, (_, index) => {
      const angle = (index * Math.PI * 2) / 16;
      return [
        node.point[0] + Math.cos(angle) * node.radius,
        node.point[1] + Math.sin(angle) * node.radius,
      ];
    });
    builder.addPolygon(polygon, bounds, ROAD_LIFT + 0.025, 'intersection');
  }
}

function classifyTreeVariant(prop: ChunkFeature): RoadPropKind {
  if (prop.treeSpecies) {
    return `tree_${prop.treeSpecies}` as RoadPropKind;
  }
  const [x, z] = prop.position ?? [0, 0];
  const distPlaza = Math.hypot(x, z);
  const hash = [...(prop.id ?? `${x.toFixed(0)}:${z.toFixed(0)}`)].reduce(
    (acc, ch) => (acc * 33 + ch.charCodeAt(0)) >>> 0,
    17,
  );
  // Cánovas boulevard corridor (~[-850..-280, -800..-220]) showcases palms and plane trees
  if (x >= -850 && x <= -280 && z >= -800 && z <= -220) {
    const roll = hash % 10;
    if (roll < 3) return 'tree_palm';
    if (roll < 7) return 'tree_deciduous';
    return 'tree_oak';
  }
  // Historic old town plazas: holm oaks and cypresses
  if (distPlaza <= 280) {
    const roll = hash % 10;
    if (roll < 3) return 'tree_cypress';
    if (roll < 7) return 'tree_oak';
    return 'tree_deciduous';
  }
  // Outer avenues, parks & residential zones: pines, deciduous plane trees, holm oaks
  const roll = hash % 10;
  if (roll < 4) return 'tree_deciduous';
  if (roll < 7) return 'tree_oak';
  return 'tree_pine';
}

function resolvePropKind(prop: ChunkFeature): RoadPropKind {
  if (prop.kind === 'traffic_sign' && (prop.trafficSign ?? '').includes('206')) return 'give_way';
  if (prop.kind === 'tree') return classifyTreeVariant(prop);
  if (prop.kind === 'bus_stop' || prop.kind === 'shelter') return 'bus_shelter';
  if (prop.kind === 'scrub') return 'shrub';
  if (prop.kind === 'street_lamp') {
    const [x, z] = prop.position ?? [0, 0];
    return Math.hypot(x, z) > 260 ? 'street_lamp_modern' : 'street_lamp';
  }
  return prop.kind as RoadPropKind;
}

function buildPropBatches(
  props: readonly ChunkFeature[],
  terrain: BuiltTerrainChunk,
  centerX: number,
  centerZ: number,
): RoadPropBatch[] {
  const supported = new Map<RoadPropKind, { positions: number[]; headings: number[] }>([
    ['traffic_signals', { positions: [], headings: [] }],
    ['stop', { positions: [], headings: [] }],
    ['give_way', { positions: [], headings: [] }],
    ['street_lamp', { positions: [], headings: [] }],
    ['street_lamp_modern', { positions: [], headings: [] }],
    ['tree', { positions: [], headings: [] }],
    ['tree_deciduous', { positions: [], headings: [] }],
    ['tree_oak', { positions: [], headings: [] }],
    ['tree_pine', { positions: [], headings: [] }],
    ['tree_palm', { positions: [], headings: [] }],
    ['tree_cypress', { positions: [], headings: [] }],
    ['shrub', { positions: [], headings: [] }],
    ['hedge', { positions: [], headings: [] }],
    ['bus_shelter', { positions: [], headings: [] }],
    ['bench', { positions: [], headings: [] }],
    ['waste_basket', { positions: [], headings: [] }],
    ['fountain', { positions: [], headings: [] }],
  ]);
  for (const prop of props) {
    const kind = resolvePropKind(prop);
    const batch = supported.get(kind);
    if (!batch || !prop.position) continue;
    const x = prop.position[0] - centerX;
    const y = sampleHeight(terrain, prop.position[0], prop.position[1]);
    const z = prop.position[1] - centerZ;
    const heading = ((prop.directionDegrees ?? 0) * Math.PI) / 180;
    batch.positions.push(x, y, z);
    batch.headings.push(heading);

    // Pair park benches/trees/bus stops with subtle decorative low-poly shrubs/hedges when chunk has multiple
    if (
      props.length > 25 &&
      (kind === 'tree_oak' || kind === 'bench' || kind === 'fountain') &&
      Math.abs(Math.round(x * 7 + z * 11)) % 4 === 0
    ) {
      const shrubBatch = supported.get('shrub');
      if (shrubBatch) {
        shrubBatch.positions.push(x + 1.35, y, z + 0.9);
        shrubBatch.headings.push(heading + 0.7);
      }
    }
  }
  if (props.length > 25) {
    // Consolidate tiny singleton tree species (<= 3 instances) into the chunk's dominant
    // tree batch so draw calls stay low while preserving multi-species silhouettes.
    const treeKeys: RoadPropKind[] = [
      'tree_deciduous',
      'tree_oak',
      'tree_pine',
      'tree_palm',
      'tree_cypress',
    ];
    let dominantTree: { kind: RoadPropKind; count: number } | undefined;
    for (const tk of treeKeys) {
      const b = supported.get(tk);
      const c = b ? b.headings.length : 0;
      if (c > (dominantTree?.count ?? 0)) dominantTree = { kind: tk, count: c };
    }
    if (dominantTree && dominantTree.count >= 4) {
      const domBatch = supported.get(dominantTree.kind)!;
      for (const tk of treeKeys) {
        if (tk === dominantTree.kind) continue;
        const b = supported.get(tk);
        if (b && b.headings.length > 0 && b.headings.length <= 3) {
          domBatch.positions.push(...b.positions);
          domBatch.headings.push(...b.headings);
          b.positions.length = 0;
          b.headings.length = 0;
        }
      }
    }
    const streetLampLegacy = supported.get('street_lamp');
    const streetLampModern = supported.get('street_lamp_modern');
    if (
      streetLampLegacy &&
      streetLampModern &&
      streetLampLegacy.headings.length > 0 &&
      streetLampModern.headings.length > 0
    ) {
      if (streetLampLegacy.headings.length <= 2) {
        streetLampModern.positions.push(...streetLampLegacy.positions);
        streetLampModern.headings.push(...streetLampLegacy.headings);
        streetLampLegacy.positions.length = 0;
        streetLampLegacy.headings.length = 0;
      } else if (streetLampModern.headings.length <= 2) {
        streetLampLegacy.positions.push(...streetLampModern.positions);
        streetLampLegacy.headings.push(...streetLampModern.headings);
        streetLampModern.positions.length = 0;
        streetLampModern.headings.length = 0;
      }
    }
  }
  return [...supported]
    .filter(([, batch]) => batch.positions.length > 0)
    .map(([kind, batch]) => ({
      kind,
      positions: Float32Array.from(batch.positions),
      headings: Float32Array.from(batch.headings),
    }));
}

function mergeSurfaces(surfaces: readonly BuiltRoadChunk['surfaces'][number][]): {
  positions: Float32Array;
  indices: Uint32Array;
} {
  const positionCount = surfaces.reduce((sum, surface) => sum + surface.positions.length, 0);
  const indexCount = surfaces.reduce((sum, surface) => sum + surface.indices.length, 0);
  const positions = new Float32Array(positionCount);
  const indices = new Uint32Array(indexCount);
  let vertexOffset = 0;
  let positionOffset = 0;
  let indexOffset = 0;
  for (const surface of surfaces) {
    positions.set(surface.positions, positionOffset);
    for (let index = 0; index < surface.indices.length; index += 1)
      indices[indexOffset + index] = (surface.indices[index] ?? 0) + vertexOffset;
    positionOffset += surface.positions.length;
    vertexOffset += surface.positions.length / 3;
    indexOffset += surface.indices.length;
  }
  return { positions, indices };
}
