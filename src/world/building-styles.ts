import type { BuildingColor } from './building-geometry';
import type { BuildingDetailKind, BuildingMaterial, ChunkFeature } from './types';

export type BuildingArchetype =
  | 'casco_palace'
  | 'casco_lime'
  | 'casco_ochre'
  | 'casco_terracotta'
  | 'ensanche_brick'
  | 'ensanche_stucco'
  | 'ensanche_cream'
  | 'ensanche_modern'
  | 'periferia_chalet'
  | 'periferia_block'
  | 'periferia_industrial'
  | 'periferia_civic';

export interface BuildingStyleSpec {
  readonly archetype: BuildingArchetype;
  readonly wallMaterial: BuildingMaterial;
  readonly roofMaterial: BuildingMaterial;
  readonly atlasBand: 0 | 1 | 2 | 3;
  readonly tint: BuildingColor;
  readonly plinthColor: BuildingColor;
  readonly eaveOverhangMeters: number;
  readonly parapetHeightMeters: number;
  readonly windowKind: BuildingDetailKind;
  readonly balconyKind: BuildingDetailKind;
  readonly portalKind: BuildingDetailKind;
  readonly isHistoric: boolean;
  readonly isSacred: boolean;
  readonly isIndustrial: boolean;
  readonly isChalet: boolean;
}

const WHITEWASH_CHURCH_IDS = new Set(['w385037722', 'w568471701']);
const SACRED_TYPES = new Set(['cathedral', 'church', 'chapel', 'temple']);
const HISTORIC_TYPES = new Set(['palace', 'manor', 'castle', 'tower', 'civic', 'public']);
const INDUSTRIAL_TYPES = new Set([
  'industrial',
  'warehouse',
  'garages',
  'farm_auxiliary',
  'sports_hall',
]);
const CHALET_TYPES = new Set(['house', 'terrace', 'detached', 'semidetached_house', 'farm']);
const MODERN_TYPES = new Set([
  'office',
  'hotel',
  'hospital',
  'university',
  'college',
  'commercial',
  'retail',
  'supermarket',
  'train_station',
  'bus_station',
  'sports_centre',
]);
const FLAT_MODERN_TYPES = new Set([
  'apartments',
  'office',
  'hotel',
  'hospital',
  'university',
  'commercial',
  'supermarket',
  'sports_centre',
]);

export function stableBuildingHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1)
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

