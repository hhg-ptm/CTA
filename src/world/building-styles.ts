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

export type FacadeGrammarKind =
  | 'recessed_classical'
  | 'ensanche_loggia'
  | 'modern_grid'
  | 'chalet_cottage'
  | 'industrial_nave'
  | 'civic_campus';

export interface BuildingStyleSpec {
  readonly archetype: BuildingArchetype;
  readonly wallMaterial: BuildingMaterial;
  readonly roofMaterial: BuildingMaterial;
  readonly atlasBand: 0 | 1 | 2 | 3;
  readonly tint: BuildingColor;
  readonly trimColor: BuildingColor;
  readonly plinthColor: BuildingColor;
  readonly eaveOverhangMeters: number;
  readonly parapetHeightMeters: number;
  readonly fasciaThicknessMeters: number;
  readonly reliefDepthMeters: number;
  readonly floorHeightsMeters: { readonly ground: number; readonly upper: number };
  readonly facadeGrammar: FacadeGrammarKind;
  readonly supportsSetbackAttic: boolean;
  readonly windowKind: BuildingDetailKind;
  readonly secondaryWindowKind: BuildingDetailKind;
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
const CHALET_TYPES = new Set([
  'house',
  'terrace',
  'detached',
  'semidetached_house',
  'bungalow',
  'farm',
]);
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
  const use = feature.catastroUse ?? '';
  const era = feature.catastroEra ?? '';
  if (INDUSTRIAL_TYPES.has(type) || use === '3_industrial') return 'periferia_industrial';

  if (feature.zone === 'casco' || era === 'historic_pre_1900') {
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
    if (roll < 38) return 'casco_lime';
    if (roll < 72) return 'casco_ochre';
    if (roll < 90) return 'casco_terracotta';
    return 'casco_palace';
  }

  if (feature.zone === 'periferia') {
    if (CHALET_TYPES.has(type)) return 'periferia_chalet';
    if (MODERN_TYPES.has(type) || type === 'school' || use === '4_3_publicServices')
      return 'periferia_civic';
    if (use === '4_1_office' || use === '4_2_retail') return 'ensanche_modern';
    const floors = feature.visualFloors ?? feature.floors ?? 2;
    if (era === 'ensanche_1950_1985' || (type === 'apartments' && floors >= 5 && seed % 2 === 0)) {
      return seed % 3 === 0 ? 'ensanche_brick' : 'periferia_block';
    }
    const roll = seed % 100;
    if (roll < 50) return 'periferia_block';
    if (roll < 82) return 'periferia_chalet';
    return 'periferia_civic';
  }

  // Ensanche (Cáceres avenues & mid-ring residential/commercial blocks)
  if (CHALET_TYPES.has(type)) return 'ensanche_cream';
  if (
    MODERN_TYPES.has(type) ||
    use === '4_1_office' ||
    use === '4_3_publicServices' ||
    ((feature.commercial || use === '4_2_retail') && type !== 'apartments' && seed % 2 === 0)
  ) {
    return 'ensanche_modern';
  }
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
  if (feature.zone !== 'casco' && floors >= 5 && feature.catastroEra === 'modern_1985_plus')
    return 'flat';
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
  let secondaryWindowKind: BuildingDetailKind = 'window_awning';
  let balconyKind: BuildingDetailKind = 'balcony_modern';
  let portalKind: BuildingDetailKind = 'portal_modern';
  let facadeGrammar: FacadeGrammarKind = 'ensanche_loggia';
  let reliefDepthMeters = 0.13;
  let fasciaThicknessMeters = 0.2;
  let floorHeightsMeters = { ground: feature.commercial ? 4.0 : 3.3, upper: 3.0 };

