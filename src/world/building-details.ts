import {
  computeEdgeBayLayout,
  DETAIL_BUDGET_CONFIGS,
  isTowerFeature,
  selectMiradorBay,
  wantsBalconyOnBayFloor,
  type BuildingStyleSpec,
  type DetailBudgetConfig,
} from './building-styles';
import { sampleHeight, type RoadPoint } from './road-geometry';
import type {
  BuildingDetailBatch,
  BuildingDetailKind,
  BuiltTerrainChunk,
  ChunkFeature,
  ProjectedBounds,
} from './types';

export interface AnalyzedBuilding {
  readonly feature: ChunkFeature;
  readonly detailKey?: string;
  readonly baseElevationOffset?: number;
  readonly points: readonly RoadPoint[];
  readonly centroid: RoadPoint;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly area: number;
  readonly wallHeight: number;
  readonly roofHeight: number;
  readonly shape: 'flat' | 'gabled' | 'hipped';
  readonly floorCount: number;
  readonly style: BuildingStyleSpec;
  readonly seed: number;
}

interface DetailMutableBatch {
  readonly kind: BuildingDetailKind;
  readonly maxLod: 0 | 1;
  readonly positions: number[];
  readonly headings: number[];
  readonly scales: number[];
}

const MAX_INSTANCES: Readonly<Record<BuildingDetailKind, number>> = {
  balcony: 380,
  balcony_modern: 420,
  window_casco: 145,
  window_ensanche: 155,
  window_modern: 155,
  window_awning: 240,
  portal_casco: 180,
  portal_modern: 200,
  shopfront_awning: 220,
  industrial_door: 64,
  pilaster_corner: 96,
  chimney: 240,
  dormer_roof: 130,
  rooftop_penthouse: 110,
  rooftop_hvac: 160,
  rooftop_solar: 120,
  bell_gable: 16,
  corner_turret: 24,
  heraldic_crest: 64,
};

const MID_LOD_ELIGIBLE_KINDS = new Set<BuildingDetailKind>([
  'balcony',
  'balcony_modern',
  'portal_casco',
  'portal_modern',
  'shopfront_awning',
  'chimney',
  'dormer_roof',
  'rooftop_penthouse',
  'bell_gable',
  'corner_turret',
]);

const MAX_LOD: Readonly<Record<BuildingDetailKind, 0 | 1>> = {
  balcony: 0,
  balcony_modern: 0,
  window_casco: 0,
  window_ensanche: 0,
  window_modern: 0,
  window_awning: 0,
  portal_casco: 0,
  portal_modern: 0,
  shopfront_awning: 0,
  industrial_door: 0,
  pilaster_corner: 0,
  chimney: 0,
  dormer_roof: 0,
  rooftop_penthouse: 0,
  rooftop_hvac: 0,
  rooftop_solar: 0,
  bell_gable: 1,
  corner_turret: 1,
  heraldic_crest: 0,
};

const DEDICATED_TOWER_CHURCH_IDS = new Set(['w385037722', 'w385037723']);

function pointInPolygon(x: number, z: number, points: readonly RoadPoint[]): boolean {
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

function inBounds(x: number, z: number, bounds: ProjectedBounds): boolean {
  return x >= bounds.minX && x < bounds.maxX && z >= bounds.minZ && z < bounds.maxZ;
}

function onChunkSliceEdge(a: RoadPoint, b: RoadPoint, bounds: ProjectedBounds): boolean {
  const eps = 0.03;
  return (
    (Math.abs(a[0] - bounds.minX) < eps && Math.abs(b[0] - bounds.minX) < eps) ||
    (Math.abs(a[0] - bounds.maxX) < eps && Math.abs(b[0] - bounds.maxX) < eps) ||
    (Math.abs(a[1] - bounds.minZ) < eps && Math.abs(b[1] - bounds.minZ) < eps) ||
    (Math.abs(a[1] - bounds.maxZ) < eps && Math.abs(b[1] - bounds.maxZ) < eps)
  );
}

export function polygonSignedArea(points: readonly RoadPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a && b) sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum;
}

