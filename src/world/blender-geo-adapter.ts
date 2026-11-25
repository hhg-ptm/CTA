/**
 * Geographic adaptation layer (System B / FASE C) mapping real Catastro & OSM building
 * footprints, verified heights, inner courtyards, multiparts, and street-facing portal edges
 * onto the 8 Blender Stylized Low Poly architectural hero models without disproportionate stretch.
 */

import {
  computeExposedEdges,
  polygonSignedArea,
  selectPrimaryStreetEdge,
} from './building-details';
import { isTowerFeature, stableBuildingHash } from './building-styles';
import { isTowerLandmark } from './landmark-geometry';
import { sampleHeight, type RoadPoint } from './road-geometry';
import type {
  BlenderBuildingPlacement,
  BlenderModelKey,
  BuiltTerrainChunk,
  ChunkFeature,
  DistrictKind,
  ProjectedBounds,
} from './types';

export interface BlenderNominalSpec {
  readonly key: BlenderModelKey;
  readonly nominalWidthMeters: number;
  readonly nominalDepthMeters: number;
  readonly nominalHeightMeters: number;
  readonly floors: number;
}

export const BLENDER_MODEL_SPECS: Readonly<Record<BlenderModelKey, BlenderNominalSpec>> = {
  '01_casco_house': {
    key: '01_casco_house',
    nominalWidthMeters: 12.561,
    nominalDepthMeters: 9.924,
    nominalHeightMeters: 11.99,
    floors: 2,
  },
  '02_modern_residential': {
    key: '02_modern_residential',
    nominalWidthMeters: 14.22,
    nominalDepthMeters: 12.22,
    nominalHeightMeters: 24.5,
    floors: 6,
  },
  '03_chalet': {
    key: '03_chalet',
    nominalWidthMeters: 16.0,
    nominalDepthMeters: 13.55,
    nominalHeightMeters: 9.23,
    floors: 2,
  },
  '04_commercial': {
    key: '04_commercial',
    nominalWidthMeters: 13.96,
    nominalDepthMeters: 12.3,
    nominalHeightMeters: 12.46,
    floors: 3,
  },
  '05_extremadura_traditional': {
    key: '05_extremadura_traditional',
    nominalWidthMeters: 12.073,
    nominalDepthMeters: 10.514,
    nominalHeightMeters: 9.13,
    floors: 2,
  },
  '06_casco_palace': {
    key: '06_casco_palace',
    nominalWidthMeters: 16.3,
    nominalDepthMeters: 11.505,
    nominalHeightMeters: 17.12,
    floors: 3,
  },
  '07_midrise_residential': {
    key: '07_midrise_residential',
    nominalWidthMeters: 14.08,
    nominalDepthMeters: 11.185,
    nominalHeightMeters: 17.46,
    floors: 4,
  },
  '08_civic_equipment': {
    key: '08_civic_equipment',
    nominalWidthMeters: 16.34,
    nominalDepthMeters: 14.17,
    nominalHeightMeters: 14.38,
    floors: 3,
  },
};

const MIN_AXIS_SCALE = 0.72;
const MAX_AXIS_SCALE = 1.26;
const MAX_PLANAR_ASPECT = 1.24;
const MAX_HEIGHT_STRETCH = 1.26;

const CIVIC_USE_TAGS = new Set([
  '4_3_publicServices',
  '4_2_cultural',
  '4_1_sports',
  'sanitary',
  'education',
  'public',
]);

const CIVIC_BUILDING_TYPES = new Set([
  'public',
  'civic',
  'townhall',
  'school',
  'university',
  'college',
  'hospital',
  'museum',
  'police',
  'fire_station',
  'train_station',
  'bus_station',
  'sports_centre',
]);

const COMMERCIAL_BUILDING_TYPES = new Set([
  'commercial',
  'retail',
  'supermarket',
  'shop',
  'cafe',
  'restaurant',
  'kiosk',
  'marketplace',
]);

const DETACHED_HOUSE_TYPES = new Set([
  'detached',
  'house',
  'semidetached_house',
  'bungalow',
  'terrace',
  'farm',
]);

