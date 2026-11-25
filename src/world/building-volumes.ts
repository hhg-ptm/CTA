import { BuildingGeometryWriter, type BuildingColor, type BuildingUv } from './building-geometry';
import { insetPolygon, ringSignedArea } from './polygon-holes';
import { sampleHeight, type RoadPoint, type RoadPoint3 } from './road-geometry';
import {
  isTowerFeature,
  type BuildingStyleSpec,
  type DetailBudgetConfig,
} from './building-styles';
import type { BuiltTerrainChunk, BuildingMaterial, ChunkFeature, ProjectedBounds } from './types';

export interface VolumeItem {
  readonly feature: ChunkFeature;
  readonly points: readonly RoadPoint[];
  readonly fullPoints: readonly RoadPoint[];
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
  readonly ridgeAxis: 0 | 1;
  readonly ridgeHalfSpan: number;
  readonly baseElevationOffset?: number;
  readonly innerRings?: readonly (readonly RoadPoint[])[];
}

export function solidTrimUv(col = 7, row = 0): [BuildingUv, BuildingUv, BuildingUv, BuildingUv] {
  const columns = 8;
  const rows = 8;
  const inset = 0.004;
  const u0 = col / columns + inset;
  const u1 = (col + 1) / columns - inset;
  const v0 = row / rows + inset;
  const v1 = (row + 1) / rows - inset;
  return [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
}

export function solidBoxFaceUv(
  uv: [BuildingUv, BuildingUv, BuildingUv, BuildingUv],
): [BuildingUv, BuildingUv, BuildingUv, BuildingUv] {
  return uv;
}

function wp(point: RoadPoint, y: number): RoadPoint3 {
  return [point[0], y, point[1]];
}

function groundAt(terrain: BuiltTerrainChunk, point: RoadPoint): number {
  return sampleHeight(terrain, point[0], point[1]);
}

function faceAlignedForward(a: RoadPoint, b: RoadPoint, outward: RoadPoint): boolean {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  return -dz * outward[0] + dx * outward[1] >= 0;
}

function orientSpan(
  a: RoadPoint,
  b: RoadPoint,
  gA: number,
  gB: number,
  outward: RoadPoint,
): { s: RoadPoint; e: RoadPoint; gS: number; gE: number } {
  if (faceAlignedForward(a, b, outward)) return { s: a, e: b, gS: gA, gE: gB };
  return { s: b, e: a, gS: gB, gE: gA };
}

function lerpPoint(a: RoadPoint, b: RoadPoint, t: number): RoadPoint {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function darken(color: BuildingColor, factor: number): BuildingColor {
  return [
    Math.max(0.08, color[0] * factor),
    Math.max(0.08, color[1] * factor),
    Math.max(0.08, color[2] * factor),
  ];
}

function glassAtlasUv(atlasBand: 0 | 1 | 2 | 3): [BuildingUv, BuildingUv, BuildingUv, BuildingUv] {
  const glassUvRow = atlasBand * 2 + 1;
  const gx0 = 39 / (128 * 8);
  const gx1 = 89 / (128 * 8);
  const gy0 = glassUvRow / 8 + (1 - 91 / 128) / 8;
  const gy1 = glassUvRow / 8 + (1 - 25 / 128) / 8;
  return [
    [gx0, gy0],
    [gx1, gy0],
    [gx1, gy1],
    [gx0, gy1],
  ];
}

/**
 * Emit a 3D rectangular prism protruding outward from edge `[a, b]` with outward-guaranteed
 * winding for front, top, bottom, and optional end-cap faces.
 */
function addProjectingBox(
  writer: BuildingGeometryWriter,
  material: BuildingMaterial,
  a: RoadPoint,
  b: RoadPoint,
  outward: RoadPoint,
  y0A: number,
  y0B: number,
  y1A: number,
  y1B: number,
  depth: number,
  frontColor: BuildingColor,
  sideColor: BuildingColor,
  uv: [BuildingUv, BuildingUv, BuildingUv, BuildingUv],
  includeCaps = true,
  baseOffset = 0,
): void {
  const { s, e, gS, gE } = orientSpan(a, b, y0A, y0B, outward);
  const topS = gS === y0A ? y1A : y1B;
  const topE = gE === y0B ? y1B : y1A;
  const sb: RoadPoint =
    baseOffset === 0 ? s : [s[0] + outward[0] * baseOffset, s[1] + outward[1] * baseOffset];
  const eb: RoadPoint =
    baseOffset === 0 ? e : [e[0] + outward[0] * baseOffset, e[1] + outward[1] * baseOffset];
  const so: RoadPoint = [s[0] + outward[0] * depth, s[1] + outward[1] * depth];
  const eo: RoadPoint = [e[0] + outward[0] * depth, e[1] + outward[1] * depth];

  writer.addQuad(material, [wp(so, gS), wp(eo, gE), wp(eo, topE), wp(so, topS)], frontColor, uv);
  writer.addQuad(material, [wp(so, topS), wp(eo, topE), wp(eb, topE), wp(sb, topS)], sideColor, uv);
  writer.addQuad(material, [wp(sb, gS), wp(eb, gE), wp(eo, gE), wp(so, gS)], sideColor, uv);
  if (includeCaps) {
    writer.addQuad(material, [wp(sb, gS), wp(so, gS), wp(so, topS), wp(sb, topS)], sideColor, uv);
    writer.addQuad(material, [wp(eo, gE), wp(eb, gE), wp(eb, topE), wp(eo, topE)], sideColor, uv);
  }
}

function addProjectingBoxRib(
  writer: BuildingGeometryWriter,
  material: BuildingMaterial,
  a: RoadPoint,
  b: RoadPoint,
  outward: RoadPoint,
  y0A: number,
  y0B: number,
  y1A: number,
  y1B: number,
  depth: number,
  color: BuildingColor,
  uv: [BuildingUv, BuildingUv, BuildingUv, BuildingUv],
): void {
  addProjectingBox(writer, material, a, b, outward, y0A, y0B, y1A, y1B, depth, color, color, uv, false);
}

/**
 * Emit a real 3D recessed window bay, loggia terrace pocket, or commercial storefront cell
 * adapted to typology and budget config, with zero extra draw calls.
 */
export function addRecessedWindowCell(
  writer: BuildingGeometryWriter,
  item: VolumeItem,
  panelStart: RoadPoint,
  panelEnd: RoadPoint,
  outward: RoadPoint,
  groundStart: number,
  groundEnd: number,
  floorBottom: number,
  floorTop: number,
  floorIndex: number,
  panelIndex: number,
  exposed: boolean,
  isSetback: boolean,
  budget?: DetailBudgetConfig,
  hasBalcony = false,
  isMiradorCell = false,
): void {
  const { style, seed } = item;
  const uvRow = style.atlasBand * 2 + (floorIndex === 0 && !isSetback ? 0 : 1);
  const wallUv = solidTrimUv(7, uvRow);
  const { s: pS, e: pE, gS, gE } = orientSpan(
    panelStart,
    panelEnd,
    groundStart,
    groundEnd,
    outward,
  );
  const panelLen = Math.hypot(pE[0] - pS[0], pE[1] - pS[1]);
  const floorH = floorTop - floorBottom;
  const minCellWidth = budget ? Math.min(2.45, Math.max(1.12, budget.minEdgeMeters * 0.92)) : 2.45;
  const enableFrames = budget ? budget.enableTrimFramesOnOpenings : true;

  const isTower = isTowerFeature(item.feature);
  const skipGroundIndustrial =
    style.isIndustrial && (floorIndex === 0 || (panelIndex + floorIndex) % 2 === 1);
  const skipGroundSolid =
    floorIndex === 0 &&
    !isSetback &&
    !item.feature.commercial &&
    (budget?.profile === '600k' ? (panelIndex + seed) % 3 === 1 : (panelIndex + seed) % 4 === 1);
  const isCornerQuoinOnly = style.isHistoric && floorIndex === 0 && panelLen < 1.35;

  if (
    !exposed ||
    isTower ||
    isMiradorCell ||
    panelLen < minCellWidth ||
    floorH < 2.15 ||
    skipGroundIndustrial ||
    skipGroundSolid ||
    isCornerQuoinOnly
  ) {
    writer.addQuad(
      style.wallMaterial,
      [wp(pS, gS + floorBottom), wp(pE, gE + floorBottom), wp(pE, gE + floorTop), wp(pS, gS + floorTop)],
      style.tint,
      wallUv,
    );
    return;
  }

  const isLoggiaBay =
    enableFrames &&
    style.facadeGrammar === 'ensanche_loggia' &&
    floorIndex >= 1 &&
    !isSetback &&
    !hasBalcony &&
    (panelIndex + seed) % 2 === 1 &&
    panelLen >= 2.15;

  let widthMeters = Math.min(panelLen * 0.48, 1.3);
  let sillFrac = floorIndex === 0 && !isSetback ? 0.34 : 0.25;
  let headFrac = 0.85;

  if (isLoggiaBay) {
    widthMeters = panelLen * 0.7;
    sillFrac = 0.08;
    headFrac = 0.88;
  } else if (style.facadeGrammar === 'modern_grid' || style.facadeGrammar === 'civic_campus') {
    widthMeters = Math.min(panelLen * 0.72, enableFrames ? 2.45 : panelLen * 0.58);
    sillFrac = floorIndex === 0 && !isSetback ? 0.16 : 0.18;
    headFrac = 0.88;
  } else if (style.facadeGrammar === 'industrial_nave') {
    widthMeters = panelLen * 0.68;
    sillFrac = 0.48;
    headFrac = 0.84;
  } else if (style.facadeGrammar === 'ensanche_loggia') {
    widthMeters = Math.min(panelLen * 0.58, enableFrames ? 1.75 : panelLen * 0.5);
    sillFrac = floorIndex === 0 && !isSetback ? (item.feature.commercial ? 0.1 : 0.3) : 0.24;
    headFrac = 0.86;
  } else if (style.facadeGrammar === 'chalet_cottage') {
    widthMeters = Math.min(panelLen * 0.48, 1.45);
    sillFrac = floorIndex === 0 && !isSetback ? 0.3 : 0.26;
    headFrac = 0.82;
  } else {
    // recessed_classical (Casco)
    widthMeters = enableFrames ? Math.min(panelLen * 0.5, 1.24) : panelLen * 0.46;
    sillFrac = floorIndex === 0 && !isSetback ? (item.feature.commercial ? 0.12 : 0.34) : 0.23;
    headFrac = 0.86;
  }

  if (floorIndex === 0 && !isSetback && item.feature.commercial && !style.isIndustrial) {
    widthMeters = Math.max(widthMeters, Math.min(panelLen * 0.68, 2.2));
    sillFrac = 0.09;
    headFrac = 0.84;
  }
  if (hasBalcony) {
    sillFrac = 0.05;
    headFrac = 0.87;
  }

  const halfFrac = Math.min(0.36, Math.max(0.18, (widthMeters / panelLen) * 0.5));
  const uWin0 = 0.5 - halfFrac;
  const uWin1 = 0.5 + halfFrac;

  const wS = lerpPoint(pS, pE, uWin0);
  const wE = lerpPoint(pS, pE, uWin1);
  const wgS = gS + (gE - gS) * uWin0;
  const wgE = gS + (gE - gS) * uWin1;
  const yWin0 = floorBottom + floorH * sillFrac;
  const yWin1 = floorBottom + floorH * headFrac;

  // 1. Cut the wall into 4 clean surround quads around the window opening
  const [uvBL, uvBR, , uvTL] = wallUv;
  const subUv = (
    fu0: number,
    fu1: number,
    fv0: number,
    fv1: number,
  ): [BuildingUv, BuildingUv, BuildingUv, BuildingUv] => {
    const uA = uvBL[0] + (uvBR[0] - uvBL[0]) * fu0;
    const uB = uvBL[0] + (uvBR[0] - uvBL[0]) * fu1;
    const vA = uvBL[1] + (uvTL[1] - uvBL[1]) * fv0;
    const vB = uvBL[1] + (uvTL[1] - uvBL[1]) * fv1;
    return [
      [uA, vA],
      [uB, vA],
      [uB, vB],
      [uA, vB],
    ];
  };
  writer.addQuad(
    style.wallMaterial,
    [wp(pS, gS + floorBottom), wp(wS, wgS + floorBottom), wp(wS, wgS + floorTop), wp(pS, gS + floorTop)],
    style.tint,
    subUv(0, uWin0, 0, 1),
  );
  writer.addQuad(
    style.wallMaterial,
    [wp(wE, wgE + floorBottom), wp(pE, gE + floorBottom), wp(pE, gE + floorTop), wp(wE, wgE + floorTop)],
    style.tint,
    subUv(uWin1, 1, 0, 1),
  );
  writer.addQuad(
    style.wallMaterial,
    [wp(wS, wgS + floorBottom), wp(wE, wgE + floorBottom), wp(wE, wgE + yWin0), wp(wS, wgS + yWin0)],
    style.tint,
    subUv(uWin0, uWin1, 0, sillFrac),
  );
  writer.addQuad(
    style.wallMaterial,
    [wp(wS, wgS + yWin1), wp(wE, wgE + yWin1), wp(wE, wgE + floorTop), wp(wS, wgS + floorTop)],
    style.tint,
    subUv(uWin0, uWin1, headFrac, 1),
  );

  // 2. Recessed glazing pane inside deep wall pocket
  const recess = isLoggiaBay ? -0.36 : enableFrames ? -0.18 : -0.14;
  const wSIn: RoadPoint = [wS[0] + outward[0] * recess, wS[1] + outward[1] * recess];
  const wEIn: RoadPoint = [wE[0] + outward[0] * recess, wE[1] + outward[1] * recess];
  const glassUv = glassAtlasUv(style.atlasBand);
  writer.addQuad(
    style.wallMaterial,
    [wp(wSIn, wgS + yWin0), wp(wEIn, wgE + yWin0), wp(wEIn, wgE + yWin1), wp(wSIn, wgS + yWin1)],
    [1, 1, 1],
    glassUv,
  );

  // 3. Recessed left/right/top/bottom reveal walls
  const revealUv = solidTrimUv(7, style.atlasBand * 2);
  const revealColor = darken(style.plinthColor, isLoggiaBay ? 0.72 : 0.84);
  writer.addQuad(
    style.wallMaterial,
    [wp(wS, wgS + yWin0), wp(wSIn, wgS + yWin0), wp(wSIn, wgS + yWin1), wp(wS, wgS + yWin1)],
    revealColor,
    revealUv,
  );
  writer.addQuad(
    style.wallMaterial,
    [wp(wEIn, wgE + yWin0), wp(wE, wgE + yWin0), wp(wE, wgE + yWin1), wp(wEIn, wgE + yWin1)],
    revealColor,
    revealUv,
  );
  writer.addQuad(
    style.wallMaterial,
    [wp(wS, wgS + yWin1), wp(wE, wgE + yWin1), wp(wEIn, wgE + yWin1), wp(wSIn, wgS + yWin1)],
    revealColor,
    revealUv,
  );
  if (isLoggiaBay) {
    writer.addQuad(
      style.wallMaterial,
      [wp(wS, wgS + yWin0), wp(wE, wgE + yWin0), wp(wEIn, wgE + yWin0), wp(wSIn, wgS + yWin0)],
      darken(style.trimColor, 0.82),
      wallUv,
    );
  }

  // 4. Protruding 3D sill / integral loggia terrace balcony slab & railing
  if (isLoggiaBay) {
    // Loggia slab floor + charcoal glass guardrail protruding +0.20 m
    addProjectingBox(
      writer,
      style.wallMaterial,
      wS,
      wE,
      outward,
      wgS + yWin0 - 0.1,
      wgE + yWin0 - 0.1,
      wgS + yWin0 + 0.06,
      wgE + yWin0 + 0.06,
      0.22,
      style.trimColor,
      style.plinthColor,
      wallUv,
      true,
      recess,
    );
    const railColor: BuildingColor = [0.24, 0.27, 0.31];
    addProjectingBox(
      writer,
      style.wallMaterial,
      wS,
      wE,
      outward,
      wgS + yWin0 + 0.06,
      wgE + yWin0 + 0.06,
      wgS + yWin0 + 0.82,
      wgE + yWin0 + 0.82,
      0.2,
      railColor,
      [0.32, 0.36, 0.42],
      wallUv,
      true,
      0.13,
    );
  } else {
    const sillDepth = Math.min(0.14, style.reliefDepthMeters * 0.9);
    const sOut: RoadPoint = [wS[0] + outward[0] * sillDepth, wS[1] + outward[1] * sillDepth];
    const eOut: RoadPoint = [wE[0] + outward[0] * sillDepth, wE[1] + outward[1] * sillDepth];
    writer.addQuad(
      style.wallMaterial,
      [
        wp(sOut, wgS + yWin0 - 0.06),
        wp(eOut, wgE + yWin0 - 0.06),
        wp(eOut, wgE + yWin0 + 0.025),
        wp(sOut, wgS + yWin0 + 0.025),
      ],
      style.trimColor,
      wallUv,
    );
    writer.addQuad(
      style.wallMaterial,
      [
        wp(wSIn, wgS + yWin0 + 0.025),
        wp(wEIn, wgE + yWin0 + 0.025),
        wp(eOut, wgE + yWin0 + 0.025),
        wp(sOut, wgS + yWin0 + 0.025),
      ],
      style.trimColor,
      wallUv,
    );
  }

  // 5. Lean 3D Architrave Side Jambs + Front-strip Center Mullion + Transom (zero wasted interior faces)
  const frameUv = solidTrimUv(7, style.atlasBand * 2 + 1);
  if (enableFrames && !isLoggiaBay) {
    const jambW = Math.min(0.11, panelLen * uWin0 * 0.55);
    const jDepth = 0.065;
    if (jambW >= 0.05) {
      const jFrac = jambW / panelLen;
      const jl0 = lerpPoint(pS, pE, uWin0 - jFrac);
      const jl1 = lerpPoint(pS, pE, uWin0);
      const gl0 = gS + (gE - gS) * (uWin0 - jFrac);
      const gl1 = gS + (gE - gS) * uWin0;
      const jl0o: RoadPoint = [jl0[0] + outward[0] * jDepth, jl0[1] + outward[1] * jDepth];
      const jl1o: RoadPoint = [jl1[0] + outward[0] * jDepth, jl1[1] + outward[1] * jDepth];
      writer.addQuad(style.wallMaterial, [wp(jl0o, gl0 + yWin0), wp(jl1o, gl1 + yWin0), wp(jl1o, gl1 + yWin1), wp(jl0o, gl0 + yWin1)], style.trimColor, frameUv);
      writer.addQuad(style.wallMaterial, [wp(jl0, gl0 + yWin0), wp(jl0o, gl0 + yWin0), wp(jl0o, gl0 + yWin1), wp(jl0, gl0 + yWin1)], style.plinthColor, frameUv);

      const jr0 = lerpPoint(pS, pE, uWin1);
      const jr1 = lerpPoint(pS, pE, uWin1 + jFrac);
      const gr0 = gS + (gE - gS) * uWin1;
      const gr1 = gS + (gE - gS) * (uWin1 + jFrac);
      const jr0o: RoadPoint = [jr0[0] + outward[0] * jDepth, jr0[1] + outward[1] * jDepth];
      const jr1o: RoadPoint = [jr1[0] + outward[0] * jDepth, jr1[1] + outward[1] * jDepth];
      writer.addQuad(style.wallMaterial, [wp(jr0o, gr0 + yWin0), wp(jr1o, gr1 + yWin0), wp(jr1o, gr1 + yWin1), wp(jr0o, gr0 + yWin1)], style.trimColor, frameUv);
      writer.addQuad(style.wallMaterial, [wp(jr1o, gr1 + yWin0), wp(jr1, gr1 + yWin0), wp(jr1, gr1 + yWin1), wp(jr1o, gr1 + yWin1)], style.plinthColor, frameUv);
    }
  }

  if (enableFrames && yWin1 - yWin0 >= 1.15 && widthMeters >= 0.85) {
    const mulHalf = 0.032 / panelLen;
    const mS = lerpPoint(pS, pE, 0.5 - mulHalf);
    const mE = lerpPoint(pS, pE, 0.5 + mulHalf);
    const mgS = gS + (gE - gS) * (0.5 - mulHalf);
    const mgE = gS + (gE - gS) * (0.5 + mulHalf);
    const barOut = recess + 0.045;
    const mSo: RoadPoint = [mS[0] + outward[0] * barOut, mS[1] + outward[1] * barOut];
    const mEo: RoadPoint = [mE[0] + outward[0] * barOut, mE[1] + outward[1] * barOut];
    const barColor: BuildingColor =
      style.facadeGrammar === 'modern_grid'
        ? [0.22, 0.25, 0.29]
        : style.facadeGrammar === 'chalet_cottage'
          ? [0.95, 0.94, 0.9]
          : [0.28, 0.22, 0.17];
    writer.addQuad(
      style.wallMaterial,
      [wp(mSo, mgS + yWin0 + 0.02), wp(mEo, mgE + yWin0 + 0.02), wp(mEo, mgE + yWin1 - 0.02), wp(mSo, mgS + yWin1 - 0.02)],
      barColor,
      frameUv,
    );
    if (!hasBalcony && yWin1 - yWin0 >= 1.7) {
      const yTransom = yWin0 + (yWin1 - yWin0) * 0.68;
      const wSoBar: RoadPoint = [wS[0] + outward[0] * barOut, wS[1] + outward[1] * barOut];
      const wEoBar: RoadPoint = [wE[0] + outward[0] * barOut, wE[1] + outward[1] * barOut];
      writer.addQuad(
        style.wallMaterial,
        [wp(wSoBar, wgS + yTransom - 0.03), wp(wEoBar, wgE + yTransom - 0.03), wp(wEoBar, wgE + yTransom + 0.03), wp(wSoBar, wgS + yTransom + 0.03)],
        barColor,
        frameUv,
      );
    }
  }

  // 6. Protruding top awning canopy OR crisp stepped lintel header
  const wantsAwning =
    style.secondaryWindowKind === 'window_awning' &&
    !hasBalcony &&
    !isLoggiaBay &&
    floorIndex >= 1 &&
    (item.feature.commercial || style.isChalet) &&
    (panelIndex + floorIndex + seed) % 3 === 0;
  if (wantsAwning) {
    const hoodDepth = 0.36;
    const wAwnStart: RoadPoint = [wS[0] + outward[0] * hoodDepth, wS[1] + outward[1] * hoodDepth];
    const wAwnEnd: RoadPoint = [wE[0] + outward[0] * hoodDepth, wE[1] + outward[1] * hoodDepth];
    const awningColor: BuildingColor = seed % 2 === 0 ? [0.22, 0.44, 0.78] : [0.82, 0.36, 0.24];
    writer.addQuad(
      style.wallMaterial,
      [
        wp(wAwnStart, wgS + yWin1 - 0.16),
        wp(wAwnEnd, wgE + yWin1 - 0.16),
        wp(wE, wgE + yWin1 + 0.1),
        wp(wS, wgS + yWin1 + 0.1),
      ],
      awningColor,
      wallUv,
    );
    writer.addQuad(
      style.wallMaterial,
      [
        wp(wAwnStart, wgS + yWin1 - 0.24),
        wp(wAwnEnd, wgE + yWin1 - 0.24),
        wp(wAwnEnd, wgE + yWin1 - 0.16),
        wp(wAwnStart, wgS + yWin1 - 0.16),
      ],
      darken(awningColor, 0.85),
      wallUv,
    );
  } else {
    const lDepth = style.archetype === 'casco_palace' && enableFrames ? 0.11 : 0.085;
    addProjectingBoxRib(
      writer,
      style.wallMaterial,
      wS,
      wE,
      outward,
      wgS + yWin1 - 0.015,
      wgE + yWin1 - 0.015,
      wgS + yWin1 + (enableFrames ? 0.095 : 0.075),
      wgE + yWin1 + (enableFrames ? 0.095 : 0.075),
      lDepth,
      style.trimColor,
      frameUv,
    );
  }

  // 7. Stylized 3D Shutters on traditional Casco / Chalet windows (lean L-profile blades)
  const wantsShutters =
    !wantsAwning &&
    !hasBalcony &&
    !isLoggiaBay &&
    (style.facadeGrammar === 'recessed_classical' || style.facadeGrammar === 'chalet_cottage') &&
    (panelIndex + floorIndex + seed) % 2 === 0 &&
    panelLen * uWin0 >= 0.22;
  if (wantsShutters) {
    const shFrac = Math.min(0.11, uWin0 * 0.72);
    const shColor: BuildingColor = seed % 2 === 0 ? [0.27, 0.39, 0.31] : [0.46, 0.3, 0.21];
    const shDepth = enableFrames ? 0.05 : 0.04;
    const lS = lerpPoint(pS, pE, Math.max(0.02, uWin0 - shFrac));
    const rE = lerpPoint(pS, pE, Math.min(0.98, uWin1 + shFrac));
    const lgS = gS + (gE - gS) * Math.max(0.02, uWin0 - shFrac);
    const rgE = gS + (gE - gS) * Math.min(0.98, uWin1 + shFrac);
    const lSo: RoadPoint = [lS[0] + outward[0] * shDepth, lS[1] + outward[1] * shDepth];
    const wSoSh: RoadPoint = [wS[0] + outward[0] * shDepth, wS[1] + outward[1] * shDepth];
    const wEoSh: RoadPoint = [wE[0] + outward[0] * shDepth, wE[1] + outward[1] * shDepth];
    const rEo: RoadPoint = [rE[0] + outward[0] * shDepth, rE[1] + outward[1] * shDepth];
    writer.addQuad(style.wallMaterial, [wp(lSo, lgS + yWin0 + 0.02), wp(wSoSh, wgS + yWin0 + 0.02), wp(wSoSh, wgS + yWin1 - 0.02), wp(lSo, lgS + yWin1 - 0.02)], shColor, revealUv);
    writer.addQuad(style.wallMaterial, [wp(lS, lgS + yWin0 + 0.02), wp(lSo, lgS + yWin0 + 0.02), wp(lSo, lgS + yWin1 - 0.02), wp(lS, lgS + yWin1 - 0.02)], darken(shColor, 0.8), revealUv);
    writer.addQuad(style.wallMaterial, [wp(wEoSh, wgE + yWin0 + 0.02), wp(rEo, rgE + yWin0 + 0.02), wp(rEo, rgE + yWin1 - 0.02), wp(wEoSh, wgE + yWin1 - 0.02)], shColor, revealUv);
    writer.addQuad(style.wallMaterial, [wp(rEo, rgE + yWin0 + 0.02), wp(rE, rgE + yWin0 + 0.02), wp(rE, rgE + yWin1 - 0.02), wp(rEo, rgE + yWin1 - 0.02)], darken(shColor, 0.8), revealUv);
  }
}

/**
 * Emit protruding vertical architectural pilasters/mullions between bay dividers
 * so facade panels sit cleanly recessed inside a 3D frame without adding extra draw calls.
 */
export function addFacadeReliefFrames(
  writer: BuildingGeometryWriter,
  item: VolumeItem,
  start: RoadPoint,
  end: RoadPoint,
  outward: RoadPoint,
  startGround: number,
  endGround: number,
  panels: number,
  floors: number,
): void {
  const { style, wallHeight } = item;
  const baseOffset = item.baseElevationOffset ?? 0;
  const trimRow = style.atlasBand * 2 + 1;
  const pierUv = solidTrimUv(7, trimRow);
  const { s, e, gS, gE } = orientSpan(start, end, startGround, endGround, outward);
  const len = Math.hypot(e[0] - s[0], e[1] - s[1]);
  if (len < 3.6) return;

  const depth = style.reliefDepthMeters;
  const pierHalfW = Math.min(0.16, (len / Math.max(1, panels)) * 0.065);
  const startWallFloor = baseOffset > 0.1 ? 0 : 1;
  const bottomY = baseOffset + (floors > 1 && startWallFloor === 1 ? wallHeight / floors : 0);

  if (
    panels >= 2 &&
    (style.facadeGrammar === 'modern_grid' ||
      style.facadeGrammar === 'recessed_classical' ||
      style.facadeGrammar === 'ensanche_loggia' ||
      len >= 6.5)
  ) {
    const pierIndices = style.facadeGrammar === 'modern_grid' ? panels + 1 : panels - 1;
    for (let k = 0; k < pierIndices; k += 1) {
      const idx = style.facadeGrammar === 'modern_grid' ? k : k + 1;
      const t = idx / panels;
      const tL = Math.max(0, t - pierHalfW / len);
      const tR = Math.min(1, t + pierHalfW / len);
      const pL = lerpPoint(s, e, tL);
      const pR = lerpPoint(s, e, tR);
      const gL = gS + (gE - gS) * tL;
      const gR = gS + (gE - gS) * tR;
      const yBotL = gL + (idx === 0 || idx === panels ? baseOffset : bottomY);
      const yBotR = gR + (idx === 0 || idx === panels ? baseOffset : bottomY);
      const yTopL = gL + baseOffset + wallHeight;
      const yTopR = gR + baseOffset + wallHeight;

      addProjectingBox(
        writer,
        style.wallMaterial,
        pL,
        pR,
        outward,
        yBotL,
        yBotR,
        yTopL,
        yTopR,
        depth,
        style.trimColor,
        style.plinthColor,
        pierUv,
        true,
      );
    }
  }
}

/**
 * Emit projecting alternating carved granite corner quoins ("sillares en esquina")
 * along exposed historic Cáceres corners.
 */
export function addCornerQuoins(
  writer: BuildingGeometryWriter,
  item: VolumeItem,
  start: RoadPoint,
  end: RoadPoint,
  outward: RoadPoint,
  startGround: number,
  endGround: number,
  exposed: boolean,
  isSetback: boolean,
): void {
  const { style, wallHeight } = item;
  if (!exposed || isSetback || !style.isHistoric || isTowerFeature(item.feature)) return;
  const { s, e, gS, gE } = orientSpan(start, end, startGround, endGround, outward);
  const len = Math.hypot(e[0] - s[0], e[1] - s[1]);
  if (len < 2.2) return;

  const baseOffset = item.baseElevationOffset ?? 0;
  const quoinUv = solidTrimUv(7, style.atlasBand * 2);
  const maxY = Math.min(wallHeight - 0.35, 11.5);
  const stepY = 0.72;
  const blockH = 0.5;
  const longW = Math.min(0.68, len * 0.22);
  const shortW = Math.min(0.4, len * 0.14);
  const depth = 0.08;

  for (let row = 0; 0.72 + row * stepY + blockH <= maxY; row += 1) {
    const w = row % 2 === 0 ? longW : shortW;
    const frac = w / len;
    const y0 = baseOffset + 0.72 + row * stepY;
    const y1 = y0 + blockH;

    // Start corner quoin (lean front + outer cap + top/bottom)
    const sEnd = lerpPoint(s, e, frac);
    const gsEnd = gS + (gE - gS) * frac;
    const so: RoadPoint = [s[0] + outward[0] * depth, s[1] + outward[1] * depth];
    const sEndo: RoadPoint = [sEnd[0] + outward[0] * depth, sEnd[1] + outward[1] * depth];
    writer.addQuad(style.wallMaterial, [wp(so, gS + y0), wp(sEndo, gsEnd + y0), wp(sEndo, gsEnd + y1), wp(so, gS + y1)], style.plinthColor, quoinUv);
    writer.addQuad(style.wallMaterial, [wp(so, gS + y1), wp(sEndo, gsEnd + y1), wp(sEnd, gsEnd + y1), wp(s, gS + y1)], darken(style.plinthColor, 0.9), quoinUv);
    writer.addQuad(style.wallMaterial, [wp(s, gS + y0), wp(so, gS + y0), wp(so, gS + y1), wp(s, gS + y1)], darken(style.plinthColor, 0.84), quoinUv);

    // End corner quoin
    const eStart = lerpPoint(s, e, 1 - frac);
    const geStart = gS + (gE - gS) * (1 - frac);
    const eo: RoadPoint = [e[0] + outward[0] * depth, e[1] + outward[1] * depth];
    const eStarto: RoadPoint = [eStart[0] + outward[0] * depth, eStart[1] + outward[1] * depth];
    writer.addQuad(style.wallMaterial, [wp(eStarto, geStart + y0), wp(eo, gE + y0), wp(eo, gE + y1), wp(eStarto, geStart + y1)], style.plinthColor, quoinUv);
    writer.addQuad(style.wallMaterial, [wp(eStarto, geStart + y1), wp(eo, gE + y1), wp(e, gE + y1), wp(eStart, geStart + y1)], darken(style.plinthColor, 0.9), quoinUv);
    writer.addQuad(style.wallMaterial, [wp(eo, gE + y0), wp(e, gE + y0), wp(e, gE + y1), wp(eo, gE + y1)], darken(style.plinthColor, 0.84), quoinUv);
  }
}

/**
 * Emit Plaza-style historic stone portico piers/entablatures ("soportales") or modern
 * commercial marquee canopies on primary ground-floor street edges.
 */
export function addGroundPorticoAndEntablature(
  writer: BuildingGeometryWriter,
  item: VolumeItem,
  start: RoadPoint,
  end: RoadPoint,
  outward: RoadPoint,
  startGround: number,
  endGround: number,
  panels: number,
  floors: number,
  isPrimaryEdge: boolean,
  isSetback: boolean,
): void {
  if (isSetback || !isPrimaryEdge || floors < 1) return;
  const { style } = item;
  const { s, e, gS, gE } = orientSpan(start, end, startGround, endGround, outward);
  const len = Math.hypot(e[0] - s[0], e[1] - s[1]);
  if (len < 4.5 || panels < 2) return;

  const groundTop = item.wallHeight / floors;
  if (groundTop < 2.6) return;
  const trimUv = solidTrimUv(7, style.atlasBand * 2);

  if (
    style.isHistoric &&
    floors >= 2 &&
    (item.feature.zone === 'casco' || style.archetype === 'casco_palace')
  ) {
    // Historic Casco granite soportal piers + capitals + stepped entablature
    const pierHalf = 0.21;
    for (let k = 0; k <= panels; k += 1) {
      const t = k / panels;
      const t0 = Math.max(0, t - pierHalf / len);
      const t1 = Math.min(1, t + pierHalf / len);
      const p0 = lerpPoint(s, e, t0);
      const p1 = lerpPoint(s, e, t1);
      const g0 = gS + (gE - gS) * t0;
      const g1 = gS + (gE - gS) * t1;
      addProjectingBox(
        writer,
        style.wallMaterial,
        p0,
        p1,
        outward,
        g0 - 0.2,
        g1 - 0.2,
        g0 + 0.55,
        g1 + 0.55,
        0.37,
        style.plinthColor,
        darken(style.plinthColor, 0.85),
        trimUv,
        true,
      );
      addProjectingBox(
        writer,
        style.wallMaterial,
        p0,
        p1,
        outward,
        g0 + 0.55,
        g1 + 0.55,
        g0 + groundTop - 0.32,
        g1 + groundTop - 0.32,
        0.32,
        style.trimColor,
        style.plinthColor,
        trimUv,
        true,
      );
      addProjectingBox(
        writer,
        style.wallMaterial,
        p0,
        p1,
        outward,
        g0 + groundTop - 0.32,
        g1 + groundTop - 0.32,
        g0 + groundTop - 0.1,
        g1 + groundTop - 0.1,
        0.37,
        style.plinthColor,
        darken(style.plinthColor, 0.86),
        trimUv,
        true,
      );
    }
    // Continuous stepped stone entablature frieze across arcade top
    addProjectingBox(
      writer,
      style.wallMaterial,
      s,
      e,
      outward,
      gS + groundTop - 0.12,
      gE + groundTop - 0.12,
      gS + groundTop + 0.16,
      gE + groundTop + 0.16,
      0.4,
      style.trimColor,
      style.plinthColor,
      solidTrimUv(7, style.atlasBand * 2 + 1),
      true,
    );
  } else if (item.feature.commercial || style.facadeGrammar === 'modern_grid') {
    // Commercial / modern cantilevered storefront marquee canopy & dark pilasters
    const canopyColor: BuildingColor = [0.24, 0.26, 0.3];
    addProjectingBox(
      writer,
      style.wallMaterial,
      s,
      e,
      outward,
      gS + groundTop - 0.14,
      gE + groundTop - 0.14,
      gS + groundTop + 0.08,
      gE + groundTop + 0.08,
      0.42,
      canopyColor,
      darken(canopyColor, 0.85),
      trimUv,
      true,
    );
    for (let k = 0; k <= panels; k += 1) {
      const t = k / panels;
      const t0 = Math.max(0, t - 0.14 / len);
      const t1 = Math.min(1, t + 0.14 / len);
      const p0 = lerpPoint(s, e, t0);
      const p1 = lerpPoint(s, e, t1);
      const g0 = gS + (gE - gS) * t0;
      const g1 = gS + (gE - gS) * t1;
      addProjectingBox(
        writer,
        style.wallMaterial,
        p0,
        p1,
        outward,
        g0 - 0.15,
        g1 - 0.15,
        g0 + groundTop - 0.14,
        g1 + groundTop - 0.14,
        0.16,
        canopyColor,
        darken(canopyColor, 0.82),
        trimUv,
        true,
      );
    }
  }
}

/**
 * Emit a cantilevered 3D enclosed glazed Mirador gallery column spanning floors `1..floors-1`
 * with corbel bracket underside, corner mullions, side glass return lights, and hipped cap.
 */
export function addProjectingMiradorColumn(
  writer: BuildingGeometryWriter,
  item: VolumeItem,
  panelStart: RoadPoint,
  panelEnd: RoadPoint,
  outward: RoadPoint,
  groundStart: number,
  groundEnd: number,
  floors: number,
): void {
  if (floors < 2) return;
  const { style, wallHeight } = item;
  const baseOffset = item.baseElevationOffset ?? 0;
  const { s, e, gS, gE } = orientSpan(panelStart, panelEnd, groundStart, groundEnd, outward);
  const panelLen = Math.hypot(e[0] - s[0], e[1] - s[1]);
  if (panelLen < 1.6) return;

  const halfFrac = Math.min(0.36, 1.02 / panelLen);
  const u0 = 0.5 - halfFrac;
  const u1 = 0.5 + halfFrac;
  const mS = lerpPoint(s, e, u0);
  const mE = lerpPoint(s, e, u1);
  const mgS = gS + (gE - gS) * u0;
  const mgE = gS + (gE - gS) * u1;

  const depth = 0.65;
  const baseBot = baseOffset + wallHeight / floors - 0.12;
  const capTop = baseOffset + wallHeight - 0.1;
  const trimUv = solidTrimUv(7, style.atlasBand * 2 + 1);
  const glassUv = glassAtlasUv(style.atlasBand);
  const frameColor: BuildingColor = style.isHistoric ? [0.27, 0.22, 0.18] : [0.24, 0.28, 0.33];
  const cladColor: BuildingColor = style.isHistoric ? [0.96, 0.92, 0.85] : [0.94, 0.95, 0.97];

  // Supporting cantilevered corbel stone/concrete plinth
  addProjectingBox(
    writer,
    style.wallMaterial,
    mS,
    mE,
    outward,
    mgS + baseBot - 0.24,
    mgE + baseBot - 0.24,
    mgS + baseBot + 0.08,
    mgE + baseBot + 0.08,
    depth + 0.05,
    cladColor,
    darken(cladColor, 0.82),
    trimUv,
    true,
  );

  const mSo: RoadPoint = [mS[0] + outward[0] * depth, mS[1] + outward[1] * depth];
  const mEo: RoadPoint = [mE[0] + outward[0] * depth, mE[1] + outward[1] * depth];
  const mSGl: RoadPoint = [mS[0] + outward[0] * 0.06, mS[1] + outward[1] * 0.06];
  const mEGl: RoadPoint = [mE[0] + outward[0] * 0.06, mE[1] + outward[1] * 0.06];
  const mSoIn: RoadPoint = [mS[0] + outward[0] * (depth - 0.06), mS[1] + outward[1] * (depth - 0.06)];
  const mEoIn: RoadPoint = [mE[0] + outward[0] * (depth - 0.06), mE[1] + outward[1] * (depth - 0.06)];

  // Per-floor glazed bays + bright contrasting clad spandrel bands + side glazing
  for (let floor = 1; floor < floors; floor += 1) {
    const fBot = baseOffset + (wallHeight * floor) / floors;
    const fTop = baseOffset + (wallHeight * (floor + 1)) / floors;
    const apronTop = fBot + (fTop - fBot) * 0.28;
    const glassTop = fTop - 0.14;

    addProjectingBox(
      writer,
      style.wallMaterial,
      mS,
      mE,
      outward,
      mgS + fBot,
      mgE + fBot,
      mgS + apronTop,
      mgE + apronTop,
      depth,
      cladColor,
      darken(cladColor, 0.85),
      trimUv,
      true,
    );
    // Front & side glass panels
    writer.addQuad(
      style.wallMaterial,
      [wp(mSoIn, mgS + apronTop), wp(mEoIn, mgE + apronTop), wp(mEoIn, mgE + glassTop), wp(mSoIn, mgS + glassTop)],
      [1, 1, 1],
      glassUv,
    );
    writer.addQuad(
      style.wallMaterial,
      [wp(mSGl, mgS + apronTop), wp(mSoIn, mgS + apronTop), wp(mSoIn, mgS + glassTop), wp(mSGl, mgS + glassTop)],
      [0.92, 0.96, 1],
      glassUv,
    );
    writer.addQuad(
      style.wallMaterial,
      [wp(mEoIn, mgE + apronTop), wp(mEGl, mgE + apronTop), wp(mEGl, mgE + glassTop), wp(mEoIn, mgE + glassTop)],
      [0.92, 0.96, 1],
      glassUv,
    );
    // Center glazing mullion strictly inside glass band (does not cross spandrel aprons)
    const mulHalf = 0.03 / (panelLen * (u1 - u0));
    const midA = lerpPoint(mSoIn, mEoIn, 0.5 - mulHalf);
    const midB = lerpPoint(mSoIn, mEoIn, 0.5 + mulHalf);
    const midGa = mgS + (mgE - mgS) * (0.5 - mulHalf);
    const midGb = mgS + (mgE - mgS) * (0.5 + mulHalf);
    writer.addQuad(
      style.wallMaterial,
      [wp(midA, midGa + apronTop), wp(midB, midGb + apronTop), wp(midB, midGb + glassTop), wp(midA, midGa + glassTop)],
      frameColor,
      trimUv,
    );
    // Top spandrel lintel per floor
    addProjectingBox(
      writer,
      style.wallMaterial,
      mS,
      mE,
      outward,
      mgS + glassTop,
      mgE + glassTop,
      mgS + fTop,
      mgE + fTop,
      depth,
      cladColor,
      darken(cladColor, 0.85),
      trimUv,
      true,
    );
  }

  // Left & Right structural corner pilaster columns in contrasting bright cladding
  const postW = 0.09;
  for (const frac of [0, 1 - postW / (panelLen * (u1 - u0))]) {
    const pA = lerpPoint(mS, mE, Math.max(0, frac));
    const pB = lerpPoint(mS, mE, Math.min(1, frac + postW / (panelLen * (u1 - u0))));
    const gA = mgS + (mgE - mgS) * Math.max(0, frac);
    const gB = mgS + (mgE - mgS) * Math.min(1, frac + postW / (panelLen * (u1 - u0)));
    addProjectingBox(
      writer,
      style.wallMaterial,
      pA,
      pB,
      outward,
      gA + baseBot + 0.08,
      gB + baseBot + 0.08,
      gA + capTop,
      gB + capTop,
      depth + 0.025,
      cladColor,
      darken(cladColor, 0.84),
      trimUv,
      true,
    );
  }

  // Overhanging stepped zinc/copper pyramid cap on top of Mirador
  const capColor: BuildingColor = style.isHistoric ? [0.46, 0.36, 0.32] : [0.32, 0.35, 0.39];
  const midBack: RoadPoint = [(mS[0] + mE[0]) * 0.5 + outward[0] * (depth * 0.5), (mS[1] + mE[1]) * 0.5 + outward[1] * (depth * 0.5)];
  const midPeakY = (mgS + mgE) * 0.5 + capTop + 0.36;
  const cSo: RoadPoint = [mSo[0] + outward[0] * 0.05, mSo[1] + outward[1] * 0.05];
  const cEo: RoadPoint = [mEo[0] + outward[0] * 0.05, mEo[1] + outward[1] * 0.05];
  const peakPt = wp(midBack, midPeakY);
  writer.addTriangle(
    style.roofMaterial,
    [wp(cSo, mgS + capTop), wp(cEo, mgE + capTop), peakPt],
    capColor,
    [trimUv[0], trimUv[1], trimUv[2]],
  );
  writer.addTriangle(
    style.roofMaterial,
    [wp(mS, mgS + capTop), wp(cSo, mgS + capTop), peakPt],
    darken(capColor, 0.9),
    [trimUv[0], trimUv[1], trimUv[2]],
  );
  writer.addTriangle(
    style.roofMaterial,
    [wp(cEo, mgE + capTop), wp(mE, mgE + capTop), peakPt],
    darken(capColor, 0.9),
    [trimUv[0], trimUv[1], trimUv[2]],
  );
}

/**
 * Emit rhythmic 3D projecting eave brackets ("canecillos") along historic and brick cornices.
 */
export function addCorniceCorbels(
  writer: BuildingGeometryWriter,
  item: VolumeItem,
  start: RoadPoint,
  end: RoadPoint,
  outward: RoadPoint,
  startGround: number,
  endGround: number,
  exposed: boolean,
  isSetback: boolean,
): void {
  const { style, wallHeight } = item;
  if (
    !exposed ||
    isSetback ||
    item.shape === 'flat' ||
    (!style.isHistoric && style.archetype !== 'ensanche_brick' && style.archetype !== 'ensanche_cream')
  ) {
    return;
  }
  const { s, e, gS, gE } = orientSpan(start, end, startGround, endGround, outward);
  const len = Math.hypot(e[0] - s[0], e[1] - s[1]);
  if (len < 2.2) return;
  const baseOffset = item.baseElevationOffset ?? 0;
  const count = Math.min(18, Math.max(2, Math.floor(len / 1.2)));
  const corbelUv = solidTrimUv(7, style.atlasBand * 2);
  const corbelColor = darken(style.trimColor, 0.82);

  for (let i = 0; i < count; i += 1) {
    const t = (i + 0.5) / count;
    const hw = 0.075 / len;
    const pA = lerpPoint(s, e, Math.max(0.02, t - hw));
    const pB = lerpPoint(s, e, Math.min(0.98, t + hw));
    const gA = gS + (gE - gS) * Math.max(0.02, t - hw);
    const gB = gS + (gE - gS) * Math.min(0.98, t + hw);
    addProjectingBox(
      writer,
      style.wallMaterial,
      pA,
      pB,
      outward,
      gA + baseOffset + wallHeight - 0.42,
      gB + baseOffset + wallHeight - 0.42,
      gA + baseOffset + wallHeight - 0.14,
      gB + baseOffset + wallHeight - 0.14,
      0.22,
      corbelColor,
      darken(corbelColor, 0.82),
      corbelUv,
      true,
    );
  }
}

/**
 * Emit inward-facing courtyard facades for buildings that have inner courtyard holes.
 */
export function addCourtyardWalls(
  writer: BuildingGeometryWriter,
  item: VolumeItem,
  innerRings: readonly (readonly RoadPoint[])[],
  terrain: BuiltTerrainChunk,
  bounds: ProjectedBounds,
  detailed: boolean,
  tileUvFn: (col: number, uvRow: number) => BuildingUv[],
): void {
  const { style, floorCount, wallHeight } = item;
  const baseOffset = item.baseElevationOffset ?? 0;
  for (const ring of innerRings) {
    if (ring.length < 3) continue;
    const area = ringSignedArea(ring);
    for (let edge = 0; edge < ring.length; edge += 1) {
      const start = ring[edge];
      const end = ring[(edge + 1) % ring.length];
      if (!start || !end) continue;
      const midX = (start[0] + end[0]) * 0.5;
      const midZ = (start[1] + end[1]) * 0.5;
      if (midX < bounds.minX || midX >= bounds.maxX || midZ < bounds.minZ || midZ >= bounds.maxZ)
        continue;
      const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (len < 0.4) continue;
      // Normal points INTO the courtyard hole (opposite exterior)
      const nx = area >= 0 ? -(end[1] - start[1]) / len : (end[1] - start[1]) / len;
      const nz = area >= 0 ? (end[0] - start[0]) / len : -(end[0] - start[0]) / len;
      const inward: RoadPoint = [nx, nz];
      const startG = groundAt(terrain, start);
      const endG = groundAt(terrain, end);
      const floors = detailed ? floorCount : 1;
      for (let f = 0; f < floors; f += 1) {
        const y0 = baseOffset + (wallHeight * f) / floors;
        const y1 = baseOffset + (wallHeight * (f + 1)) / floors;
        const uvRow = style.atlasBand * 2 + (f === 0 ? 0 : 1);
        const col = f === 0 ? 3 : (edge + f) % 2 === 0 ? 0 : 7;
        // Flip winding compared to exterior so inward normal faces patio
        writer.addQuad(
          style.wallMaterial,
          [wp(end, endG + y0), wp(start, startG + y0), wp(start, startG + y1), wp(end, endG + y1)],
          style.tint,
          tileUvFn(col, uvRow) as [BuildingUv, BuildingUv, BuildingUv, BuildingUv],
        );
      }
      if (detailed) {
        addProjectingBoxRib(
          writer,
          style.wallMaterial,
          end,
          start,
          inward,
          endG + baseOffset + wallHeight - 0.16,
          startG + baseOffset + wallHeight - 0.16,
          endG + baseOffset + wallHeight,
          startG + baseOffset + wallHeight,
          0.08,
          style.trimColor,
          solidTrimUv(7, style.atlasBand * 2),
        );
      }
    }
  }
}

export function expandPolygonOutward(
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

function gableRiseAt(
  point: RoadPoint,
  splitAxis: 0 | 1,
  middle: number,
  maxDistance: number,
  roofHeight: number,
  eaveDrop: number,
): number {
  const ratio = Math.max(0, 1 - Math.abs(point[splitAxis] - middle) / Math.max(0.2, maxDistance));
  return roofHeight * ratio - eaveDrop;
}

/**
 * Build closed gable-end masonry tympanums ("hastiales") on pitched gabled edges
 * so roofs never float with hollow ends.
 */
export function addGabledEndWalls(
  writer: BuildingGeometryWriter,
  item: VolumeItem,
  terrain: BuiltTerrainChunk,
  bounds: ProjectedBounds,
  detailed = true,
): void {
  if (item.shape !== 'gabled' || item.roofHeight <= 0.15) return;
  const polygon = item.points;
  const overhang = detailed ? item.style.eaveOverhangMeters : 0;
  const eaveDrop = overhang > 0 ? 0.14 : 0;
  const splitAxis = item.ridgeAxis;
  const middle = item.centroid[splitAxis];
  const maxDist = item.ridgeHalfSpan + overhang;
  const baseOffset = item.baseElevationOffset ?? 0;
  const wallTopOffset = baseOffset + item.wallHeight - eaveDrop;
  const tympanumUv = solidTrimUv(7, item.style.atlasBand * 2 + 1);

  for (let edge = 0; edge < polygon.length; edge += 1) {
    const start = polygon[edge];
    const end = polygon[(edge + 1) % polygon.length];
    if (!start || !end) continue;
    const midX = (start[0] + end[0]) * 0.5;
    const midZ = (start[1] + end[1]) * 0.5;
    if (midX < bounds.minX || midX >= bounds.maxX || midZ < bounds.minZ || midZ >= bounds.maxZ)
      continue;

    const rStart = gableRiseAt(start, splitAxis, middle, maxDist, item.roofHeight, 0);
    const rEnd = gableRiseAt(end, splitAxis, middle, maxDist, item.roofHeight, 0);
    const startG = groundAt(terrain, start);
    const endG = groundAt(terrain, end);

    const crossesRidge =
      (start[splitAxis] - middle) * (end[splitAxis] - middle) < -1e-4 &&
      Math.abs(end[splitAxis] - start[splitAxis]) > 1e-4;

    if (crossesRidge) {
      const t = (middle - start[splitAxis]) / (end[splitAxis] - start[splitAxis]);
      const peak2d: RoadPoint = [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ];
      const peakG = groundAt(terrain, peak2d);
      const peakY = peakG + wallTopOffset + item.roofHeight + 0.04;
      const baseStart = wp(start, startG + wallTopOffset);
      const baseEnd = wp(end, endG + wallTopOffset);
      const peakPt = wp(peak2d, peakY);

      if (rStart > 0.08) {
        const topStart = wp(start, startG + wallTopOffset + rStart);
        writer.addQuad(
          item.style.wallMaterial,
          [baseStart, wp(peak2d, peakG + wallTopOffset), peakPt, topStart],
          item.style.tint,
          tympanumUv,
        );
      } else {
        writer.addTriangle(
          item.style.wallMaterial,
          [baseStart, wp(peak2d, peakG + wallTopOffset), peakPt],
          item.style.tint,
          [tympanumUv[0], tympanumUv[1], tympanumUv[2]],
        );
      }
      if (rEnd > 0.08) {
        const topEnd = wp(end, endG + wallTopOffset + rEnd);
        writer.addQuad(
          item.style.wallMaterial,
          [wp(peak2d, peakG + wallTopOffset), baseEnd, topEnd, peakPt],
          item.style.tint,
          tympanumUv,
        );
      } else {
        writer.addTriangle(
          item.style.wallMaterial,
          [wp(peak2d, peakG + wallTopOffset), baseEnd, peakPt],
          item.style.tint,
          [tympanumUv[0], tympanumUv[1], tympanumUv[2]],
        );
      }
    } else if (rStart > 0.15 || rEnd > 0.15) {
      writer.addQuad(
        item.style.wallMaterial,
        [
          wp(start, startG + wallTopOffset),
          wp(end, endG + wallTopOffset),
          wp(end, endG + wallTopOffset + Math.max(0.02, rEnd)),
          wp(start, startG + wallTopOffset + Math.max(0.02, rStart)),
        ],
        item.style.tint,
        tympanumUv,
      );
    }
  }
}

function clipHalfPolygon(
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

export interface RoofBuildOptions {
  readonly lod: number;
  readonly keepPitchedShape: boolean;
  readonly enableRidgeAndParapets: boolean;
  readonly bounds?: ProjectedBounds;
}

function isBoundaryEdge(a: RoadPoint, b: RoadPoint, bounds: ProjectedBounds | undefined): boolean {
  if (!bounds) return false;
  const tol = 0.03;
  return (
    (Math.abs(a[0] - bounds.minX) < tol && Math.abs(b[0] - bounds.minX) < tol) ||
    (Math.abs(a[0] - bounds.maxX) < tol && Math.abs(b[0] - bounds.maxX) < tol) ||
    (Math.abs(a[1] - bounds.minZ) < tol && Math.abs(b[1] - bounds.minZ) < tol) ||
    (Math.abs(a[1] - bounds.maxZ) < tol && Math.abs(b[1] - bounds.maxZ) < tol)
  );
}

/**
 * Emit hollow 3D perimeter parapet walls and coping stones around flat roofs so
 * terraces read with crisp thickness and cast shadows instead of paper-thin slabs.
 */
function addFlatRoofParapetWalls(
  writer: BuildingGeometryWriter,
  item: VolumeItem,
  terrain: BuiltTerrainChunk,
  bounds: ProjectedBounds | undefined,
): void {
  const pts = item.points;
  if (pts.length < 3) return;
  const signedArea = polygonSignedAreaLocal(pts);
  const { style, wallHeight } = item;
  const baseOffset = item.baseElevationOffset ?? 0;
  const isSetback = baseOffset > 0.1;
  const parapetH = isSetback ? 0.38 : Math.max(0.46, style.parapetHeightMeters * 0.82);
  const copingH = 0.085;
  const outerOut = 0.07;
  const innerIn = 0.2;
  const uv = solidTrimUv(7, style.atlasBand * 2 + 1);
  const capColor = style.isIndustrial ? ([0.44, 0.48, 0.52] as BuildingColor) : style.trimColor;
  const innerColor = darken(style.tint, 0.88);

  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (!a || !b || isBoundaryEdge(a, b, bounds)) continue;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.8) continue;
    const outward: RoadPoint =
      signedArea >= 0 ? [dz / len, -dx / len] : [-dz / len, dx / len];
    const { s, e, gS, gE } = orientSpan(a, b, groundAt(terrain, a), groundAt(terrain, b), outward);
    const roofS = gS + baseOffset + wallHeight;
    const roofE = gE + baseOffset + wallHeight;
    const wallTopS = roofS + parapetH;
    const wallTopE = roofE + parapetH;
    const capTopS = wallTopS + copingH;
    const capTopE = wallTopE + copingH;

    // Parapet stem sitting above flat roof slab
    addProjectingBox(
      writer,
      style.wallMaterial,
      s,
      e,
      outward,
      roofS,
      roofE,
      wallTopS,
      wallTopE,
      outerOut,
      style.tint,
      innerColor,
      uv,
      true,
      -innerIn,
    );
    // Overhanging stone/zinc coping cap ("albardilla")
    addProjectingBox(
      writer,
      style.wallMaterial,
      s,
      e,
      outward,
      wallTopS,
      wallTopE,
      capTopS,
      capTopE,
      outerOut + 0.04,
      capColor,
      darken(capColor, 0.85),
      uv,
      true,
      -(innerIn + 0.04),
    );
  }
}

function polygonSignedAreaLocal(points: readonly RoadPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a && b) sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum;
}

/**
 * Emit 3D terracotta ridge crest beam ("cumbrera") along gabled roof peak.
 */
function addGableRidgeBeam(
  writer: BuildingGeometryWriter,
  item: VolumeItem,
  terrain: BuiltTerrainChunk,
  roofPoints: readonly RoadPoint[],
  splitAxis: 0 | 1,
  middle: number,
  baseOffset: number,
): void {
  const crossings: RoadPoint[] = [];
  for (let i = 0; i < roofPoints.length; i += 1) {
    const a = roofPoints[i];
    const b = roofPoints[(i + 1) % roofPoints.length];
    if (!a || !b) continue;
    const da = a[splitAxis] - middle;
    const db = b[splitAxis] - middle;
    if ((da <= 0 && db >= 0) || (da >= 0 && db <= 0)) {
      const denom = b[splitAxis] - a[splitAxis];
      if (Math.abs(denom) > 1e-5) {
        const t = (middle - a[splitAxis]) / denom;
        crossings.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  if (crossings.length < 2) return;
  const runAxis = splitAxis === 0 ? 1 : 0;
  crossings.sort((p, q) => p[runAxis] - q[runAxis]);
  const rA = crossings[0];
  const rB = crossings.at(-1);
  if (!rA || !rB || Math.hypot(rB[0] - rA[0], rB[1] - rA[1]) < 1.0) return;

  const ridgeHalfW = 0.14;
  const nX = splitAxis === 0 ? 1 : 0;
  const nZ = splitAxis === 1 ? 1 : 0;
  const yA = groundAt(terrain, rA) + baseOffset + item.wallHeight + item.roofHeight;
  const yB = groundAt(terrain, rB) + baseOffset + item.wallHeight + item.roofHeight;
  const aL: RoadPoint = [rA[0] - nX * ridgeHalfW, rA[1] - nZ * ridgeHalfW];
  const aR: RoadPoint = [rA[0] + nX * ridgeHalfW, rA[1] + nZ * ridgeHalfW];
  const bL: RoadPoint = [rB[0] - nX * ridgeHalfW, rB[1] - nZ * ridgeHalfW];
  const bR: RoadPoint = [rB[0] + nX * ridgeHalfW, rB[1] + nZ * ridgeHalfW];
  const uv = solidTrimUv(7, 0);
  const ridgeColor: BuildingColor = item.style.isIndustrial ? [0.5, 0.54, 0.58] : [0.76, 0.36, 0.22];
  const capH = 0.14;
  const mat = item.style.roofMaterial;

  // Sloped crest cap ridge prism sitting atop peak
  writer.addQuad(mat, [wp(aL, yA - 0.04), wp(bL, yB - 0.04), wp(rB, yB + capH), wp(rA, yA + capH)], ridgeColor, uv);
  writer.addQuad(mat, [wp(rA, yA + capH), wp(rB, yB + capH), wp(bR, yB - 0.04), wp(aR, yA - 0.04)], darken(ridgeColor, 0.88), uv);
  writer.addTriangle(mat, [wp(aL, yA - 0.04), wp(rA, yA + capH), wp(aR, yA - 0.04)], darken(ridgeColor, 0.82), [uv[0], uv[1], uv[2]]);
  writer.addTriangle(mat, [wp(bR, yB - 0.04), wp(rB, yB + capH), wp(bL, yB - 0.04)], darken(ridgeColor, 0.82), [uv[0], uv[1], uv[2]]);
}

/**
 * Emit roofs supporting courtyard holes, thick Stylized Low Poly eave fascia trims,
 * hipped pyramids with ridge tiles, hollow 3D flat-roof parapets, and closed ridge gabled roofs.
 */
export function addStylizedRoof(
  writer: BuildingGeometryWriter,
  item: VolumeItem,
  terrain: BuiltTerrainChunk,
  optionsOrDetailed: boolean | RoofBuildOptions,
): void {
  const opts: RoofBuildOptions =
    typeof optionsOrDetailed === 'boolean'
      ? {
          lod: optionsOrDetailed ? 0 : 2,
          keepPitchedShape: optionsOrDetailed,
          enableRidgeAndParapets: optionsOrDetailed,
        }
      : optionsOrDetailed;
  const detailed = opts.lod === 0;
  const keepPitched = item.shape !== 'flat' && opts.keepPitchedShape;
  const overhang = detailed && item.shape !== 'flat' ? item.style.eaveOverhangMeters : 0;
  const roofPoints = expandPolygonOutward(item.points, overhang, item.centroid);
  const eaveDrop = overhang > 0 ? 0.14 : 0;
  const baseOffset = item.baseElevationOffset ?? 0;
  const roofTopYOffset = baseOffset + item.wallHeight - eaveDrop;
  const top: RoadPoint3[] = roofPoints.map((point) =>
    wp(point, groundAt(terrain, point) + roofTopYOffset),
  );
  const inner3d: RoadPoint3[][] = (item.innerRings ?? [])
    .filter((ring) => ring.length >= 3)
    .map((ring) => ring.map((point) => wp(point, groundAt(terrain, point) + roofTopYOffset)));
  const roofTint: BuildingColor = item.style.isIndustrial ? [0.78, 0.82, 0.85] : [1, 1, 1];
  const mat = item.style.roofMaterial;

  if (item.shape === 'flat' || !keepPitched || inner3d.length > 0) {
    writer.addPolygonWithHoles(mat, top, inner3d, roofTint, (point) => [
      point[0] / 4,
      point[2] / 4,
    ]);
    if (detailed && opts.enableRidgeAndParapets && item.shape === 'flat' && inner3d.length === 0) {
      addFlatRoofParapetWalls(writer, item, terrain, opts.bounds);
    }
    if (detailed && inner3d.length > 0 && item.shape !== 'flat') {
      // Courtyard pitched skirt border so courtyard palaces show sloped Arabic tiles around patio
      const trimColor: BuildingColor = [0.78, 0.44, 0.28];
      for (const hole of inner3d) {
        for (let i = 0; i < hole.length; i += 1) {
          const a = hole[i];
          const b = hole[(i + 1) % hole.length];
          if (!a || !b) continue;
          writer.addQuad(
            mat,
            [
              [b[0], b[1] + 0.42, b[2]],
              [a[0], a[1] + 0.42, a[2]],
              [a[0], a[1], a[2]],
              [b[0], b[1], b[2]],
            ],
            trimColor,
            [
              [b[0] / 4, b[2] / 4],
              [a[0] / 4, a[2] / 4],
              [a[0] / 4, a[2] / 4 + 0.1],
              [b[0] / 4, b[2] / 4 + 0.1],
            ],
          );
        }
      }
    }
    return;
  }

  const fasciaH = item.style.fasciaThicknessMeters;
  const trimTint: BuildingColor = item.style.isIndustrial ? [0.55, 0.6, 0.65] : [0.85, 0.78, 0.7];
  const fasciaUv = solidTrimUv(7, 0);

  if (item.shape === 'hipped') {
    const centerY =
      groundAt(terrain, item.centroid) + baseOffset + item.wallHeight + item.roofHeight;
    const center = wp(item.centroid, centerY);
    for (let index = 0; index < top.length; index += 1) {
      const first = top[index];
      const second = top[(index + 1) % top.length];
      if (!first || !second) continue;
      writer.addTriangle(mat, [first, second, center], roofTint, [
        [first[0] / 4, first[2] / 4],
        [second[0] / 4, second[2] / 4],
        [center[0] / 4, center[2] / 4],
      ]);
      if (detailed) {
        // Thick Stylized eave fascia trim edge
        writer.addQuad(
          mat,
          [
            [first[0], first[1] - fasciaH, first[2]],
            [second[0], second[1] - fasciaH, second[2]],
            second,
            first,
          ],
          trimTint,
          fasciaUv,
        );
      }
    }
    if (detailed && opts.enableRidgeAndParapets && top.length >= 3) {
      // Hipped peak finial cap
      const ridgeCapColor: BuildingColor = item.style.isIndustrial ? [0.5, 0.54, 0.58] : [0.76, 0.36, 0.22];
      const c = item.centroid;
      const r = 0.22;
      const baseCapY = centerY - 0.04;
      const topCapY = centerY + 0.14;
      const corners: RoadPoint3[] = [
        [c[0] - r, baseCapY, c[1] - r],
        [c[0] + r, baseCapY, c[1] - r],
        [c[0] + r, baseCapY, c[1] + r],
        [c[0] - r, baseCapY, c[1] + r],
      ];
      const peakCap: RoadPoint3 = [c[0], topCapY, c[1]];
      for (let i = 0; i < 4; i += 1) {
        const pA = corners[i];
        const pB = corners[(i + 1) % 4];
        if (pA && pB) {
          writer.addTriangle(mat, [pB, pA, peakCap], ridgeCapColor, [fasciaUv[0], fasciaUv[1], fasciaUv[2]]);
        }
      }
    }
    return;
  }

  const splitAxis = item.ridgeAxis;
  const middle = item.centroid[splitAxis];
  const maxDistance = item.ridgeHalfSpan + overhang;
  for (const keepBelow of [true, false]) {
    const half = clipHalfPolygon(roofPoints, splitAxis, middle, keepBelow);
    if (half.length < 3) continue;
    const roof = half.map((point) => {
      const rise = gableRiseAt(point, splitAxis, middle, maxDistance, item.roofHeight, eaveDrop);
      return wp(point, groundAt(terrain, point) + baseOffset + item.wallHeight + rise);
    });
    writer.addPolygon(mat, roof, roofTint, (point) => [point[0] / 4, point[2] / 4]);
    if (detailed) {
      // Thick Stylized roof edge fascia around each pitched slope
      for (let i = 0; i < roof.length; i += 1) {
        const a = roof[i];
        const b = roof[(i + 1) % roof.length];
        if (!a || !b) continue;
        writer.addQuad(
          mat,
          [[a[0], a[1] - fasciaH, a[2]], [b[0], b[1] - fasciaH, b[2]], b, a],
          trimTint,
          fasciaUv,
        );
      }
    }
  }
  if (detailed && opts.enableRidgeAndParapets) {
    addGableRidgeBeam(writer, item, terrain, roofPoints, splitAxis, middle, baseOffset);
  }
}

export function buildSetbackPenthouseSpec(item: VolumeItem): VolumeItem | undefined {
  if (!item.style.supportsSetbackAttic || item.floorCount < 5 || item.area < 120) return undefined;
  const inset = insetPolygon(item.fullPoints, 1.35);
  if (inset.length < 3) return undefined;
  const storeyH = item.wallHeight / item.floorCount;
  const mainWallHeight = Math.max(4.5, item.wallHeight - storeyH);
  return {
    ...item,
    points: inset,
    fullPoints: inset,
    floorCount: 1,
    wallHeight: Math.max(2.6, storeyH),
    roofHeight: 0,
    shape: 'flat',
    baseElevationOffset: mainWallHeight,
    innerRings: undefined,
  };
}
