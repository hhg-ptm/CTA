import { triangulatePolygon, type RoadPoint } from './road-geometry';

export function ringSignedArea(points: readonly RoadPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a && b) sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum;
}

function normalizeWinding(points: readonly RoadPoint[], wantCcw: boolean): RoadPoint[] {
  const clean: RoadPoint[] = [];
  for (const pt of points) {
    const prev = clean.at(-1);
    if (!prev || Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) > 1e-4) {
      clean.push([pt[0], pt[1]]);
    }
  }
  if (
    clean.length > 2 &&
    Math.hypot(
      (clean[0]?.[0] ?? 0) - (clean.at(-1)?.[0] ?? 0),
      (clean[0]?.[1] ?? 0) - (clean.at(-1)?.[1] ?? 0),
    ) < 1e-4
  ) {
    clean.pop();
  }
  if (clean.length < 3) return [];
  const area = ringSignedArea(clean);
  if ((wantCcw && area < 0) || (!wantCcw && area > 0)) clean.reverse();
  return clean;
}

function cross(a: RoadPoint, b: RoadPoint, c: RoadPoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointInTri(p: RoadPoint, a: RoadPoint, b: RoadPoint, c: RoadPoint): boolean {
  return cross(a, b, p) >= -1e-7 && cross(b, c, p) >= -1e-7 && cross(c, a, p) >= -1e-7;
}

function samePoint(a: RoadPoint, b: RoadPoint): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-5;
}