export function computeExposedEdges(
  building: AnalyzedBuilding,
  allBuildings: readonly AnalyzedBuilding[],
  minBlockingHeight = 0,
): boolean[] {
  const pts = building.points;
  const signedArea = polygonSignedArea(pts);
  const exposed: boolean[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (!a || !b) {
      exposed.push(false);
      continue;
    }
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.25) {
      exposed.push(false);
      continue;
    }
    const nx = signedArea >= 0 ? dz / len : -dz / len;
    const nz = signedArea >= 0 ? -dx / len : dx / len;
    const midX = (a[0] + b[0]) * 0.5;
    const midZ = (a[1] + b[1]) * 0.5;
    let blocked = false;
    for (const probeDist of [0.35, 1.35]) {
      const probeX = midX + nx * probeDist;
      const probeZ = midZ + nz * probeDist;
      for (const other of allBuildings) {
        if (other === building) continue;
        if (other.feature.id === building.feature.id && other.wallHeight < minBlockingHeight) {
          continue;
        }
        if (
          probeX < other.minX - 0.1 ||
          probeX > other.maxX + 0.1 ||
          probeZ < other.minZ - 0.1 ||
          probeZ > other.maxZ + 0.1
        ) {
          continue;
        }
        if (pointInPolygon(probeX, probeZ, other.points)) {
          if (other.wallHeight >= minBlockingHeight) {
            blocked = true;
            break;
          }
        }
      }
      if (blocked) break;
    }
    exposed.push(!blocked);
  }
  return exposed;
}

function roadClassPenalty(road: ChunkFeature): number {
  const hw = (road.highway ?? '').toLowerCase();
  if (!hw || hw === 'primary' || hw === 'secondary' || hw === 'tertiary' || hw === 'residential') {
    return 0;
  }
  if (hw === 'unclassified' || hw === 'pedestrian' || hw === 'living_street') return 0.9;
  if (hw === 'service' || hw === 'track' || hw === 'footway' || hw === 'path' || hw === 'steps') {
    return 8.5;
  }
  return 2.0;
}

function roadProximity(point: RoadPoint, roads: readonly ChunkFeature[]): number {
  let best = Infinity;
  for (const road of roads) {
    const pts = road.points;
    if (!pts) continue;
    const penalty = roadClassPenalty(road);
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a || !b) continue;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz;
      const t =
        l2 < 1e-6
          ? 0
          : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / l2));
      const d = Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dz * t) + penalty;
      if (d < best) best = d;
    }
  }
  return best;
}