const INDUSTRIAL_SKIP_TYPES = new Set(['roof', 'ruins', 'construction']);

const INDUSTRIAL_BUILDING_TYPES = new Set([
  'industrial',
  'warehouse',
  'manufacture',
  'garages',
  'shed',
  'farm_auxiliary',
  'service',
  'storage_tank',
]);

const DISTRICT_TINT_PALETTES: Readonly<Record<DistrictKind, readonly number[]>> = {
  casco: [0xffffff, 0xf7efe2, 0xf1e7d5, 0xfaf5ec],
  canovas_centro: [0xffffff, 0xf6efe6, 0xeee8e0, 0xfbf7f0],
  residencial: [0xffffff, 0xf4f2ee, 0xebeef2, 0xf9f1e8],
  nuevo_caceres: [0xffffff, 0xf1f4f7, 0xf8f3eb, 0xeaeef3],
  mejostilla: [0xffffff, 0xfbf5ec, 0xf0f4f1, 0xf4ede3],
  chalets: [0xffffff, 0xfef5eb, 0xf1f6f2, 0xf8eee4],
  comercial: [0xffffff, 0xf6f4f0, 0xedf2f6, 0xfbf5ec],
  industrial: [0xcad3dc, 0xd8dce0, 0xbec7d0, 0xd4cfc6],
  aldea_moret: [0xf5ede2, 0xebe3d7, 0xe2dbd0, 0xfaf4eb],
  campus: [0xfaf6ee, 0xf0f4f7, 0xf3ede1, 0xffffff],
  periferia: [0xffffff, 0xf6efe5, 0xedf1eb, 0xf9f4ec],
};

export function resolveDistrict(feature: ChunkFeature, cx: number, cz: number): DistrictKind {
  if (feature.district) return feature.district;
  const btype = (feature.buildingType ?? '').toLowerCase();
  const use = feature.catastroUse ?? '';
  const zone = feature.zone ?? 'ensanche';

  if (zone === 'casco') return 'casco';
  if (use === '3_industrial' || INDUSTRIAL_BUILDING_TYPES.has(btype)) return 'industrial';
  if (
    btype === 'university' ||
    btype === 'college' ||
    btype === 'hospital' ||
    (cx >= 1800 && cz >= -200 && cz <= 1300)
  ) {
    return 'campus';
  }
  if (
    feature.commercial ||
    COMMERCIAL_BUILDING_TYPES.has(btype) ||
    use === '4_2_retail' ||
    use === '4_1_office'
  ) {
    return 'comercial';
  }
  if (zone === 'ensanche' && cx >= -900 && cx <= 700 && cz >= -850 && cz <= 700) {
    return 'canovas_centro';
  }
  if (cz >= 850 && cx >= -950 && cx <= 1500) return 'mejostilla';
  if (cx >= -1650 && cx <= 250 && cz >= -3200 && cz <= -1800) return 'aldea_moret';
  if (cx >= -2300 && cx <= -900 && cz >= -1600 && cz <= -100) return 'nuevo_caceres';
  if (DETACHED_HOUSE_TYPES.has(btype)) return 'chalets';
  if (zone === 'ensanche') return 'residencial';
  return 'periferia';
}

function pickDistrictTint(district: DistrictKind, seed: number): number {
  const palette = DISTRICT_TINT_PALETTES[district];
  return palette[Math.abs(seed) % palette.length] ?? 0xffffff;
}

function isIndustrialBuilding(feature: ChunkFeature, district: DistrictKind): boolean {
  const btype = (feature.buildingType ?? '').toLowerCase();
  return (
    district === 'industrial' ||
    feature.catastroUse === '3_industrial' ||
    feature.catastroUse === '2_agriculture' ||
    INDUSTRIAL_BUILDING_TYPES.has(btype)
  );
}

function clamp(val: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, val));
}