function parseHexTint(hexColor: string | undefined): BuildingColor | undefined {
  const hex = /^#?([\da-f]{6})$/i.exec(hexColor ?? '')?.[1];
  if (!hex) return undefined;
  return [
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

function varyTint(base: BuildingColor, seed: number): BuildingColor {
  const deltaR = ((seed % 9) - 4) * 0.015;
  const deltaG = (((seed >>> 4) % 9) - 4) * 0.014;
  const deltaB = (((seed >>> 8) % 9) - 4) * 0.012;
  return [
    Math.min(1, Math.max(0.7, base[0] + deltaR)),
    Math.min(1, Math.max(0.7, base[1] + deltaG)),
    Math.min(1, Math.max(0.7, base[2] + deltaB)),
  ];
}

export function isSacredBuilding(feature: ChunkFeature): boolean {
  const type = feature.buildingType ?? '';
  if (SACRED_TYPES.has(type)) return true;
  return /^(?:iglesia|ermita|concatedral|capilla)\b/i.test(feature.name ?? '');
}

export function isTowerFeature(feature: ChunkFeature): boolean {
  return (
    feature.featureType === 'building' &&
    (feature.buildingType === 'tower' || /^torre(?:\s|$)/i.test(feature.name ?? ''))
  );
}

function resolveArchetype(feature: ChunkFeature, seed: number): BuildingArchetype {
  const type = feature.buildingType ?? 'yes';
  const name = feature.name ?? '';
  if (INDUSTRIAL_TYPES.has(type)) return 'periferia_industrial';

  if (feature.zone === 'casco') {
    if (WHITEWASH_CHURCH_IDS.has(feature.id ?? '')) return 'casco_lime';
    if (
      Boolean(feature.historic) ||
      HISTORIC_TYPES.has(type) ||
      SACRED_TYPES.has(type) ||
      feature.id === 'w22358108' ||
      /^(?:palacio|casa de|ayuntamiento|torre|iglesia|concatedral)\b/i.test(name)
    ) {
      return 'casco_palace';
    }
    const roll = seed % 100;
    if (roll < 40) return 'casco_lime';
    if (roll < 74) return 'casco_ochre';
    if (roll < 90) return 'casco_terracotta';
    return 'casco_palace';
  }

  if (feature.zone === 'periferia') {
    if (CHALET_TYPES.has(type)) return 'periferia_chalet';
    if (MODERN_TYPES.has(type) || type === 'school') return 'periferia_civic';
    const roll = seed % 100;
    if (roll < 48) return 'periferia_block';
    if (roll < 82) return 'periferia_chalet';
    return 'periferia_civic';
  }

  // Ensanche (Cáceres avenues & mid-ring residential/commercial blocks)
  if (CHALET_TYPES.has(type)) return 'ensanche_cream';
  if (MODERN_TYPES.has(type) || (feature.commercial && type !== 'apartments' && seed % 2 === 0))
    return 'ensanche_modern';
  const roll = seed % 100;
  if (roll < 36) return 'ensanche_brick';
  if (roll < 68) return 'ensanche_stucco';
  if (roll < 88) return 'ensanche_cream';
  return 'ensanche_modern';
}

export function effectiveRoofShape(
  feature: ChunkFeature,
  inferredByFootprint: 'flat' | 'gabled' | 'hipped',
): 'flat' | 'gabled' | 'hipped' {
  const tagged = feature.roofShape?.toLowerCase();
  if (tagged === 'flat' || tagged === 'gabled' || tagged === 'hipped') return tagged;
  const type = feature.buildingType ?? 'yes';
  const floors = feature.visualFloors ?? 2;
  if (feature.zone !== 'casco' && FLAT_MODERN_TYPES.has(type) && floors >= 4) return 'flat';
  if (
    feature.zone === 'ensanche' &&
    type === 'yes' &&
    floors >= 4 &&
    stableBuildingHash(feature.id ?? '') % 3 === 0
  )
    return 'flat';
  return inferredByFootprint;
}

export function classifyBuilding(
  feature: ChunkFeature,
  roofShape: 'flat' | 'gabled' | 'hipped',
): BuildingStyleSpec {
  const seed = stableBuildingHash(feature.id ?? '');
  const archetype = resolveArchetype(feature, seed);
  const sacred = isSacredBuilding(feature);
  const industrial = archetype === 'periferia_industrial';
  const chalet = archetype === 'periferia_chalet';
  const historic =
    archetype === 'casco_palace' ||
    archetype === 'casco_lime' ||
    archetype === 'casco_ochre' ||
    archetype === 'casco_terracotta';

  const hexTint = parseHexTint(feature.facadeColour);
  let wallMaterial: BuildingMaterial = 'ensanche_facade';
  let atlasBand: 0 | 1 | 2 | 3 = 1;
  let baseTint: BuildingColor = [0.96, 0.94, 0.91];
  let plinthColor: BuildingColor = [0.58, 0.54, 0.48];
  let windowKind: BuildingDetailKind = 'window_ensanche';
  let balconyKind: BuildingDetailKind = 'balcony_modern';
  let portalKind: BuildingDetailKind = 'portal_modern';

  switch (archetype) {
    case 'casco_palace':
      wallMaterial = 'casco_facade';
      atlasBand = sacred && !WHITEWASH_CHURCH_IDS.has(feature.id ?? '') ? 3 : 0;
      baseTint = varyTint([0.97, 0.92, 0.84], seed);
      plinthColor = [0.55, 0.5, 0.42];
      windowKind = 'window_casco';
      balconyKind = 'balcony';
      portalKind = 'portal_casco';
      break;
    case 'casco_lime':
      wallMaterial = 'casco_facade';
      atlasBand = 1;
      baseTint = varyTint([0.99, 0.97, 0.93], seed);
      plinthColor = [0.58, 0.53, 0.45];
      windowKind = 'window_casco';
      balconyKind = 'balcony';
      portalKind = 'portal_casco';
      break;
    case 'casco_ochre':
      wallMaterial = 'casco_facade';
      atlasBand = 2;
      baseTint = varyTint([0.98, 0.91, 0.8], seed);
      plinthColor = [0.55, 0.49, 0.41];
      windowKind = 'window_casco';
      balconyKind = 'balcony';
      portalKind = 'portal_casco';
      break;
    case 'casco_terracotta':
      wallMaterial = 'casco_facade';
      atlasBand = 3;
      baseTint = varyTint([0.96, 0.86, 0.78], seed);
      plinthColor = [0.54, 0.47, 0.4];
      windowKind = 'window_casco';
      balconyKind = 'balcony';
      portalKind = 'portal_casco';
      break;
    case 'ensanche_brick':
      wallMaterial = 'ensanche_facade';
      atlasBand = 0;
      baseTint = varyTint([0.98, 0.92, 0.89], seed);
      plinthColor = [0.52, 0.5, 0.47];
      break;
    case 'ensanche_stucco':
      wallMaterial = 'ensanche_facade';
      atlasBand = 1;
      baseTint = varyTint([0.98, 0.94, 0.88], seed);
      plinthColor = [0.58, 0.56, 0.52];
      break;
    case 'ensanche_cream':
      wallMaterial = 'ensanche_facade';
      atlasBand = 2;
      baseTint = varyTint([0.97, 0.89, 0.83], seed);
      plinthColor = [0.56, 0.52, 0.48];
      break;
    case 'ensanche_modern':
      wallMaterial = 'ensanche_facade';
      atlasBand = 3;
      baseTint = varyTint([0.96, 0.97, 0.98], seed);
      plinthColor = [0.46, 0.48, 0.5];
      windowKind = 'window_modern';
      break;
    case 'periferia_chalet':
      wallMaterial = 'periferia_facade';
      atlasBand = 0;
      baseTint = varyTint([0.98, 0.96, 0.92], seed);
      plinthColor = [0.64, 0.54, 0.46];
      windowKind = 'window_modern';
      break;
    case 'periferia_block':
      wallMaterial = 'periferia_facade';
      atlasBand = 1;
      baseTint = varyTint([0.96, 0.92, 0.86], seed);
      plinthColor = [0.56, 0.54, 0.5];
      break;
    case 'periferia_industrial':
      wallMaterial = 'periferia_facade';
      atlasBand = 2;
      baseTint = varyTint([0.93, 0.95, 0.97], seed);
      plinthColor = [0.5, 0.52, 0.54];
      windowKind = 'window_modern';
      break;
    case 'periferia_civic':
      wallMaterial = 'periferia_facade';
      atlasBand = 3;
      baseTint = varyTint([0.96, 0.94, 0.9], seed);
      plinthColor = [0.52, 0.52, 0.5];
      windowKind = 'window_modern';
      break;
  }

  const useTileRoof =
    !isTowerFeature(feature) &&
    (feature.roofMaterial === 'tile' ||
      historic ||
      chalet ||
      sacred ||
      (feature.zone === 'ensanche' && roofShape !== 'flat' && archetype !== 'ensanche_modern'));

  const roofMaterial: BuildingMaterial = isTowerFeature(feature)
    ? 'monument_stone'
    : useTileRoof
      ? 'tile_roof'
      : 'modern_roof';

  return {
    archetype,
    wallMaterial,
    roofMaterial,
    atlasBand,
    tint: hexTint ?? baseTint,
    plinthColor,
    eaveOverhangMeters: roofShape !== 'flat' && useTileRoof ? 0.34 : 0,
    parapetHeightMeters: roofShape === 'flat' && !isTowerFeature(feature) ? 0.5 : 0,
    windowKind,
    balconyKind,
    portalKind,
    isHistoric: historic,
    isSacred: sacred,
    isIndustrial: industrial,
    isChalet: chalet,
  };
}