  switch (archetype) {
    case 'casco_palace':
      wallMaterial = 'casco_facade';
      atlasBand = sacred && !WHITEWASH_CHURCH_IDS.has(feature.id ?? '') ? 3 : 0;
      baseTint = varyTint([0.97, 0.92, 0.84], seed);
      plinthColor = [0.55, 0.5, 0.42];
      windowKind = 'window_casco';
      secondaryWindowKind = 'window_casco';
      balconyKind = 'balcony';
      portalKind = 'portal_casco';
      facadeGrammar = 'recessed_classical';
      reliefDepthMeters = 0.15;
      fasciaThicknessMeters = 0.24;
      floorHeightsMeters = { ground: 3.8, upper: 3.2 };
      break;
    case 'casco_lime':
      wallMaterial = 'casco_facade';
      atlasBand = 1;
      baseTint = varyTint([0.99, 0.97, 0.93], seed);
      plinthColor = [0.58, 0.53, 0.45];
      windowKind = 'window_casco';
      secondaryWindowKind = 'window_awning';
      balconyKind = 'balcony';
      portalKind = 'portal_casco';
      facadeGrammar = 'recessed_classical';
      reliefDepthMeters = 0.12;
      fasciaThicknessMeters = 0.22;
      floorHeightsMeters = { ground: 3.5, upper: 3.1 };
      break;
    case 'casco_ochre':
      wallMaterial = 'casco_facade';
      atlasBand = 2;
      baseTint = varyTint([0.98, 0.91, 0.8], seed);
      plinthColor = [0.55, 0.49, 0.41];
      windowKind = 'window_casco';
      secondaryWindowKind = 'window_awning';
      balconyKind = 'balcony';
      portalKind = 'portal_casco';
      facadeGrammar = 'recessed_classical';
      reliefDepthMeters = 0.13;
      fasciaThicknessMeters = 0.22;
      floorHeightsMeters = { ground: 3.6, upper: 3.1 };
      break;
    case 'casco_terracotta':
      wallMaterial = 'casco_facade';
      atlasBand = 3;
      baseTint = varyTint([0.96, 0.86, 0.78], seed);
      plinthColor = [0.54, 0.47, 0.4];
      windowKind = 'window_casco';
      secondaryWindowKind = 'window_casco';
      balconyKind = 'balcony';
      portalKind = 'portal_casco';
      facadeGrammar = 'recessed_classical';
      reliefDepthMeters = 0.14;
      fasciaThicknessMeters = 0.24;
      floorHeightsMeters = { ground: 3.7, upper: 3.1 };
      break;
    case 'ensanche_brick':
      wallMaterial = 'ensanche_facade';
      atlasBand = 0;
      baseTint = varyTint([0.98, 0.92, 0.89], seed);
      plinthColor = [0.52, 0.5, 0.47];
      secondaryWindowKind = seed % 2 === 0 ? 'window_awning' : 'window_ensanche';
      facadeGrammar = 'ensanche_loggia';
      reliefDepthMeters = 0.15;
      fasciaThicknessMeters = 0.2;
      break;
    case 'ensanche_stucco':
      wallMaterial = 'ensanche_facade';
      atlasBand = 1;
      baseTint = varyTint([0.98, 0.94, 0.88], seed);
      plinthColor = [0.58, 0.56, 0.52];
      secondaryWindowKind = 'window_awning';
      facadeGrammar = 'ensanche_loggia';
      reliefDepthMeters = 0.14;
      fasciaThicknessMeters = 0.2;
      break;
    case 'ensanche_cream':
      wallMaterial = 'ensanche_facade';
      atlasBand = 2;
      baseTint = varyTint([0.97, 0.89, 0.83], seed);
      plinthColor = [0.56, 0.52, 0.48];
      secondaryWindowKind = 'window_awning';
      facadeGrammar = 'ensanche_loggia';
      reliefDepthMeters = 0.13;
      fasciaThicknessMeters = 0.22;
      break;
    case 'ensanche_modern':
      wallMaterial = 'ensanche_facade';
      atlasBand = 3;
      baseTint = varyTint([0.96, 0.97, 0.98], seed);
      plinthColor = [0.46, 0.48, 0.5];
      windowKind = 'window_modern';
      secondaryWindowKind = feature.commercial ? 'window_awning' : 'window_modern';
      facadeGrammar = 'modern_grid';
      reliefDepthMeters = 0.16;
      fasciaThicknessMeters = 0.22;
      floorHeightsMeters = { ground: 4.2, upper: 3.2 };
      break;
    case 'periferia_chalet':
      wallMaterial = 'periferia_facade';
      atlasBand = 0;
      baseTint = varyTint([0.98, 0.96, 0.92], seed);
      plinthColor = [0.64, 0.54, 0.46];
      windowKind = seed % 2 === 0 ? 'window_casco' : 'window_awning';
      secondaryWindowKind = 'window_modern';
      facadeGrammar = 'chalet_cottage';
      reliefDepthMeters = 0.11;
      fasciaThicknessMeters = 0.25;
      floorHeightsMeters = { ground: 3.1, upper: 2.9 };
      break;
    case 'periferia_block':
      wallMaterial = 'periferia_facade';
      atlasBand = 1;
      baseTint = varyTint([0.96, 0.92, 0.86], seed);
      plinthColor = [0.56, 0.54, 0.5];
      secondaryWindowKind = 'window_awning';
      facadeGrammar = 'ensanche_loggia';
      reliefDepthMeters = 0.14;
      fasciaThicknessMeters = 0.19;
      break;
    case 'periferia_industrial':
      wallMaterial = 'periferia_facade';
      atlasBand = 2;
      baseTint = varyTint([0.93, 0.95, 0.97], seed);
      plinthColor = [0.5, 0.52, 0.54];
      windowKind = 'window_modern';
      secondaryWindowKind = 'window_modern';
      facadeGrammar = 'industrial_nave';
      reliefDepthMeters = 0.1;
      fasciaThicknessMeters = 0.16;
      floorHeightsMeters = { ground: 5.2, upper: 3.6 };
      break;
    case 'periferia_civic':
      wallMaterial = 'periferia_facade';
      atlasBand = 3;
      baseTint = varyTint([0.96, 0.94, 0.9], seed);
      plinthColor = [0.52, 0.52, 0.5];
      windowKind = 'window_modern';
      secondaryWindowKind = 'window_modern';
      facadeGrammar = 'civic_campus';
      reliefDepthMeters = 0.16;
      fasciaThicknessMeters = 0.22;
      floorHeightsMeters = { ground: 4.3, upper: 3.5 };
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

  const tint = hexTint ?? baseTint;
  const trimColor: BuildingColor = [
    Math.min(1, tint[0] * 0.86 + 0.09),
    Math.min(1, tint[1] * 0.86 + 0.08),
    Math.min(1, tint[2] * 0.85 + 0.07),
  ];

  const floors = feature.visualFloors ?? feature.floors ?? 2;
  const supportsSetbackAttic =
    !industrial &&
    !chalet &&
    !sacred &&
    !isTowerFeature(feature) &&
    roofShape === 'flat' &&
    floors >= 5;

  return {
    archetype,
    wallMaterial,
    roofMaterial,
    atlasBand,
    tint,
    trimColor,
    plinthColor,
    eaveOverhangMeters:
      roofShape !== 'flat' && useTileRoof ? 0.36 : roofShape !== 'flat' ? 0.24 : 0,
    parapetHeightMeters: roofShape === 'flat' && !isTowerFeature(feature) ? 0.52 : 0,
    fasciaThicknessMeters,
    reliefDepthMeters,
    floorHeightsMeters,
    facadeGrammar,
    supportsSetbackAttic,
    windowKind,
    secondaryWindowKind,
    balconyKind,
    portalKind,
    isHistoric: historic,
    isSacred: sacred,
    isIndustrial: industrial,
    isChalet: chalet,
  };
}