function polygonBoundsAndArea(points: readonly RoadPoint[]): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  area: number;
  cx: number;
  cz: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const signed = polygonSignedArea(points);
  const area = Math.abs(signed) * 0.5;
  let cx = (minX + maxX) * 0.5;
  let cz = (minZ + maxZ) * 0.5;
  if (Math.abs(signed) > 1e-6) {
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (!a || !b) continue;
      const c = a[0] * b[1] - b[0] * a[1];
      sx += (a[0] + b[0]) * c;
      sz += (a[1] + b[1]) * c;
    }
    cx = sx / (3 * signed);
    cz = sz / (3 * signed);
  }
  return { minX, maxX, minZ, maxZ, area, cx, cz };
}

export function resolvedTargetHeight(feature: ChunkFeature): {
  floors: number;
  heightMeters: number;
} {
  const explicitFloors = feature.visualFloors ?? feature.floors ?? 0;
  const explicitH = feature.visualHeightMeters ?? feature.heightMeters ?? 0;
  if (explicitH > 2.4) {
    const fl = explicitFloors > 0 ? explicitFloors : Math.max(1, Math.round(explicitH / 3.1));
    return { floors: fl, heightMeters: clamp(explicitH, 3.0, 52.0) };
  }
  if (explicitFloors > 0) {
    const fl = clamp(Math.round(explicitFloors), 1, 24);
    return { floors: fl, heightMeters: clamp(fl * 3.15 + 1.4, 3.4, 52.0) };
  }
  if (feature.zone === 'casco') return { floors: 2, heightMeters: 8.8 };
  if (feature.zone === 'periferia') return { floors: 2, heightMeters: 7.4 };
  return { floors: 4, heightMeters: 13.8 };
}

/**
 * Deterministically classify a real Catastro/OSM building into one of the 8 Blender library assets.
 */
export function selectBlenderArchetype(
  feature: ChunkFeature,
  area: number,
  floors: number,
  heightMeters: number,
  districtOverride?: DistrictKind,
): BlenderModelKey {
  const btype = (feature.buildingType ?? '').toLowerCase();
  const use = feature.catastroUse ?? '';
  const historic = (feature.historic ?? '').toLowerCase();
  const zone = feature.zone ?? 'ensanche';
  const district =
    districtOverride ??
    feature.district ??
    (zone === 'casco' ? 'casco' : zone === 'periferia' ? 'periferia' : 'residencial');
  const hash = stableBuildingHash(feature.id ?? `${area.toFixed(1)}_${floors}`);

  if (isIndustrialBuilding(feature, district)) {
    if (area >= 480) return '08_civic_equipment';
    if (btype === 'farm_auxiliary' || use === '2_agriculture' || (area <= 150 && hash % 4 === 0)) {
      return '05_extremadura_traditional';
    }
    return '04_commercial';
  }

  if (CIVIC_USE_TAGS.has(use) || CIVIC_BUILDING_TYPES.has(btype)) {
    if (district === 'campus' && floors >= 5 && area >= 550) return '02_modern_residential';
    return '08_civic_equipment';
  }

  if (district === 'casco' || zone === 'casco') {
    if (
      historic === 'palace' ||
      historic === 'manor' ||
      historic === 'castle' ||
      historic === 'tower' ||
      btype === 'palace' ||
      (feature.innerRings && feature.innerRings.length > 0 && area >= 220 && floors >= 3) ||
      (area >= 320 && floors >= 4)
    ) {
      return '06_casco_palace';
    }
    if (feature.commercial || COMMERCIAL_BUILDING_TYPES.has(btype) || use === '4_2_retail') {
      return '04_commercial';
    }
    if (floors <= 2 && (btype === 'house' || btype === 'farm' || hash % 3 === 0)) {
      return '05_extremadura_traditional';
    }
    return '01_casco_house';
  }

  if (district === 'campus') {
    if (floors >= 4 || heightMeters >= 15) return '02_modern_residential';
    if (area >= 260) return '08_civic_equipment';
    return hash % 2 === 0 ? '07_midrise_residential' : '04_commercial';
  }

  if (
    feature.commercial ||
    COMMERCIAL_BUILDING_TYPES.has(btype) ||
    use === '4_2_retail' ||
    use === '4_1_office'
  ) {
    return floors >= 5 ? '02_modern_residential' : '04_commercial';
  }

  if (district === 'aldea_moret') {
    if (floors >= 4) return '07_midrise_residential';
    return hash % 3 === 0 ? '01_casco_house' : '05_extremadura_traditional';
  }

  if (district === 'mejostilla') {
    if (floors >= 5 || heightMeters >= 15.8) return '02_modern_residential';
    if (floors >= 3 || btype === 'apartments' || btype === 'residential')
      return '07_midrise_residential';
    if (btype === 'terrace')
      return hash % 2 === 0 ? '01_casco_house' : '05_extremadura_traditional';
    return hash % 2 === 0 ? '03_chalet' : '05_extremadura_traditional';
  }

  if (district === 'chalets' || zone === 'periferia') {
    if (DETACHED_HOUSE_TYPES.has(btype) || (floors <= 2 && area <= 280)) {
      return hash % 3 === 0 ? '05_extremadura_traditional' : '03_chalet';
    }
    if (floors >= 5 || heightMeters >= 15.5) return '02_modern_residential';
    if (floors >= 3) return '07_midrise_residential';
    return hash % 2 === 0 ? '03_chalet' : '05_extremadura_traditional';
  }

  // Cánovas/Centro, Nuevo Cáceres, and Residencial
  if (floors >= 5 || heightMeters >= 15.8 || btype === 'office' || btype === 'hotel') {
    return '02_modern_residential';
  }
  if (DETACHED_HOUSE_TYPES.has(btype) && floors <= 2 && area <= 170) {
    return hash % 2 === 0 ? '05_extremadura_traditional' : '01_casco_house';
  }
  if (district === 'canovas_centro' && floors === 3 && hash % 5 === 0) {
    return '04_commercial';
  }
  return '07_midrise_residential';
}