function nearestPortalDist(
  point: RoadPoint,
  portalPoints: readonly (readonly [number, number])[] | undefined,
): number {
  if (!portalPoints || portalPoints.length === 0) return Infinity;
  let best = Infinity;
  for (const [px, pz] of portalPoints) {
    const d = Math.hypot(point[0] - px, point[1] - pz);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Identifies the primary front facade edge of a building polygon using Catastro AD portal
 * locations first, then road distance, falling back safely to the longest exposed edge.
 */
export function selectPrimaryStreetEdge(
  pts: readonly RoadPoint[],
  exposed: readonly boolean[],
  roads: readonly ChunkFeature[],
  bounds: ProjectedBounds,
  portalPts: readonly (readonly [number, number])[] | undefined,
  minEdgeMeters: number,
): number {
  let bestStreetEdge = -1;
  let bestEdgeScore = Infinity;
  let bestEdgeLen = 0;

  for (let i = 0; i < pts.length; i += 1) {
    if (!exposed[i]) continue;
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (!a || !b || onChunkSliceEdge(a, b, bounds)) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < Math.max(2.0, minEdgeMeters)) continue;
    const mid: RoadPoint = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
    const portalDist = nearestPortalDist(mid, portalPts);
    const rDist = roadProximity(mid, roads);
    const score = portalDist <= 9.0 ? portalDist * 0.45 : rDist;
    const isCloser =
      score < bestEdgeScore - 0.6 ||
      (score === bestEdgeScore && len > bestEdgeLen) ||
      (Number.isFinite(score) &&
        Number.isFinite(bestEdgeScore) &&
        Math.abs(score - bestEdgeScore) <= 0.6 &&
        len > bestEdgeLen);
    if (bestStreetEdge < 0 || isCloser) {
      bestEdgeScore = score;
      bestStreetEdge = i;
      bestEdgeLen = len;
    }
  }
  return bestStreetEdge;
}

class DetailCollector {
  private readonly batches = new Map<BuildingDetailKind, DetailMutableBatch>();
  private readonly budget: DetailBudgetConfig;

  constructor(budget: DetailBudgetConfig) {
    this.budget = budget;
  }

  push(
    kind: BuildingDetailKind,
    x: number,
    y: number,
    z: number,
    heading: number,
    scale = 1,
  ): boolean {
    let batch = this.batches.get(kind);
    if (!batch) {
      const baseMaxLod = MAX_LOD[kind];
      const maxLod: 0 | 1 =
        baseMaxLod === 1
          ? 1
          : MID_LOD_ELIGIBLE_KINDS.has(kind) && this.budget.balconyMaxLod >= 1
            ? 1
            : 0;
      batch = {
        kind,
        maxLod,
        positions: [],
        headings: [],
        scales: [],
      };
      this.batches.set(kind, batch);
    }
    const maxCount = Math.max(1, Math.round(MAX_INSTANCES[kind] * this.budget.instanceCapScale));
    if (batch.headings.length >= maxCount) return false;
    batch.positions.push(x, y, z);
    batch.headings.push(heading);
    batch.scales.push(scale);
    return true;
  }

  build(): BuildingDetailBatch[] {
    const out: BuildingDetailBatch[] = [];
    for (const batch of this.batches.values()) {
      if (batch.headings.length === 0) continue;
      out.push({
        kind: batch.kind,
        maxLod: batch.maxLod,
        positions: Float32Array.from(batch.positions),
        headings: Float32Array.from(batch.headings),
        scales: Float32Array.from(batch.scales),
      });
    }
    return out;
  }
}

export function collectBuildingDetails(
  buildings: readonly AnalyzedBuilding[],
  exposedMap: ReadonlyMap<string, readonly boolean[]>,
  roads: readonly ChunkFeature[],
  terrain: BuiltTerrainChunk,
  bounds: ProjectedBounds,
  budget: DetailBudgetConfig = DETAIL_BUDGET_CONFIGS['1200k'],
  primaryEdgeMap?: ReadonlyMap<string, number>,
): BuildingDetailBatch[] {
  const collector = new DetailCollector(budget);

  // Prioritize street-facing & plaza-adjacent buildings before courtyard sheds when instance caps fill
  const sortedBuildings = [...buildings].sort((a, b) => {
    const da = roadProximity(a.centroid, roads);
    const db = roadProximity(b.centroid, roads);
    if (Math.abs(da - db) > 0.5) return da - db;
    return b.wallHeight * b.area - a.wallHeight * a.area;
  });

  for (const item of sortedBuildings) {
    const pts = item.points;
    const key = item.detailKey ?? item.feature.id ?? '';
    const exposed = exposedMap.get(key) ?? [];
    const signedArea = polygonSignedArea(pts);
    const storeyH = item.wallHeight / item.floorCount;
    const baseElev = item.baseElevationOffset ?? 0;
    const isSetback = baseElev > 0.1;
    const isTower = isTowerFeature(item.feature);
    const portalPts = item.feature.portalPoints;

    const bestStreetEdge =
      primaryEdgeMap?.get(key) ??
      selectPrimaryStreetEdge(pts, exposed, roads, bounds, portalPts, budget.minEdgeMeters);

    for (let edgeIdx = 0; edgeIdx < pts.length; edgeIdx += 1) {
      if (!exposed[edgeIdx]) continue;
      const a = pts[edgeIdx];
      const b = pts[(edgeIdx + 1) % pts.length];
      if (!a || !b || onChunkSliceEdge(a, b, bounds)) continue;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < Math.max(1.4, budget.minEdgeMeters)) continue;
      const nx = signedArea >= 0 ? dz / len : -dz / len;
      const nz = signedArea >= 0 ? -dx / len : dx / len;
      const heading = Math.atan2(nx, nz);
      const startG = sampleHeight(terrain, a[0], a[1]);
      const endG = sampleHeight(terrain, b[0], b[1]);
      const slopeRatio = Math.abs(endG - startG) / len;
      const isPrimaryEdge = edgeIdx === bestStreetEdge;

      const { panels: bayCount, floors } = computeEdgeBayLayout(
        len,
        item.floorCount,
        item.style,
        budget,
        true,
        0,
      );
      const miradorBay = selectMiradorBay(
        item.seed,
        floors,
        item.style,
        bayCount,
        len,
        isPrimaryEdge,
        isSetback,
        isTower,
        budget,
      );

      // Pick ground-floor portal bay closest to Catastro AD coordinates when available
      let bestPortalBay = Math.floor(bayCount / 2);
      if (portalPts && portalPts.length > 0 && bayCount > 1) {
        let bestBayDist = Infinity;
        for (let bay = 0; bay < bayCount; bay += 1) {
          const t = (bay + 0.5) / bayCount;
          const d = nearestPortalDist([a[0] + dx * t, a[1] + dz * t], portalPts);
          if (d < bestBayDist) {
            bestBayDist = d;
            bestPortalBay = bay;
          }
        }
      }

      for (let bay = 0; bay < bayCount; bay += 1) {
        const t = (bay + 0.5) / bayCount;
        const px = a[0] + dx * t;
        const pz = a[1] + dz * t;
        if (!inBounds(px, pz, bounds)) continue;
        const groundY = startG + (endG - startG) * t + baseElev;
        const isPortalBay = bay === bestPortalBay;
        const isCenterBay = bay === Math.floor(bayCount / 2);
        const bayPortalDist = nearestPortalDist([px, pz], portalPts);
        const isMiradorCol = bay === miradorBay;

        // Ground floor portals, shopfronts & commercial awnings (relaxed slope tolerance with portal skirt)
        if (!isSetback && item.wallHeight >= 2.8 && slopeRatio <= 0.36) {
          if (item.style.isIndustrial && isCenterBay && len >= 6.5) {
            collector.push('industrial_door', px, groundY - 0.03, pz, heading, 1);
          } else if (
            (isPrimaryEdge || bayPortalDist <= 7.5) &&
            (item.feature.commercial || item.feature.catastroUse === '4_2_retail') &&
            !isTower &&
            (isPortalBay || bay % 2 === 1)
          ) {
            collector.push('shopfront_awning', px, groundY - 0.02, pz, heading, 1);
          } else if ((isPrimaryEdge || bayPortalDist <= 6.0) && isPortalBay && !isTower) {
            collector.push(item.style.portalKind, px, groundY - 0.04, pz, heading, 1);
            if (item.style.archetype === 'casco_palace' && item.wallHeight >= 5.5) {
              collector.push('heraldic_crest', px, groundY + 3.05, pz, heading, 1);
            }
          }
        }

        if (isTower) {
          if (item.feature.id === 'w385037728' && isPrimaryEdge && isCenterBay) {
            collector.push('balcony', px, groundY + item.wallHeight * 0.54, pz, heading, 1.15);
          }
          continue;
        }

        // Upper floor cantilevered CityKit balconies synced identically with chunk-mesh balconeras
        const startFloor = isSetback ? 0 : 1;
        for (let floor = startFloor; floor < floors; floor += 1) {
          if (
            wantsBalconyOnBayFloor(
              item.seed,
              item.style,
              floor,
              bay,
              bayCount,
              storeyH,
              isSetback,
              isPrimaryEdge,
              isTower,
              isMiradorCol,
              budget,
            )
          ) {
            const floorBaseY = groundY + (item.wallHeight * floor) / floors;
            collector.push(item.style.balconyKind, px, floorBaseY, pz, heading, 1);
          }
        }
      }

      // Dormer on pitched Casco / Chalet roof edge (requires sufficient footprint depth so dormer sits inside slope)
      if (
        isPrimaryEdge &&
        len >= 6.5 &&
        item.area >= 95 &&
        item.shape !== 'flat' &&
        item.style.roofMaterial === 'tile_roof' &&
        !isTower &&
        !item.style.isSacred &&
        item.seed % 3 !== 0
      ) {
        const midX = (a[0] + b[0]) * 0.5 - nx * 1.9;
        const midZ = (a[1] + b[1]) * 0.5 - nz * 1.9;
        if (inBounds(midX, midZ, bounds)) {
          const midG = sampleHeight(terrain, midX, midZ);
          collector.push(
            'dormer_roof',
            midX,
            midG + item.wallHeight + item.roofHeight * 0.16,
            midZ,
            heading,
            0.95,
          );
        }
      }

      // Bell gable ("espadaña") on smaller historic churches & chapels
      if (
        isPrimaryEdge &&
        item.style.isSacred &&
        !DEDICATED_TOWER_CHURCH_IDS.has(item.feature.id ?? '')
      ) {
        const midX = (a[0] + b[0]) * 0.5 - nx * 0.55;
        const midZ = (a[1] + b[1]) * 0.5 - nz * 0.55;
        if (inBounds(midX, midZ, bounds)) {
          const midG = sampleHeight(terrain, midX, midZ);
          collector.push('bell_gable', midX, midG + item.wallHeight + 0.15, midZ, heading, 1);
        }
      }
    }

    // Tower corner bartizans
    if (isTower && pts.length >= 4) {
      const uniquePts =
        pts[0]?.[0] === pts.at(-1)?.[0] && pts[0]?.[1] === pts.at(-1)?.[1] ? pts.slice(0, -1) : pts;
      const limit = Math.min(4, uniquePts.length);
      for (let i = 0; i < limit; i += 1) {
        const p = uniquePts[Math.floor((i * uniquePts.length) / limit)];
        if (!p || !inBounds(p[0], p[1], bounds)) continue;
        const ox = p[0] - item.centroid[0];
        const oz = p[1] - item.centroid[1];
        const heading = Math.atan2(ox, oz);
        const g = sampleHeight(terrain, p[0], p[1]);
        collector.push('corner_turret', p[0], g + item.wallHeight - 2.1, p[1], heading, 1);
      }
    }

    // Diverse rooftop equipment, solar panels, penthouses, and chimneys
    if (inBounds(item.centroid[0], item.centroid[1], bounds) && !isTower) {
      const cg = sampleHeight(terrain, item.centroid[0], item.centroid[1]) + baseElev;
      if (item.shape === 'flat' && item.area >= 70) {
        if (item.style.isIndustrial || item.style.archetype === 'ensanche_modern') {
          collector.push(
            'rooftop_hvac',
            item.centroid[0],
            cg + item.wallHeight,
            item.centroid[1],
            ((item.seed % 4) * Math.PI) / 2,
            1.1,
          );
          if (item.area > 350) {
            collector.push(
              'rooftop_solar',
              item.centroid[0] + 4.2,
              cg + item.wallHeight,
              item.centroid[1] + 2.2,
              0,
              1,
            );
          }
        } else {
          collector.push(
            'rooftop_penthouse',
            item.centroid[0],
            cg + item.wallHeight,
            item.centroid[1],
            ((item.seed % 4) * Math.PI) / 2,
            1,
          );
          if (item.seed % 2 === 0) {
            collector.push(
              'rooftop_hvac',
              item.centroid[0] - 2.8,
              cg + item.wallHeight,
              item.centroid[1] + 2.2,
              ((item.seed % 4) * Math.PI) / 2,
              0.85,
            );
          } else {
            collector.push(
              'rooftop_solar',
              item.centroid[0] + 2.6,
              cg + item.wallHeight,
              item.centroid[1] - 2.0,
              0,
              0.95,
            );
          }
        }
      } else if (
        item.style.roofMaterial === 'tile_roof' &&
        item.wallHeight >= 3.2 &&
        item.seed % 3 !== 0
      ) {
        collector.push(
          'chimney',
          item.centroid[0] + (item.seed % 2 === 0 ? 1.1 : -1.1),
          cg + item.wallHeight + item.roofHeight * 0.78,
          item.centroid[1],
          (item.seed % 8) * (Math.PI / 4),
          0.92 + ((item.seed >>> 4) % 3) * 0.1,
        );
      }
    }
  }

  return collector.build();
}
