import { BuildingGeometryWriter, type BuildingColor, type BuildingUv } from './building-geometry';
import { insetPolygon, ringSignedArea } from './polygon-holes';
import { sampleHeight, type RoadPoint, type RoadPoint3 } from './road-geometry';
import { isTowerFeature, type BuildingStyleSpec } from './building-styles';
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

function addOrientedQuad(
  writer: BuildingGeometryWriter,
  material: BuildingMaterial,
  a: RoadPoint,
  b: RoadPoint,
  ay0: number,
  by0: number,
  ay1: number,
  by1: number,
  outward: RoadPoint,
  color: BuildingColor,
  uv: [BuildingUv, BuildingUv, BuildingUv, BuildingUv],
): void {
  if (faceAlignedForward(a, b, outward)) {
    writer.addQuad(material, [wp(a, ay0), wp(b, by0), wp(b, by1), wp(a, ay1)], color, uv);
  } else {
    const swappedUv: [BuildingUv, BuildingUv, BuildingUv, BuildingUv] = [
      uv[1],
      uv[0],
      uv[3],
      uv[2],
    ];
    writer.addQuad(material, [wp(b, by0), wp(a, ay0), wp(a, ay1), wp(b, by1)], color, swappedUv);
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
  const ao: RoadPoint = [a[0] + outward[0] * depth, a[1] + outward[1] * depth];
  const bo: RoadPoint = [b[0] + outward[0] * depth, b[1] + outward[1] * depth];
  addOrientedQuad(writer, material, ao, bo, y0A, y0B, y1A, y1B, outward, color, uv);
  writer.addQuad(material, [wp(ao, y1A), wp(bo, y1B), wp(b, y1B), wp(a, y1A)], color, uv);
  writer.addQuad(material, [wp(a, y0A), wp(b, y0B), wp(bo, y0B), wp(ao, y0A)], color, uv);
}

/**
 * Emit a real 3D recessed window bay in the chunk mesh (hole cut inside the wall
 * quad + dark jamb reveals + cobalt-sky recessed glass + projecting sill & hood/shutters)
 * so every facade has genuine 3D depth with zero extra draw calls.
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
): void {
  const { style, seed } = item;
  const uvRow = style.atlasBand * 2 + (floorIndex === 0 && !isSetback ? 0 : 1);
  const wallUv = solidTrimUv(7, uvRow);
  const dx = panelEnd[0] - panelStart[0];
  const dz = panelEnd[1] - panelStart[1];
  const panelLen = Math.hypot(dx, dz);
  const floorH = floorTop - floorBottom;

  const isTower = isTowerFeature(item.feature);

  const skipGroundIndustrial =
    style.isIndustrial && (floorIndex === 0 || (panelIndex + floorIndex) % 2 === 1);
  const skipGroundSolid = floorIndex === 0 && !isSetback && (panelIndex + seed) % 3 === 1;
  const isCornerQuoinOnly = style.isHistoric && floorIndex === 0 && panelLen < 2.25;

  if (
    !exposed ||
    isTower ||
    panelLen < 2.45 ||
    floorH < 2.2 ||
    skipGroundIndustrial ||
    skipGroundSolid ||
    isCornerQuoinOnly
  ) {
    addOrientedQuad(
      writer,
      style.wallMaterial,
      panelStart,
      panelEnd,
      groundStart + floorBottom,
      groundEnd + floorBottom,
      groundStart + floorTop,
      groundEnd + floorTop,
      outward,
      style.tint,
      wallUv,
    );
    return;
  }

  let uWin0 = 0.27;
  let uWin1 = 0.73;
  let sillFrac = floorIndex === 0 && !isSetback ? 0.34 : 0.28;
  let headFrac = 0.83;
  if (style.facadeGrammar === 'modern_grid' || style.facadeGrammar === 'civic_campus') {
    uWin0 = 0.21;
    uWin1 = 0.79;
    sillFrac = floorIndex === 0 && !isSetback ? 0.24 : 0.25;
    headFrac = 0.85;
  } else if (style.facadeGrammar === 'industrial_nave') {
    uWin0 = 0.16;
    uWin1 = 0.84;
    sillFrac = 0.48;
    headFrac = 0.84;
  }

  const wStart: RoadPoint = [panelStart[0] + dx * uWin0, panelStart[1] + dz * uWin0];
  const wEnd: RoadPoint = [panelStart[0] + dx * uWin1, panelStart[1] + dz * uWin1];
  const wgStart = groundStart + (groundEnd - groundStart) * uWin0;
  const wgEnd = groundStart + (groundEnd - groundStart) * uWin1;

  const yWin0 = floorBottom + floorH * sillFrac;
  const yWin1 = floorBottom + floorH * headFrac;

  // 1. Cut the wall into 4 clean surround quads around the window opening with exact sub-UVs so masonry courses align seamlessly
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
  addOrientedQuad(
    writer,
    style.wallMaterial,
    panelStart,
    wStart,
    groundStart + floorBottom,
    wgStart + floorBottom,
    groundStart + floorTop,
    wgStart + floorTop,
    outward,
    style.tint,
    subUv(0, uWin0, 0, 1),
  );
  addOrientedQuad(
    writer,
    style.wallMaterial,
    wEnd,
    panelEnd,
    wgEnd + floorBottom,
    groundEnd + floorBottom,
    wgEnd + floorTop,
    groundEnd + floorTop,
    outward,
    style.tint,
    subUv(uWin1, 1, 0, 1),
  );
  addOrientedQuad(
    writer,
    style.wallMaterial,
    wStart,
    wEnd,
    wgStart + floorBottom,
    wgEnd + floorBottom,
    wgStart + yWin0,
    wgEnd + yWin0,
    outward,
    style.tint,
    subUv(uWin0, uWin1, 0, sillFrac),
  );
  addOrientedQuad(
    writer,
    style.wallMaterial,
    wStart,
    wEnd,
    wgStart + yWin1,
    wgEnd + yWin1,
    wgStart + floorTop,
    wgEnd + floorTop,
    outward,
    style.tint,
    subUv(uWin0, uWin1, headFrac, 1),
  );

  // 2. Recessed glazing pane (-0.14 m inside wall) mapped onto cobalt-sky atlas tile (col=0)
  const recess = -0.14;
  const wStartIn: RoadPoint = [wStart[0] + outward[0] * recess, wStart[1] + outward[1] * recess];
  const wEndIn: RoadPoint = [wEnd[0] + outward[0] * recess, wEnd[1] + outward[1] * recess];
  const glassUvRow = style.atlasBand * 2 + 1;
  const gx0 = 39 / (128 * 8);
  const gx1 = 89 / (128 * 8);
  const gy0 = glassUvRow / 8 + (1 - 91 / 128) / 8;
  const gy1 = glassUvRow / 8 + (1 - 25 / 128) / 8;
  const glassUv: [BuildingUv, BuildingUv, BuildingUv, BuildingUv] = [
    [gx0, gy0],
    [gx1, gy0],
    [gx1, gy1],
    [gx0, gy1],
  ];
  addOrientedQuad(
    writer,
    style.wallMaterial,
    wStartIn,
    wEndIn,
    wgStart + yWin0,
    wgEnd + yWin0,
    wgStart + yWin1,
    wgEnd + yWin1,
    outward,
    [1, 1, 1],
    glassUv,
  );

  // 3. Recessed left/right/top inner reveal walls (sill top closes bottom seamlessly)
  const revealUv = solidTrimUv(7, style.atlasBand * 2);
  writer.addQuad(
    style.wallMaterial,
    [
      wp(wStart, wgStart + yWin0),
      wp(wStartIn, wgStart + yWin0),
      wp(wStartIn, wgStart + yWin1),
      wp(wStart, wgStart + yWin1),
    ],
    style.plinthColor,
    revealUv,
  );
  writer.addQuad(
    style.wallMaterial,
    [
      wp(wEndIn, wgEnd + yWin0),
      wp(wEnd, wgEnd + yWin0),
      wp(wEnd, wgEnd + yWin1),
      wp(wEndIn, wgEnd + yWin1),
    ],
    style.plinthColor,
    revealUv,
  );
  writer.addQuad(
    style.wallMaterial,
    [
      wp(wStart, wgStart + yWin1),
      wp(wEnd, wgEnd + yWin1),
      wp(wEndIn, wgEnd + yWin1),
      wp(wStartIn, wgStart + yWin1),
    ],
    style.plinthColor,
    revealUv,
  );

  // 4. Protruding 3D window sill ("alféizar": top sloped plane + front fascia, spanning into recess)
  const sillDepth = Math.min(0.14, style.reliefDepthMeters * 0.9);
  const sOut: RoadPoint = [wStart[0] + outward[0] * sillDepth, wStart[1] + outward[1] * sillDepth];
  const eOut: RoadPoint = [wEnd[0] + outward[0] * sillDepth, wEnd[1] + outward[1] * sillDepth];
  addOrientedQuad(
    writer,
    style.wallMaterial,
    sOut,
    eOut,
    wgStart + yWin0 - 0.06,
    wgEnd + yWin0 - 0.06,
    wgStart + yWin0 + 0.025,
    wgEnd + yWin0 + 0.025,
    outward,
    style.trimColor,
    wallUv,
  );
  writer.addQuad(
    style.wallMaterial,
    [
      wp(wStartIn, wgStart + yWin0 + 0.025),
      wp(wEndIn, wgEnd + yWin0 + 0.025),
      wp(eOut, wgEnd + yWin0 + 0.025),
      wp(sOut, wgStart + yWin0 + 0.025),
    ],
    style.trimColor,
    wallUv,
  );

  // 5. Protruding top awning canopy OR crisp dark top lintel
  const wantsAwning =
    style.secondaryWindowKind === 'window_awning' &&
    floorIndex >= 1 &&
    (item.feature.commercial || style.isChalet) &&
    (panelIndex + floorIndex + seed) % 3 === 0;
  if (wantsAwning) {
    const hoodDepth = 0.34;
    const wAwnStart: RoadPoint = [
      wStart[0] + outward[0] * hoodDepth,
      wStart[1] + outward[1] * hoodDepth,
    ];
    const wAwnEnd: RoadPoint = [wEnd[0] + outward[0] * hoodDepth, wEnd[1] + outward[1] * hoodDepth];
    const awningColor: BuildingColor = seed % 2 === 0 ? [0.22, 0.44, 0.78] : [0.82, 0.36, 0.24];
    writer.addQuad(
      style.wallMaterial,
      [
        wp(wAwnStart, wgStart + yWin1 - 0.16),
        wp(wAwnEnd, wgEnd + yWin1 - 0.16),
        wp(wEnd, wgEnd + yWin1 + 0.1),
        wp(wStart, wgStart + yWin1 + 0.1),
      ],
      awningColor,
      wallUv,
    );
  } else {
    const lOutS: RoadPoint = [wStart[0] + outward[0] * 0.08, wStart[1] + outward[1] * 0.08];
    const lOutE: RoadPoint = [wEnd[0] + outward[0] * 0.08, wEnd[1] + outward[1] * 0.08];
    addOrientedQuad(
      writer,
      style.wallMaterial,
      lOutS,
      lOutE,
      wgStart + yWin1 - 0.015,
      wgEnd + yWin1 - 0.015,
      wgStart + yWin1 + 0.075,
      wgEnd + yWin1 + 0.075,
      outward,
      style.trimColor,
      wallUv,
    );
  }

  // 6. Stylized 3D shutters on traditional Casco / chalet facades (single crisp proud blade each)
  const wantsShutters =
    !wantsAwning &&
    (style.facadeGrammar === 'recessed_classical' || style.facadeGrammar === 'chalet_cottage') &&
    (panelIndex + floorIndex + seed) % 2 === 0 &&
    panelLen >= 2.45;
  if (wantsShutters) {
    const shW = 0.12;
    const shColor: BuildingColor = seed % 2 === 0 ? [0.28, 0.38, 0.31] : [0.44, 0.31, 0.22];
    const lS: RoadPoint = [
      panelStart[0] + dx * Math.max(0.03, uWin0 - shW) + outward[0] * 0.04,
      panelStart[1] + dz * Math.max(0.03, uWin0 - shW) + outward[1] * 0.04,
    ];
    const lE: RoadPoint = [wStart[0] + outward[0] * 0.04, wStart[1] + outward[1] * 0.04];
    const rS: RoadPoint = [wEnd[0] + outward[0] * 0.04, wEnd[1] + outward[1] * 0.04];
    const rE: RoadPoint = [
      panelStart[0] + dx * Math.min(0.97, uWin1 + shW) + outward[0] * 0.04,
      panelStart[1] + dz * Math.min(0.97, uWin1 + shW) + outward[1] * 0.04,
    ];
    const lgS = groundStart + (groundEnd - groundStart) * Math.max(0.03, uWin0 - shW);
    const rgE = groundStart + (groundEnd - groundStart) * Math.min(0.97, uWin1 + shW);
    addOrientedQuad(
      writer,
      style.wallMaterial,
      lS,
      lE,
      lgS + yWin0 + 0.02,
      wgStart + yWin0 + 0.02,
      lgS + yWin1 - 0.02,
      wgStart + yWin1 - 0.02,
      outward,
      shColor,
      revealUv,
    );
    addOrientedQuad(
      writer,
      style.wallMaterial,
      rS,
      rE,
      wgEnd + yWin0 + 0.02,
      rgE + yWin0 + 0.02,
      wgEnd + yWin1 - 0.02,
      rgE + yWin1 - 0.02,
      outward,
      shColor,
      revealUv,
    );
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
  const darkSillUv = solidTrimUv(7, style.atlasBand * 2);
  const depth = style.reliefDepthMeters;
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const len = Math.hypot(dx, dz);
  if (len < 4.5) return;

  const pierHalfW = Math.min(0.16, (len / Math.max(1, panels)) * 0.065);
  const startWallFloor = baseOffset > 0.1 ? 0 : 1;
  const bottomY = baseOffset + (floors > 1 && startWallFloor === 1 ? wallHeight / floors : 0);

  if (
    panels >= 2 &&
    (style.facadeGrammar === 'modern_grid' ||
      style.facadeGrammar === 'recessed_classical' ||
      len >= 7.5)
  ) {
    const pierIndices = style.facadeGrammar === 'modern_grid' ? panels + 1 : panels - 1;
    for (let k = 0; k < pierIndices; k += 1) {
      const idx = style.facadeGrammar === 'modern_grid' ? k : k + 1;
      const t = idx / panels;
      const tL = Math.max(0, t - pierHalfW / len);
      const tR = Math.min(1, t + pierHalfW / len);
      const pL: RoadPoint = [start[0] + dx * tL, start[1] + dz * tL];
      const pR: RoadPoint = [start[0] + dx * tR, start[1] + dz * tR];
      const gL = startGround + (endGround - startGround) * tL;
      const gR = startGround + (endGround - startGround) * tR;
      const pLo: RoadPoint = [pL[0] + outward[0] * depth, pL[1] + outward[1] * depth];
      const pRo: RoadPoint = [pR[0] + outward[0] * depth, pR[1] + outward[1] * depth];
      const yBotL = gL + (idx === 0 || idx === panels ? baseOffset : bottomY);
      const yBotR = gR + (idx === 0 || idx === panels ? baseOffset : bottomY);
      const yTopL = gL + baseOffset + wallHeight;
      const yTopR = gR + baseOffset + wallHeight;

      addOrientedQuad(
        writer,
        style.wallMaterial,
        pLo,
        pRo,
        yBotL,
        yBotR,
        yTopL,
        yTopR,
        outward,
        style.trimColor,
        pierUv,
      );
      writer.addQuad(
        style.wallMaterial,
        [wp(pL, yBotL), wp(pLo, yBotL), wp(pLo, yTopL), wp(pL, yTopL)],
        style.plinthColor,
        darkSillUv,
      );
      writer.addQuad(
        style.wallMaterial,
        [wp(pRo, yBotR), wp(pR, yBotR), wp(pR, yTopR), wp(pRo, yTopR)],
        style.plinthColor,
        darkSillUv,
      );
    }
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
): void {
  if (item.shape !== 'gabled' || item.roofHeight <= 0.15) return;
  const polygon = item.points;
  const overhang = item.style.eaveOverhangMeters;
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

/**
 * Emit roofs supporting courtyard holes, thick Stylized Low Poly eave fascia trims,
 * hipped pyramids, and closed ridge gabled roofs.
 */
export function addStylizedRoof(
  writer: BuildingGeometryWriter,
  item: VolumeItem,
  terrain: BuiltTerrainChunk,
  detailed: boolean,
): void {
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

  if (item.shape === 'flat' || !detailed || inner3d.length > 0) {
    writer.addPolygonWithHoles(mat, top, inner3d, roofTint, (point) => [
      point[0] / 4,
      point[2] / 4,
    ]);
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