function chooseSiblingVariant(
  baseKey: BlenderModelKey,
  slotHash: number,
  district: DistrictKind,
  industrial: boolean,
): BlenderModelKey {
  if (industrial) {
    return slotHash % 4 === 0 && baseKey === '04_commercial' ? '08_civic_equipment' : baseKey;
  }
  if (district === 'campus') {
    if (baseKey === '08_civic_equipment' && slotHash % 3 === 0) return '07_midrise_residential';
    return baseKey;
  }
  if (baseKey === '01_casco_house' || baseKey === '05_extremadura_traditional') {
    return slotHash % 3 === 0 ? '05_extremadura_traditional' : '01_casco_house';
  }
  if (baseKey === '07_midrise_residential' && slotHash % 4 === 0) {
    return '04_commercial';
  }
  if (baseKey === '04_commercial' && slotHash % 3 === 0) {
    return '07_midrise_residential';
  }
  if (baseKey === '02_modern_residential' && slotHash % 5 === 0) {
    return '07_midrise_residential';
  }
  return baseKey;
}

interface FootprintObb {
  readonly heading: number;
  readonly uDir: RoadPoint;
  readonly vDir: RoadPoint;
  readonly obbCx: number;
  readonly obbCz: number;
  readonly width: number;
  readonly depth: number;
  readonly minU: number;
  readonly maxU: number;
  readonly minV: number;
  readonly maxV: number;
}

