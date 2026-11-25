import type { BuildingMaterial, BuildingSurfaceGeometry } from './types';
import { triangulatePolygon, type RoadPoint, type RoadPoint3 } from './road-geometry';
import { triangulatePolygonWithHoles } from './polygon-holes';

export type BuildingColor = readonly [number, number, number];
export type BuildingUv = readonly [number, number];

interface MaterialBuffer {
  readonly positions: number[];
  readonly normals: number[];
  readonly colors: number[];
  readonly uvs: number[];
  readonly indices: number[];
}

const MATERIAL_ORDER: readonly BuildingMaterial[] = [
  'casco_facade',
  'ensanche_facade',
  'periferia_facade',
  'tile_roof',
  'modern_roof',
  'monument_stone',
];

export class BuildingGeometryWriter {
  private readonly originX: number;
  private readonly originZ: number;
  private readonly materials = new Map<BuildingMaterial, MaterialBuffer>();
  private readonly colliderPositions: number[] = [];
  private readonly colliderIndices: number[] = [];

  constructor(originX: number, originZ: number) {
    this.originX = originX;
    this.originZ = originZ;
  }

  addQuad(
    material: BuildingMaterial,
    points: readonly [RoadPoint3, RoadPoint3, RoadPoint3, RoadPoint3],
    color: BuildingColor,
    uvs: readonly [BuildingUv, BuildingUv, BuildingUv, BuildingUv],
  ): void {
    this.addFace(material, points, color, uvs, [
      [0, 1, 2],
      [0, 2, 3],
    ]);
  }

  addTriangle(
    material: BuildingMaterial,
    points: readonly [RoadPoint3, RoadPoint3, RoadPoint3],
    color: BuildingColor,
    uvs: readonly [BuildingUv, BuildingUv, BuildingUv],
  ): void {
    this.addFace(material, points, color, uvs, [[0, 1, 2]]);
  }

  addPolygon(
    material: BuildingMaterial,
    points: readonly RoadPoint3[],
    color: BuildingColor,
    uvFor: (point: RoadPoint3) => BuildingUv,
  ): void {
    if (points.length < 3) return;
    const buffer = this.buffer(material);
    const base = buffer.positions.length / 3;
    for (const point of points) this.pushVertex(buffer, point, [0, 1, 0], color, uvFor(point));
    const triangles = triangulatePolygon(points.map((point) => [point[0], point[2]] as RoadPoint));
    for (const [a, b, c] of triangles) {
      const first = points[a];
      const second = points[b];
      const third = points[c];
      if (!first || !second || !third) continue;
      if (faceNormal(first, second, third)[1] >= 0)
        buffer.indices.push(base + a, base + b, base + c);
      else buffer.indices.push(base + a, base + c, base + b);
    }
  }

  addPolygonWithHoles(
    material: BuildingMaterial,
    outer: readonly RoadPoint3[],
    holes: readonly (readonly RoadPoint3[])[],
    color: BuildingColor,
    uvFor: (point: RoadPoint3) => BuildingUv,
  ): void {
    if (holes.length === 0) {
      this.addPolygon(material, outer, color, uvFor);
      return;
    }
    const outer2d = outer.map((point) => [point[0], point[2]] as RoadPoint);
    const holes2d = holes.map((hole) => hole.map((point) => [point[0], point[2]] as RoadPoint));
    const { vertices, triangles } = triangulatePolygonWithHoles(outer2d, holes2d);
    if (triangles.length === 0) {
      this.addPolygon(material, outer, color, uvFor);
      return;
    }
    const yLookup = new Map<string, number>();
    for (const pt of outer) yLookup.set(`${pt[0].toFixed(2)}:${pt[2].toFixed(2)}`, pt[1]);
    for (const hole of holes) {
      for (const pt of hole) yLookup.set(`${pt[0].toFixed(2)}:${pt[2].toFixed(2)}`, pt[1]);
    }
    const fallbackY = outer[0]?.[1] ?? 0;
    const points3d: RoadPoint3[] = vertices.map((v) => [
      v[0],
      yLookup.get(`${v[0].toFixed(2)}:${v[1].toFixed(2)}`) ?? fallbackY,
      v[1],
    ]);
    const buffer = this.buffer(material);
    const base = buffer.positions.length / 3;
    for (const point of points3d) this.pushVertex(buffer, point, [0, 1, 0], color, uvFor(point));
    for (const [a, b, c] of triangles) {
      const first = points3d[a];
      const second = points3d[b];
      const third = points3d[c];
      if (!first || !second || !third) continue;
      if (faceNormal(first, second, third)[1] >= 0)
        buffer.indices.push(base + a, base + b, base + c);
      else buffer.indices.push(base + a, base + c, base + b);
    }
  }

  addColliderTriangle(points: readonly [RoadPoint3, RoadPoint3, RoadPoint3]): void {
    const base = this.colliderPositions.length / 3;
    for (const point of points)
      this.colliderPositions.push(point[0] - this.originX, point[1], point[2] - this.originZ);
    this.colliderIndices.push(base, base + 1, base + 2);
  }

  build(): BuildingSurfaceGeometry[] {
    return MATERIAL_ORDER.flatMap((material) => {
      const buffer = this.materials.get(material);
      if (!buffer || buffer.indices.length === 0) return [];
      return [
        {
          material,
          positions: Float32Array.from(buffer.positions),
          normals: Float32Array.from(buffer.normals),
          colors: Float32Array.from(buffer.colors),
          uvs: Float32Array.from(buffer.uvs),
          indices: Uint32Array.from(buffer.indices),
        },
      ];
    });
  }

  buildCollider(): { positions: Float32Array; indices: Uint32Array } {
    return {
      positions: Float32Array.from(this.colliderPositions),
      indices: Uint32Array.from(this.colliderIndices),
    };
  }

  private addFace(
    material: BuildingMaterial,
    points: readonly RoadPoint3[],
    color: BuildingColor,
    uvs: readonly BuildingUv[],
    triangles: readonly (readonly [number, number, number])[],
  ): void {
    const buffer = this.buffer(material);
    const base = buffer.positions.length / 3;
    const normal = faceNormal(
      points[0] ?? [0, 0, 0],
      points[1] ?? [0, 0, 0],
      points[2] ?? [0, 0, 0],
    );
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const uv = uvs[index];
      if (point && uv) this.pushVertex(buffer, point, normal, color, uv);
    }
    for (const [a, b, c] of triangles) buffer.indices.push(base + a, base + b, base + c);
  }

  private buffer(material: BuildingMaterial): MaterialBuffer {
    let buffer = this.materials.get(material);
    if (!buffer) {
      buffer = { positions: [], normals: [], colors: [], uvs: [], indices: [] };
      this.materials.set(material, buffer);
    }
    return buffer;
  }

  private pushVertex(
    buffer: MaterialBuffer,
    point: RoadPoint3,
    normal: RoadPoint3,
    color: BuildingColor,
    uv: BuildingUv,
  ): void {
    buffer.positions.push(point[0] - this.originX, point[1], point[2] - this.originZ);
    buffer.normals.push(...normal);
    buffer.colors.push(...color);
    buffer.uvs.push(...uv);
  }
}

export function faceNormal(a: RoadPoint3, b: RoadPoint3, c: RoadPoint3): RoadPoint3 {
  const ab: RoadPoint3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: RoadPoint3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal: RoadPoint3 = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (length < 1e-8) return [0, 1, 0];
  return [normal[0] / length, normal[1] / length, normal[2] / length];
}