function earClipSimpleRing(ring: readonly RoadPoint[]): [number, number, number][] {
  if (ring.length < 3) return [];
  const remaining = ring.map((_, idx) => idx);
  const triangles: [number, number, number][] = [];
  let guard = ring.length * ring.length * 2;
  while (remaining.length > 3 && guard > 0) {
    guard -= 1;
    let clipped = false;
    const len = remaining.length;
    for (let i = 0; i < len; i += 1) {
      const iPrev = remaining[(i + len - 1) % len];
      const iCurr = remaining[i];
      const iNext = remaining[(i + 1) % len];
      if (iPrev === undefined || iCurr === undefined || iNext === undefined) continue;
      const a = ring[iPrev];
      const b = ring[iCurr];
      const c = ring[iNext];
      if (!a || !b || !c) continue;
      // Collapse degenerate / doubled bridge vertices without emitting zero-area triangles.
      if (samePoint(a, c) || samePoint(a, b) || samePoint(b, c)) {
        remaining.splice(i, 1);
        clipped = true;
        break;
      }
      const area2 = cross(a, b, c);
      if (area2 <= 1e-8) continue;
      let containsOther = false;
      for (let j = 0; j < len; j += 1) {
        const idx = remaining[j];
        if (idx === undefined || idx === iPrev || idx === iCurr || idx === iNext) continue;
        const p = ring[idx];
        if (!p || samePoint(p, a) || samePoint(p, b) || samePoint(p, c)) continue;
        if (pointInTri(p, a, b, c)) {
          containsOther = true;
          break;
        }
      }
      if (containsOther) continue;
      triangles.push([iPrev, iCurr, iNext]);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (remaining.length === 3) {
    const a = remaining[0];
    const b = remaining[1];
    const c = remaining[2];
    if (a !== undefined && b !== undefined && c !== undefined) {
      const pa = ring[a];
      const pb = ring[b];
      const pc = ring[c];
      if (pa && pb && pc && cross(pa, pb, pc) > 1e-8) {
        triangles.push([a, b, c]);
      }
    }
  }
  return triangles;
}

/**
 * Triangulate a 2D polygon with arbitrary courtyard hole rings using geometric
 * bridge insertion followed by ear-clipping. All returned triangle indices
 * reference the concatenated `[...normalizedOuter, ...hole0, ...hole1, ...]`
 * vertex list.
 */
export function triangulatePolygonWithHoles(
  outer: readonly RoadPoint[],
  holes: readonly (readonly RoadPoint[])[],
): {
  readonly vertices: RoadPoint[];
  readonly triangles: readonly (readonly [number, number, number])[];
} {
  const normOuter = normalizeWinding(outer, true);
  if (normOuter.length < 3) return { vertices: [], triangles: [] };
  const normHoles = holes
    .map((hole) => normalizeWinding(hole, false))
    .filter((hole) => hole.length >= 3);

  if (normHoles.length === 0) {
    return { vertices: normOuter, triangles: triangulatePolygon(normOuter) };
  }

  // Sort holes from rightmost vertex X descending so bridges never cross unprocessed holes.
  const orderedHoles = normHoles
    .map((hole) => {
      let maxIdx = 0;
      for (let i = 1; i < hole.length; i += 1) {
        if ((hole[i]?.[0] ?? -Infinity) > (hole[maxIdx]?.[0] ?? -Infinity)) maxIdx = i;
      }
      return { hole, maxIdx, maxX: hole[maxIdx]?.[0] ?? 0 };
    })
    .sort((a, b) => b.maxX - a.maxX);

  const vertices: RoadPoint[] = [...normOuter];
  let mergedRing: number[] = normOuter.map((_, i) => i);

  for (const { hole, maxIdx } of orderedHoles) {
    const holeStart = vertices.length;
    vertices.push(...hole);
    const mLocal = maxIdx;
    const mIdx = holeStart + mLocal;
    const M = vertices[mIdx];
    if (!M) continue;

    // Raycast +X from M against all edges of current mergedRing to find closest visible point I.
    let bestT = Infinity;
    let edgeStartVertex = -1;
    let edgeEndVertex = -1;
    let hitPoint: RoadPoint = M;
    for (let i = 0; i < mergedRing.length; i += 1) {
      const i0 = mergedRing[i];
      const i1 = mergedRing[(i + 1) % mergedRing.length];
      if (i0 === undefined || i1 === undefined) continue;
      const a = vertices[i0];
      const b = vertices[i1];
      if (!a || !b) continue;
      const minY = Math.min(a[1], b[1]);
      const maxY = Math.max(a[1], b[1]);
      if (M[1] < minY - 1e-7 || M[1] > maxY + 1e-7) continue;
      const dy = b[1] - a[1];
      if (Math.abs(dy) < 1e-9) {
        if (Math.max(a[0], b[0]) >= M[0] - 1e-7) {
          const xHit = Math.max(a[0], M[0]);
          const t = xHit - M[0];
          if (t >= -1e-7 && t < bestT) {
            bestT = t;
            edgeStartVertex = i0;
            edgeEndVertex = i1;
            hitPoint = [xHit, M[1]];
          }
        }
        continue;
      }
      const s = (M[1] - a[1]) / dy;
      if (s < -1e-6 || s > 1 + 1e-6) continue;
      const xHit = a[0] + (b[0] - a[0]) * s;
      const t = xHit - M[0];
      if (t >= -1e-7 && t < bestT) {
        bestT = t;
        edgeStartVertex = i0;
        edgeEndVertex = i1;
        hitPoint = [xHit, M[1]];
      }
    }

    // Pick visible anchor P from mergedRing (endpoint of hit edge, or nearest reflex inside M-I-P triangle).
    let bridgeRingPos = 0;
    if (edgeStartVertex >= 0 && edgeEndVertex >= 0) {
      const a = vertices[edgeStartVertex];
      const b = vertices[edgeEndVertex];
      const pCandidate = a && b && a[0] >= b[0] ? edgeStartVertex : edgeEndVertex;
      const P = vertices[pCandidate];
      let chosenVertex = pCandidate;
      if (P && Math.hypot(P[0] - M[0], P[1] - M[1]) > 1e-6) {
        let bestCos = -Infinity;
        for (const rIdx of mergedRing) {
          if (rIdx === pCandidate) continue;
          const R = vertices[rIdx];
          if (!R || R[0] < M[0] - 1e-6) continue;
          if (pointInTri(R, M, hitPoint, P) || pointInTri(R, M, P, hitPoint)) {
            const dx = R[0] - M[0];
            const dz = R[1] - M[1];
            const dist = Math.hypot(dx, dz);
            if (dist < 1e-6) continue;
            const c = dx / dist;
            if (c > bestCos) {
              bestCos = c;
              chosenVertex = rIdx;
            }
          }
        }
      }
      const pos = mergedRing.indexOf(chosenVertex);
      if (pos >= 0) bridgeRingPos = pos;
    } else {
      // Fallback: nearest vertex in mergedRing
      let bestDist = Infinity;
      for (let i = 0; i < mergedRing.length; i += 1) {
        const pt = vertices[mergedRing[i] ?? 0];
        if (!pt) continue;
        const d = Math.hypot(pt[0] - M[0], pt[1] - M[1]);
        if (d < bestDist) {
          bestDist = d;
          bridgeRingPos = i;
        }
      }
    }

    const rotatedHole: number[] = [];
    for (let k = 0; k < hole.length; k += 1) {
      rotatedHole.push(holeStart + ((mLocal + k) % hole.length));
    }
    const bridgeVertex = mergedRing[bridgeRingPos];
    if (bridgeVertex === undefined) continue;
    mergedRing = [
      ...mergedRing.slice(0, bridgeRingPos + 1),
      ...rotatedHole,
      mIdx,
      bridgeVertex,
      ...mergedRing.slice(bridgeRingPos + 1),
    ];
  }

  const mergedPoints = mergedRing.map((idx) => vertices[idx] ?? ([0, 0] as RoadPoint));
  const localTris = earClipSimpleRing(mergedPoints);
  if (localTris.length === 0) {
    return { vertices: normOuter, triangles: triangulatePolygon(normOuter) };
  }
  const triangles = localTris.map(
    ([a, b, c]) =>
      [mergedRing[a] ?? 0, mergedRing[b] ?? 0, mergedRing[c] ?? 0] as readonly [
        number,
        number,
        number,
      ],
  );
  return { vertices, triangles };
}

/**
 * Compute an inward-offset polygon for setback penthouses / stepped attics.
 * Returns empty array if the polygon becomes degenerate or collapses.
 */
export function insetPolygon(points: readonly RoadPoint[], offsetMeters: number): RoadPoint[] {
  const norm = normalizeWinding(points, true);
  if (norm.length < 3 || offsetMeters <= 0.05) return norm;
  const cx = norm.reduce((s, p) => s + p[0], 0) / norm.length;
  const cz = norm.reduce((s, p) => s + p[1], 0) / norm.length;
  const result: RoadPoint[] = [];
  for (let i = 0; i < norm.length; i += 1) {
    const prev = norm[(i + norm.length - 1) % norm.length];
    const curr = norm[i];
    const next = norm[(i + 1) % norm.length];
    if (!prev || !curr || !next) continue;
    const dx1 = curr[0] - prev[0];
    const dz1 = curr[1] - prev[1];
    const l1 = Math.hypot(dx1, dz1);
    const dx2 = next[0] - curr[0];
    const dz2 = next[1] - curr[1];
    const l2 = Math.hypot(dx2, dz2);
    if (l1 < 0.05 || l2 < 0.05) return [];
    // Inward normals for CCW ring in XZ plane: (-dz, dx) normalized
    const n1x = -dz1 / l1;
    const n1z = dx1 / l1;
    const n2x = -dz2 / l2;
    const n2z = dx2 / l2;
    const bx = n1x + n2x;
    const bz = n1z + n2z;
    const bl = Math.hypot(bx, bz);
    if (bl < 1e-4) {
      result.push([curr[0] + n1x * offsetMeters, curr[1] + n1z * offsetMeters]);
      continue;
    }
    const ux = bx / bl;
    const uz = bz / bl;
    const denom = Math.max(0.45, ux * n1x + uz * n1z);
    const miter = Math.min(offsetMeters * 1.8, offsetMeters / denom);
    const nx = curr[0] + ux * miter;
    const nz = curr[1] + uz * miter;
    // Reject inverted vertices that overshoot past centroid
    const dotCenter = (nx - curr[0]) * (cx - curr[0]) + (nz - curr[1]) * (cz - curr[1]);
    const distCurr = Math.hypot(cx - curr[0], cz - curr[1]);
    if (distCurr <= offsetMeters * 0.9 || dotCenter <= 0) return [];
    result.push([nx, nz]);
  }
  const insetArea = Math.abs(ringSignedArea(result)) * 0.5;
  const origArea = Math.abs(ringSignedArea(norm)) * 0.5;
  if (insetArea < 16 || insetArea >= origArea * 0.96) return [];
  return result;
}