function computeStreetAlignedObb(
  points: readonly RoadPoint[],
  cx: number,
  cz: number,
  neighborVolumes: readonly Parameters<typeof computeExposedEdges>[1][number][],
  roads: readonly ChunkFeature[],
  bounds: ProjectedBounds,
  portalPoints: readonly (readonly [number, number])[] | undefined,
): FootprintObb {
  const b = polygonBoundsAndArea(points);
  const dummyVolume = {
    points,
    minX: b.minX,
    maxX: b.maxX,
    minZ: b.minZ,
    maxZ: b.maxZ,
    wallHeight: 8,
    feature: { id: 'obb', featureType: 'building' as const },
  } as Parameters<typeof computeExposedEdges>[0];
  const exposed = computeExposedEdges(dummyVolume, neighborVolumes, 3.0);
  const edgeIdx = selectPrimaryStreetEdge(points, exposed, roads, bounds, portalPoints, 2.0);

  let dirX = 1;
  let dirZ = 0;
  let outX = 0;
  let outZ = 1;
  const signed = polygonSignedArea(points);

  if (edgeIdx >= 0) {
    const a = points[edgeIdx];
    const b = points[(edgeIdx + 1) % points.length];
    if (a && b) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > 1e-4) {
        outX = signed >= 0 ? (b[1] - a[1]) / len : -(b[1] - a[1]) / len;
        outZ = signed >= 0 ? -(b[0] - a[0]) / len : (b[0] - a[0]) / len;
      }
    }
  } else {
    // Fallback to longest polygon edge outward normal
    let bestLen = -1;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (!a || !b) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > bestLen) {
        bestLen = len;
        outX = signed >= 0 ? (b[1] - a[1]) / len : -(b[1] - a[1]) / len;
        outZ = signed >= 0 ? -(b[0] - a[0]) / len : (b[0] - a[0]) / len;
      }
    }
  }

  const heading = Math.atan2(outX, outZ);
  // Three.js rotation.y = heading maps +Z -> (sin(heading), 0, cos(heading)) and +X -> (cos(heading), 0, -sin(heading))
  dirX = Math.cos(heading);
  dirZ = -Math.sin(heading);
  const uDir: RoadPoint = [dirX, dirZ];
  const vDir: RoadPoint = [Math.sin(heading), Math.cos(heading)];

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of points) {
    const dx = p[0] - cx;
    const dz = p[1] - cz;
    const u = dx * uDir[0] + dz * uDir[1];
    const v = dx * vDir[0] + dz * vDir[1];
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const midU = (minU + maxU) * 0.5;
  const midV = (minV + maxV) * 0.5;
  return {
    heading,
    uDir,
    vDir,
    obbCx: cx + uDir[0] * midU + vDir[0] * midV,
    obbCz: cz + uDir[1] * midU + vDir[1] * midV,
    width: Math.max(2.0, maxU - minU),
    depth: Math.max(2.0, maxV - minV),
    minU,
    maxU,
    minV,
    maxV,
  };
}

function minFootprintGround(
  terrain: BuiltTerrainChunk,
  cx: number,
  cz: number,
  uDir: RoadPoint,
  vDir: RoadPoint,
  hw: number,
  hd: number,
): number {
  let minH = sampleHeight(terrain, cx, cz);
  const corners: readonly [number, number][] = [
    [-hw * 0.8, -hd * 0.8],
    [hw * 0.8, -hd * 0.8],
    [hw * 0.8, hd * 0.8],
    [-hw * 0.8, hd * 0.8],
  ];
  for (const [lu, lv] of corners) {
    const px = cx + uDir[0] * lu + vDir[0] * lv;
    const pz = cz + uDir[1] * lu + vDir[1] * lv;
    const h = sampleHeight(terrain, px, pz);
    if (h < minH) minH = h;
  }
  return minH - 0.03;
}

function computeProportionallySafeScales(
  targetW: number,
  targetD: number,
  targetH: number,
  spec: BlenderNominalSpec,
): { scaleX: number; scaleY: number; scaleZ: number } {
  let sx = clamp(targetW / spec.nominalWidthMeters, MIN_AXIS_SCALE, MAX_AXIS_SCALE);
  let sz = clamp(targetD / spec.nominalDepthMeters, MIN_AXIS_SCALE, MAX_AXIS_SCALE);
  let sy = clamp(targetH / spec.nominalHeightMeters, MIN_AXIS_SCALE, MAX_AXIS_SCALE);

  // Prevent grotesque horizontal squash/stretch ratio between width & depth
  if (sx > sz * MAX_PLANAR_ASPECT) sx = sz * MAX_PLANAR_ASPECT;
  else if (sz > sx * MAX_PLANAR_ASPECT) sz = sx * MAX_PLANAR_ASPECT;

  // Prevent extreme vertical spire/pancake distortion relative to footprint scale
  const avgXZ = (sx + sz) * 0.5;
  sy = clamp(
    sy,
    Math.max(MIN_AXIS_SCALE, avgXZ / MAX_HEIGHT_STRETCH),
    Math.min(MAX_AXIS_SCALE, avgXZ * MAX_HEIGHT_STRETCH),
  );
  return { scaleX: sx, scaleY: sy, scaleZ: sz };
}

