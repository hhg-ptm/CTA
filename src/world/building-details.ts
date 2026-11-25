import type { BuildingStyleSpec } from './building-styles';
import { isTowerFeature } from './building-styles';
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
  balcony: 75,
  balcony_modern: 75,
  window_casco: 95,
  window_ensanche: 95,
  window_modern: 95,
  portal_casco: 36,
  portal_modern: 36,
  shopfront_awning: 36,
  industrial_door: 28,
  pilaster_corner: 48,
  chimney: 48,
  dormer_roof: 36,
  rooftop_penthouse: 32,
  rooftop_hvac: 44,
  bell_gable: 8,
  corner_turret: 12,
  heraldic_crest: 20,
};

const MAX_LOD: Readonly<Record<BuildingDetailKind, 0 | 1>> = {
  balcony: 1,
  balcony_modern: 1,
  window_casco: 0,
  window_ensanche: 0,
  window_modern: 0,
  portal_casco: 0,
  portal_modern: 0,
  shopfront_awning: 0,
  industrial_door: 0,
  pilaster_corner: 0,
  chimney: 1,
  dormer_roof: 1,
  rooftop_penthouse: 1,
  rooftop_hvac: 1,
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
    const probeX = (a[0] + b[0]) * 0.5 + nx * 1.45;
    const probeZ = (a[1] + b[1]) * 0.5 + nz * 1.45;
    let blocked = false;
    for (const other of allBuildings) {
      if (other.feature.id === building.feature.id) continue;
      if (
        probeX < other.minX - 0.1 ||
        probeX > other.maxX + 0.1 ||
        probeZ < other.minZ - 0.1 ||
        probeZ > other.maxZ + 0.1
      ) {
        continue;
      }
      if (pointInPolygon(probeX, probeZ, other.points)) {
        blocked = true;
        break;
      }
    }
    exposed.push(!blocked);
  }
  return exposed;
}

function roadProximity(point: RoadPoint, roads: readonly ChunkFeature[]): number {
  let best = Infinity;
  for (const road of roads) {
    const pts = road.points;
    if (!pts) continue;
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
      const d = Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dz * t);
      if (d < best) best = d;
    }
  }
  return best;
}