function emitFittedModulesAlongSpan(
  out: BlenderBuildingPlacement[],
  terrain: BuiltTerrainChunk,
  buildingId: string,
  baseKey: BlenderModelKey,
  district: DistrictKind,
  industrial: boolean,
  cx: number,
  cz: number,
  heading: number,
  uDir: RoadPoint,
  vDir: RoadPoint,
  spanW: number,
  spanD: number,
  targetH: number,
  seed: number,
): void {
  const baseSpec = BLENDER_MODEL_SPECS[baseKey];
  const allowMultiCivic =
    baseKey === '08_civic_equipment' && (industrial || spanW > 22 || spanD > 20);
  const singleton =
    baseKey === '06_casco_palace' ||
    baseKey === '03_chalet' ||
    (baseKey === '08_civic_equipment' && !allowMultiCivic);
  const maxU = industrial || district === 'campus' ? 8 : 5;
  const maxV = industrial || district === 'campus' ? 3 : 2;
  const countU = singleton
    ? 1
    : Math.max(1, Math.min(maxU, Math.round(spanW / (baseSpec.nominalWidthMeters * 0.96))));
  const countV = singleton
    ? 1
    : Math.max(1, Math.min(maxV, Math.round(spanD / (baseSpec.nominalDepthMeters * 1.15))));
  const modW = spanW / countU;
  const modD = spanD / countV;
  const resolvedTargetH = industrial ? Math.min(targetH, 10.5) : targetH;

  for (let iu = 0; iu < countU; iu += 1) {
    for (let iv = 0; iv < countV; iv += 1) {
      const slotIdx = iu * countV + iv;
      const isPrimaryStreetCorner = iu === 0 && iv === countV - 1;
      const modKey = isPrimaryStreetCorner
        ? baseKey
        : chooseSiblingVariant(baseKey, seed + slotIdx * 17, district, industrial);
      const spec = BLENDER_MODEL_SPECS[modKey];
      const uOff = -spanW * 0.5 + modW * (iu + 0.5);
      const vOff = -spanD * 0.5 + modD * (iv + 0.5);
      const mx = cx + uDir[0] * uOff + vDir[0] * vOff;
      const mz = cz + uDir[1] * uOff + vDir[1] * vOff;
      // Industrial sheds flip 04_commercial so corrugated loading shutters & service doors face outward toward streets.
      const baseHeading = countV > 1 && iv === 0 ? heading + Math.PI : heading;
      const modHeading =
        industrial && modKey === '04_commercial' ? baseHeading + Math.PI : baseHeading;
      const heightJitter = 1.0 + (((seed + slotIdx * 13) % 9) - 4) * 0.015;
      const fitW = countU > 1 ? modW * 0.95 : modW;
      const fitD = countV > 1 ? modD * 0.95 : modD;
      const scales = computeProportionallySafeScales(
        fitW,
        fitD,
        resolvedTargetH * heightJitter,
        spec,
      );
      const y = minFootprintGround(terrain, mx, mz, uDir, vDir, modW * 0.5, modD * 0.5);
      out.push({
        buildingId: `${buildingId}#m${slotIdx}`,
        modelKey: modKey,
        x: mx,
        y,
        z: mz,
        heading: modHeading,
        ...scales,
        tint: pickDistrictTint(district, seed + slotIdx * 29),
      });
    }
  }
}

export interface GeoAdaptationResult {
  readonly placements: BlenderBuildingPlacement[];
  readonly handledBuildingIds: Set<string>;
}

/**
 * Convert raw Catastro/OSM building features into proportionally safe Blender model placements,
 * leaving dedicated landmarks untouched and generating fallback exclusion tracking.
 */
export function buildBlenderGeoPlacements(
  features: readonly ChunkFeature[],
  terrain: BuiltTerrainChunk,
  bounds: ProjectedBounds,
): GeoAdaptationResult {
  const placements: BlenderBuildingPlacement[] = [];
  const handledBuildingIds = new Set<string>();
  const roads = features.filter((f) => f.featureType === 'road' || f.featureType === 'pedestrian');
  const neighborVolumes = features
    .filter((f) => f.featureType === 'building' && f.points && f.points.length >= 3)
    .map((f) => {
      const pts = f.points as readonly RoadPoint[];
      const b = polygonBoundsAndArea(pts);
      return {
        points: pts,
        minX: b.minX,
        maxX: b.maxX,
        minZ: b.minZ,
        maxZ: b.maxZ,
        wallHeight: resolvedTargetHeight(f).heightMeters,
        feature: f,
      } as Parameters<typeof computeExposedEdges>[1][number];
    });

  for (const feature of features) {
    if (feature.featureType !== 'building' || !feature.points || feature.points.length < 3)
      continue;
    const btype = (feature.buildingType ?? '').toLowerCase();

    // Preserve dedicated historical landmarks with bespoke w*.glb / hand-authored towers
    if (
      (feature.landmarkModelPath && /^landmarks\/w\d+\.glb$/.test(feature.landmarkModelPath)) ||
      isTowerFeature(feature) ||
      isTowerLandmark(feature)
    ) {
      continue;
    }

    const { area, cx, cz } = polygonBoundsAndArea(feature.points);
    if (area < 9.0) continue;
    if (INDUSTRIAL_SKIP_TYPES.has(btype) && area < 35) continue;

    // Single-owner chunk check: prevents cross-chunk duplicate placement on straddling lots
    const isOwner = cx >= bounds.minX && cx < bounds.maxX && cz >= bounds.minZ && cz < bounds.maxZ;
    handledBuildingIds.add(feature.id ?? '');
    if (!isOwner) continue;

    const obb = computeStreetAlignedObb(
      feature.points,
      cx,
      cz,
      neighborVolumes,
      roads,
      bounds,
      feature.portalPoints,
    );
    const { floors, heightMeters } = resolvedTargetHeight(feature);
    const id = feature.id ?? `${cx.toFixed(1)}_${cz.toFixed(1)}`;
    const seed = stableBuildingHash(id);
    const district = resolveDistrict(feature, cx, cz);
    const industrial = isIndustrialBuilding(feature, district);
    const baseKey = selectBlenderArchetype(feature, area, floors, heightMeters, district);

    // 1. Preserve genuine inner courtyards ("patios interiores") by framing around the hole bounds
    if (
      feature.innerRings &&
      feature.innerRings.length > 0 &&
      obb.width >= 10.0 &&
      obb.depth >= 10.0
    ) {
      const hole = feature.innerRings[0];
      if (hole && hole.length >= 3) {
        let hMinU = Infinity;
        let hMaxU = -Infinity;
        let hMinV = Infinity;
        let hMaxV = -Infinity;
        for (const p of hole) {
          const dx = p[0] - cx;
          const dz = p[1] - cz;
          const u = dx * obb.uDir[0] + dz * obb.uDir[1];
          const v = dx * obb.vDir[0] + dz * obb.vDir[1];
          if (u < hMinU) hMinU = u;
          if (u > hMaxU) hMaxU = u;
          if (v < hMinV) hMinV = v;
          if (v > hMaxV) hMaxV = v;
        }
        const wingDefs: {
          centerU: number;
          centerV: number;
          spanW: number;
          spanD: number;
          heading: number;
        }[] = [
          // Front wing (+v toward street)
          {
            centerU: (obb.minU + obb.maxU) * 0.5,
            centerV: (hMaxV + obb.maxV) * 0.5,
            spanW: obb.width,
            spanD: Math.max(0, obb.maxV - hMaxV),
            heading: obb.heading,
          },
          // Back wing (-v away from street)
          {
            centerU: (obb.minU + obb.maxU) * 0.5,
            centerV: (obb.minV + hMinV) * 0.5,
            spanW: obb.width,
            spanD: Math.max(0, hMinV - obb.minV),
            heading: obb.heading + Math.PI,
          },
          // Left wing (-u)
          {
            centerU: (obb.minU + hMinU) * 0.5,
            centerV: (hMinV + hMaxV) * 0.5,
            spanW: Math.max(0, hMaxV - hMinV),
            spanD: Math.max(0, hMinU - obb.minU),
            heading: obb.heading - Math.PI * 0.5,
          },
          // Right wing (+u)
          {
            centerU: (hMaxU + obb.maxU) * 0.5,
            centerV: (hMinV + hMaxV) * 0.5,
            spanW: Math.max(0, hMaxV - hMinV),
            spanD: Math.max(0, obb.maxU - hMaxU),
            heading: obb.heading + Math.PI * 0.5,
          },
        ];
        let placedAnyWing = false;
        for (let wIdx = 0; wIdx < wingDefs.length; wIdx += 1) {
          const wd = wingDefs[wIdx];
          if (!wd || wd.spanW < 3.6 || wd.spanD < 3.2) continue;
          const wCx = cx + obb.uDir[0] * wd.centerU + obb.vDir[0] * wd.centerV;
          const wCz = cz + obb.uDir[1] * wd.centerU + obb.vDir[1] * wd.centerV;
          const wU: RoadPoint = [Math.cos(wd.heading), -Math.sin(wd.heading)];
          const wV: RoadPoint = [Math.sin(wd.heading), Math.cos(wd.heading)];
          emitFittedModulesAlongSpan(
            placements,
            terrain,
            `${id}_w${wIdx}`,
            wIdx === 0
              ? baseKey
              : chooseSiblingVariant(baseKey, seed + wIdx * 7, district, industrial),
            district,
            industrial,
            wCx,
            wCz,
            wd.heading,
            wU,
            wV,
            wd.spanW,
            wd.spanD,
            heightMeters,
            seed + wIdx * 11,
          );
          placedAnyWing = true;
        }
        if (placedAnyWing) continue;
      }
    }

    // 2. Preserve stepped multipart volumes (Catastro BuildingPart tiers when >= 2 large parts exist)
    if (feature.parts && feature.parts.length >= 2) {
      let placedPartCount = 0;
      const validParts = feature.parts.filter((part) => part.pts.length >= 3);
      for (let pIdx = 0; pIdx < Math.min(3, validParts.length); pIdx += 1) {
        const part = validParts[pIdx];
        if (!part) continue;
        const pb = polygonBoundsAndArea(part.pts);
        if (pb.area < 24) continue;
        const pObb = computeStreetAlignedObb(
          part.pts,
          pb.cx,
          pb.cz,
          neighborVolumes,
          roads,
          bounds,
          feature.portalPoints,
        );
        const pFloors = part.floors ?? floors;
        const pHeight = part.heightMeters ?? (pFloors > 0 ? pFloors * 3.15 + 1.4 : heightMeters);
        const pKey = selectBlenderArchetype(feature, pb.area, pFloors, pHeight, district);
        emitFittedModulesAlongSpan(
          placements,
          terrain,
          `${id}_p${pIdx}`,
          pKey,
          district,
          industrial,
          pObb.obbCx,
          pObb.obbCz,
          pObb.heading,
          pObb.uDir,
          pObb.vDir,
          pObb.width,
          pObb.depth,
          pHeight,
          seed + pIdx * 19,
        );
        placedPartCount += 1;
      }
      if (placedPartCount > 0) continue;
    }

    // 3. Standard single or tiled OBB placement avoiding disproportionate stretch
    emitFittedModulesAlongSpan(
      placements,
      terrain,
      id,
      baseKey,
      district,
      industrial,
      obb.obbCx,
      obb.obbCz,
      obb.heading,
      obb.uDir,
      obb.vDir,
      obb.width,
      obb.depth,
      heightMeters,
      seed,
    );
  }

  return { placements, handledBuildingIds };
}