class DetailCollector {
  private readonly batches = new Map<BuildingDetailKind, DetailMutableBatch>();

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
      batch = {
        kind,
        maxLod: MAX_LOD[kind],
        positions: [],
        headings: [],
        scales: [],
      };
      this.batches.set(kind, batch);
    }
    if (batch.headings.length >= MAX_INSTANCES[kind]) return false;
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
): BuildingDetailBatch[] {
  const collector = new DetailCollector();

  for (const item of buildings) {
    const pts = item.points;
    const exposed = exposedMap.get(item.feature.id ?? '') ?? [];
    const signedArea = polygonSignedArea(pts);
    const floors = Math.min(item.floorCount, 5);
    const storeyH = item.wallHeight / item.floorCount;
    const isTower = isTowerFeature(item.feature);
    const pattern = item.seed % 3;

    // Identify the best street-facing exposed edge for primary entrances/shopfronts/dormers.
    let bestStreetEdge = -1;
    let bestRoadDist = Infinity;
    let bestEdgeLen = 0;

    for (let i = 0; i < pts.length; i += 1) {
      if (!exposed[i]) continue;
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (!a || !b || onChunkSliceEdge(a, b, bounds)) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 4.0) continue;
      const mid: RoadPoint = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
      const dist = roadProximity(mid, roads);
      if (
        dist < bestRoadDist - 0.8 ||
        (Math.abs(dist - bestRoadDist) <= 0.8 && len > bestEdgeLen)
      ) {
        bestRoadDist = dist;
        bestStreetEdge = i;
        bestEdgeLen = len;
      }
    }

    // Place facade elements along every exposed exterior edge
    for (let edgeIdx = 0; edgeIdx < pts.length; edgeIdx += 1) {
      if (!exposed[edgeIdx]) continue;
      const a = pts[edgeIdx];
      const b = pts[(edgeIdx + 1) % pts.length];
      if (!a || !b || onChunkSliceEdge(a, b, bounds)) continue;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 3.6) continue;
      const nx = signedArea >= 0 ? dz / len : -dz / len;
      const nz = signedArea >= 0 ? -dx / len : dx / len;
      const heading = Math.atan2(nx, nz);
      const startG = sampleHeight(terrain, a[0], a[1]);
      const endG = sampleHeight(terrain, b[0], b[1]);
      const slopeRatio = Math.abs(endG - startG) / len;
      const isPrimaryEdge = edgeIdx === bestStreetEdge;

      const bayPitch = item.style.isIndustrial ? 8.0 : item.style.isHistoric ? 4.8 : 5.2;
      const maxBays = item.style.isIndustrial ? 3 : 4;
      const bayCount = Math.min(maxBays, Math.max(1, Math.floor((len - 1.2) / bayPitch)));

      for (let bay = 0; bay < bayCount; bay += 1) {
        const t = (bay + 0.5) / bayCount;
        const px = a[0] + dx * t;
        const pz = a[1] + dz * t;
        if (!inBounds(px, pz, bounds)) continue;
        const groundY = startG + (endG - startG) * t;
        const isCenterBay = bay === Math.floor(bayCount / 2);

        // Ground floor (portals, shopfronts, industrial shutters, ground palace windows)
        if (item.wallHeight >= 3.0 && slopeRatio <= 0.22) {
          if (item.style.isIndustrial && isCenterBay && len >= 7.0) {
            collector.push('industrial_door', px, groundY, pz, heading, 1);
          } else if (
            isPrimaryEdge &&
            item.feature.commercial &&
            !isTower &&
            (isCenterBay || (bayCount >= 3 && bay % 2 === 1))
          ) {
            collector.push('shopfront_awning', px, groundY, pz, heading, 1);
          } else if (isPrimaryEdge && isCenterBay && !isTower) {
            collector.push(item.style.portalKind, px, groundY, pz, heading, 1);
            if (item.style.archetype === 'casco_palace' && item.wallHeight >= 5.5) {
              collector.push('heraldic_crest', px, groundY + 3.05, pz, heading, 1);
            }
          } else if (item.style.archetype === 'casco_palace' && bay % 2 === 0 && !isTower) {
            collector.push('window_casco', px, groundY + 1.05, pz, heading, 0.95);
          }
        }

        // Upper floors (windows and balconies; avoid crowding towers except Bujaco balcony)
        if (isTower) {
          if (item.feature.id === 'w385037728' && isPrimaryEdge && isCenterBay) {
            collector.push('balcony', px, groundY + item.wallHeight * 0.54, pz, heading, 1.15);
          }
          continue;
        }

        for (let floor = 1; floor < floors; floor += 1) {
          const floorBaseY = groundY + floor * storeyH;
          if (item.style.isIndustrial) {
            if (floor === 1 && bay % 2 === 0)
              collector.push('window_modern', px, floorBaseY + storeyH * 0.3, pz, heading, 1);
            continue;
          }
          const wantsBalcony =
            storeyH >= 2.4 &&
            ((pattern === 0 && floor === 1) ||
              (pattern === 1 && isCenterBay) ||
              (pattern === 2 && (floor + bay) % 2 === 1 && isPrimaryEdge));
          if (wantsBalcony) {
            collector.push(item.style.balconyKind, px, floorBaseY, pz, heading, 1);
          } else if ((bay + floor) % 3 !== 2 || isPrimaryEdge) {
            collector.push(item.style.windowKind, px, floorBaseY + storeyH * 0.27, pz, heading, 1);
          }
        }
      }

      // Dormer on primary Casco / Chalet pitched roof edge
      if (
        isPrimaryEdge &&
        bestEdgeLen >= 6.5 &&
        item.shape !== 'flat' &&
        item.style.roofMaterial === 'tile_roof' &&
        !isTower &&
        !item.style.isSacred &&
        item.seed % 3 !== 0
      ) {
        const midX = (a[0] + b[0]) * 0.5 - nx * 1.35;
        const midZ = (a[1] + b[1]) * 0.5 - nz * 1.35;
        if (inBounds(midX, midZ, bounds)) {
          const midG = sampleHeight(terrain, midX, midZ);
          collector.push(
            'dormer_roof',
            midX,
            midG + item.wallHeight + item.roofHeight * 0.36,
            midZ,
            heading,
            1,
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

    // Exterior corner quoins for historic palaces / monuments
    if (item.style.archetype === 'casco_palace' && !isTower && item.wallHeight >= 5.2) {
      const cornerStep = Math.max(1, Math.floor(pts.length / 4));
      for (let i = 0; i < pts.length && i < cornerStep * 4; i += cornerStep) {
        const pt = pts[i];
        if (!pt || !inBounds(pt[0], pt[1], bounds)) continue;
        const g = sampleHeight(terrain, pt[0], pt[1]);
        const stackFloors = Math.min(3, Math.floor(item.wallHeight / 3.0));
        for (let f = 0; f < stackFloors; f += 1)
          collector.push('pilaster_corner', pt[0], g + f * 2.95, pt[1], (i * Math.PI) / 4, 1);
      }
    }

    // Tower corner bartizans ("matacanes")
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

    // Rooftop skyline accents (strictly owned by the centroid chunk)
    if (inBounds(item.centroid[0], item.centroid[1], bounds) && !isTower) {
      const cg = sampleHeight(terrain, item.centroid[0], item.centroid[1]);
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
          if (item.area > 450) {
            collector.push(
              'rooftop_hvac',
              item.centroid[0] + 4.5,
              cg + item.wallHeight,
              item.centroid[1] + 2.5,
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
          }
        }
      } else if (
        item.style.roofMaterial === 'tile_roof' &&
        item.wallHeight >= 4.5 &&
        item.seed % 3 !== 0
      ) {
        collector.push(
          'chimney',
          item.centroid[0],
          cg + item.wallHeight + item.roofHeight * 0.78,
          item.centroid[1],
          (item.seed % 8) * (Math.PI / 4),
          0.9 + ((item.seed >>> 4) % 3) * 0.1,
        );
      }
    }
  }

  return collector.build();
}
