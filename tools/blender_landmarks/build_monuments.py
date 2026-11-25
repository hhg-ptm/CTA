"""Generate bespoke Stylized Low Poly GLB landmarks for Caceres in Blender 5.2 headless.

Builds 5 heritage monuments strictly from their verified OSM footprints (`EPSG:25829`
relative meters) using shared UV swatch atlasing (`<= 2` materials per GLB, embedded
PNG textures, zero external URIs) so each file validates cleanly under
`tools/landmark-assets.mjs` and seats flush in `ChunkManager.loadLandmarkModels`.

Usage:
  blender.exe --background --factory-startup --python tools/blender_landmarks/build_monuments.py
"""

from __future__ import annotations

import json
import math
import struct
import sys
import tempfile
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector, geometry

THIS_DIR = Path(__file__).resolve().parent
TOOLS_DIR = THIS_DIR.parent
REPO_ROOT = TOOLS_DIR.parent
for p in (str(TOOLS_DIR), str(TOOLS_DIR / "blender_buildings")):
    if p not in sys.path:
        sys.path.insert(0, p)

import caceres_geo_processing as geo  # noqa: E402
from shared_data_paths import resolve_shared_readonly_path  # noqa: E402
from arch_helpers import bm_add_box, create_collection, create_mesh_object, reset_scene  # noqa: E402
from atlas import bake_object_to_shared_atlas, ensure_shared_atlas_materials  # noqa: E402
from materials import configure_stylized_world_and_lighting, ensure_palette_materials  # noqa: E402


# Verified target plaza focal centers in world meters (for primary facade orientation)
PLAZA_MAYOR_WORLD = (-4.21, 72.55)
SANTA_MARIA_PLAZA_WORLD = (108.46, 18.80)
SAN_MATEO_PLAZA_WORLD = (107.10, -172.00)


def load_osm_footprint_rel(way_id: int) -> tuple[list[tuple[float, float]], tuple[float, float]]:
    """Return `([(x_blender, y_blender), ...], (cx_world, cz_world))` for an OSM building way.

    Because Three.js glTF export (`export_yup=True`) maps Blender `(X, Y, Z)` to
    Three.js `(X, Z, -Y)`, world `(vx, vz)` centered at `(cx, cz)` maps to
    Blender `(vx - cx, -(vz - cz))`.
    """
    osm_path = resolve_shared_readonly_path("data/raw/osm/cc-monumental-expanded.json")
    osm = json.loads(osm_path.read_text(encoding="utf-8"))
    for el in osm.get("elements", []):
        if el.get("type") == "way" and el.get("id") == way_id:
            pts = [geo.project_etrs89_utm29(p["lon"], p["lat"]) for p in el.get("geometry", [])]
            if len(pts) >= 2 and pts[0] == pts[-1]:
                pts = pts[:-1]
            cx, cz = geo.polygon_centroid(pts)
            rel = [(p[0] - cx, -(p[1] - cz)) for p in pts]
            return ensure_ccw(rel), (cx, cz)
    raise RuntimeError(f"OSM way {way_id} not found in cached OSM extract.")


def ensure_ccw(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    area2 = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        area2 += x0 * y1 - x1 * y0
    return pts if area2 >= 0 else list(reversed(pts))


def extrude_polygon_prism(
    bm: bmesh.types.BMesh,
    poly_xy: list[tuple[float, float]],
    z0: float,
    z1: float,
    wall_mat: int,
    cap_mat: int,
    inset: float = 0.0,
) -> None:
    """Tessellate an arbitrary concave/convex CCW 2D polygon cleanly and extrude [z0, z1]."""
    pts = _inset_polygon_2d(poly_xy, inset)

    n = len(pts)
    bot_v = [bm.verts.new((x, y, z0)) for x, y in pts]
    top_v = [bm.verts.new((x, y, z1)) for x, y in pts]

    for i in range(n):
        j = (i + 1) % n
        try:
            f = bm.faces.new((bot_v[i], bot_v[j], top_v[j], top_v[i]))
            f.material_index = wall_mat
        except ValueError:
            pass

    tris = geometry.tessellate_polygon([[Vector((x, y, 0.0)) for x, y in pts]])
    for i0, i1, i2 in tris:
        try:
            ft = bm.faces.new((top_v[i0], top_v[i1], top_v[i2]))
            ft.material_index = cap_mat
        except ValueError:
            pass
        try:
            fb = bm.faces.new((bot_v[i2], bot_v[i1], bot_v[i0]))
            fb.material_index = cap_mat
        except ValueError:
            pass


def add_oriented_box(
    bm: bmesh.types.BMesh,
    center_xyz: tuple[float, float, float],
    size_xyz: tuple[float, float, float],
    yaw: float,
    mat_idx: int,
) -> None:
    mat = (
        Matrix.Translation(center_xyz)
        @ Matrix.Rotation(yaw, 4, "Z")
        @ Matrix.Diagonal((size_xyz[0], size_xyz[1], size_xyz[2], 1.0))
    )
    res = bmesh.ops.create_cube(bm, size=1.0, matrix=mat)
    for vert in res["verts"]:
        for f in vert.link_faces:
            f.material_index = mat_idx


def add_pitched_prism_roof(
    bm: bmesh.types.BMesh,
    cx: float,
    cy: float,
    width: float,
    depth: float,
    z_eave: float,
    ridge_h: float,
    yaw: float,
    roof_mat: int,
    rib_mat: int,
    gable_mat: int,
) -> None:
    """Create a stylized Spanish terracotta hipped/gabled tiled roof rotated by `yaw`."""
    xform = Matrix.Translation((cx, cy, 0.0)) @ Matrix.Rotation(yaw, 4, "Z")
    hw, hd = width * 0.5, depth * 0.5
    ridge_inset = min(hd * 0.65, hw * 0.42)
    rx = max(0.3, hw - ridge_inset)

    def v(lx: float, ly: float, lz: float) -> bmesh.types.BMVert:
        return bm.verts.new(xform @ Vector((lx, ly, lz)))

    c0 = v(-hw, -hd, z_eave)
    c1 = v(hw, -hd, z_eave)
    c2 = v(hw, hd, z_eave)
    c3 = v(-hw, hd, z_eave)
    r0 = v(-rx, 0.0, z_eave + ridge_h)
    r1 = v(rx, 0.0, z_eave + ridge_h)

    faces = [
        ((c0, c1, r1, r0), roof_mat),
        ((c2, c3, r0, r1), roof_mat),
        ((c3, c0, r0), roof_mat if ridge_inset > 0.4 else gable_mat),
        ((c1, c2, r1), roof_mat if ridge_inset > 0.4 else gable_mat),
        ((c3, c2, c1, c0), gable_mat),
    ]
    for verts, m_idx in faces:
        try:
            f = bm.faces.new(verts)
            f.material_index = m_idx
        except ValueError:
            pass
    add_oriented_box(bm, (cx, cy, z_eave + ridge_h + 0.05), (rx * 2.0 + 0.3, 0.28, 0.22), yaw, rib_mat)


def add_cylinder_part(
    bm: bmesh.types.BMesh,
    center_xyz: tuple[float, float, float],
    r_bot: float,
    r_top: float,
    height: float,
    segments: int,
    side_mat: int,
    cap_mat: int,
    euler_xyz: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> None:
    mat = Matrix.Translation(center_xyz) @ Euler(euler_xyz, "XYZ").to_matrix().to_4x4()
    res = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=True,
        segments=segments,
        radius1=r_bot,
        radius2=r_top,
        depth=height,
        matrix=mat,
    )
    cap_normal = (Euler(euler_xyz, "XYZ").to_matrix() @ Vector((0.0, 0.0, 1.0))).normalized()
    for vert in res["verts"]:
        for f in vert.link_faces:
            f.material_index = cap_mat if abs(f.normal.dot(cap_normal)) > 0.72 else side_mat


def _inset_polygon_2d(poly_xy: list[tuple[float, float]], inset: float) -> list[tuple[float, float]]:
    if abs(inset) <= 1e-4:
        return list(poly_xy)
    n = len(poly_xy)
    shrunk: list[tuple[float, float]] = []
    for i in range(n):
        p_prev = poly_xy[(i - 1) % n]
        p_cur = poly_xy[i]
        p_next = poly_xy[(i + 1) % n]
        e1 = Vector((p_cur[0] - p_prev[0], p_cur[1] - p_prev[1])).normalized()
        e2 = Vector((p_next[0] - p_cur[0], p_next[1] - p_cur[1])).normalized()
        n1 = Vector((-e1.y, e1.x))
        n2 = Vector((-e2.y, e2.x))
        bis = n1 + n2
        bis = n1 if bis.length < 1e-4 else bis.normalized()
        scale = max(-1.5, min(1.5, inset / max(0.35, bis.dot(n1))))
        shrunk.append((p_cur[0] + bis.x * scale, p_cur[1] + bis.y * scale))
    return shrunk


def add_polygonal_hip_roof(
    bm: bmesh.types.BMesh,
    poly_xy: list[tuple[float, float]],
    z_eave: float,
    peak_h: float,
    eave_inset: float,
    shrink_factor: float,
    roof_mat: int,
    cap_mat: int,
) -> None:
    """Create a tapered terracotta roof inset inside an arbitrary perimeter parapet."""
    eave_pts = _inset_polygon_2d(poly_xy, eave_inset)
    cx = sum(p[0] for p in eave_pts) / max(1, len(eave_pts))
    cy = sum(p[1] for p in eave_pts) / max(1, len(eave_pts))
    top_pts = [
        (x + (cx - x) * shrink_factor, y + (cy - y) * shrink_factor) for x, y in eave_pts
    ]
    n = len(eave_pts)
    bot_v = [bm.verts.new((x, y, z_eave)) for x, y in eave_pts]
    top_v = [bm.verts.new((x, y, z_eave + peak_h)) for x, y in top_pts]
    for i in range(n):
        j = (i + 1) % n
        try:
            f = bm.faces.new((bot_v[i], bot_v[j], top_v[j], top_v[i]))
            f.material_index = roof_mat
        except ValueError:
            pass
    tris = geometry.tessellate_polygon([[Vector((x, y, 0.0)) for x, y in top_pts]])
    for i0, i1, i2 in tris:
        try:
            ft = bm.faces.new((top_v[i0], top_v[i1], top_v[i2]))
            ft.material_index = cap_mat
        except ValueError:
            pass


def longest_edge_facing(
    poly_xy: list[tuple[float, float]], target_rel_xy: tuple[float, float]
) -> tuple[tuple[float, float], tuple[float, float], float, Vector, Vector]:
    """Return `(mid_xy, nrm_out, length, tangent_vec, out_vec)` for edge facing `target_rel_xy`."""
    best = None
    best_score = -1e9
    n = len(poly_xy)
    tx, ty = target_rel_xy
    for i in range(n):
        a = Vector(poly_xy[i])
        b = Vector(poly_xy[(i + 1) % n])
        edge = b - a
        length = edge.length
        if length < 3.0:
            continue
        tang = edge.normalized()
        out = Vector((tang.y, -tang.x))  # outward normal for CCW
        mid = (a + b) * 0.5
        to_target = Vector((tx - mid.x, ty - mid.y)).normalized()
        score = out.dot(to_target) * 3.0 + min(length, 25.0) * 0.05
        if score > best_score:
            best_score = score
            best = (mid, out, length, tang, out)
    assert best is not None
    return (best[0].x, best[0].y), (best[1].x, best[1].y), best[2], best[3], best[4]


def build_torre_bujaco(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """w385037728 — Torre de Bujaco on real pentagonal OSM footprint + Balcony of the Fueros."""
    poly, (cx, cz) = load_osm_footprint_rel(385037728)
    mat_list = [
        materials["wall_casco_stone"],     # 0 main masonry
        materials["wall_plinth_granite"],  # 1 plinth / talus / parapet base
        materials["trim_stone_warm"],      # 2 cornice / shield / balcony arches
        materials["roof_terracotta"],      # 3 tiles
        materials["roof_terracotta_ridge"],# 4 ridge
        materials["glass_sky"],            # 5 slit windows
        materials["metal_iron"],           # 6 cross/railings/weathervane
        materials["nest_twig"],            # 7 stork nest
    ]
    bm = bmesh.new()

    # Sub-plinth foundation (-2.6..2.2m) + battered granite base
    extrude_polygon_prism(bm, poly, -2.6, 2.2, wall_mat=1, cap_mat=1, inset=-0.18)
    # Main tower ashlar shaft (2.2..19.2m)
    extrude_polygon_prism(bm, poly, 2.2, 19.2, wall_mat=0, cap_mat=2, inset=0.05)
    # Overhanging machicolated cornice ring (19.2..20.1m)
    extrude_polygon_prism(bm, poly, 19.2, 20.1, wall_mat=2, cap_mat=1, inset=-0.36)

    # Crenellated Almohad merlons along each perimeter face + embrasures
    n = len(poly)
    for i in range(n):
        a = Vector(poly[i])
        b = Vector(poly[(i + 1) % n])
        edge = b - a
        elen = edge.length
        tang = edge.normalized()
        out = Vector((tang.y, -tang.x))
        yaw = math.atan2(tang.y, tang.x)
        count = max(2, int(elen / 1.75))
        for k in range(count):
            t = (k + 0.5) / count
            p = a.lerp(b, t) + out * 0.14
            add_oriented_box(bm, (p.x, p.y, 20.75), (0.85, 0.52, 1.3), yaw, 0)
            # Pyramid merlon cap
            add_oriented_box(bm, (p.x, p.y, 21.52), (0.92, 0.58, 0.24), yaw, 2)
        # Arrow slit embrasures at mid height
        mid = (a + b) * 0.5 + out * 0.04
        for hz in (8.2, 13.8):
            add_oriented_box(bm, (mid.x, mid.y, hz), (0.36, 0.14, 1.45), yaw, 5)
            add_oriented_box(bm, (mid.x, mid.y, hz), (0.58, 0.08, 1.65), yaw, 2)

    # Balcony of the Fueros projecting toward Plaza Mayor
    target_rel = (PLAZA_MAYOR_WORLD[0] - cx, -(PLAZA_MAYOR_WORLD[1] - cz))
    (bx, by), (ox, oy), elen, tang, out = longest_edge_facing(poly, target_rel)
    bal_yaw = math.atan2(tang.y, tang.x)
    bal_center = Vector((bx, by)) + out * 0.95
    bw = min(5.4, elen * 0.76)
    # Stone corbel brackets
    for frac in (-0.36, 0.0, 0.36):
        cp = Vector((bx, by)) + tang * (bw * frac) + out * 0.52
        add_oriented_box(bm, (cp.x, cp.y, 6.2), (0.42, 1.15, 0.72), bal_yaw, 1)
    # Balcony floor slab & Renaissance canopy columns
    add_oriented_box(bm, (bal_center.x, bal_center.y, 6.72), (bw, 1.75, 0.36), bal_yaw, 2)
    add_oriented_box(bm, (bal_center.x + out.x * 0.78, bal_center.y + out.y * 0.78, 7.25), (bw, 0.10, 0.75), bal_yaw, 6)
    for frac in (-0.42, 0.0, 0.42):
        col_p = Vector((bx, by)) + tang * (bw * frac) + out * 1.45
        add_oriented_box(bm, (col_p.x, col_p.y, 8.2), (0.28, 0.28, 2.6), bal_yaw, 2)
    add_pitched_prism_roof(
        bm,
        bal_center.x,
        bal_center.y,
        bw + 0.55,
        2.2,
        9.45,
        0.95,
        bal_yaw,
        roof_mat=3,
        rib_mat=4,
        gable_mat=2,
    )

    # Central terrace watch-turret / garita + stork nest on top corner
    add_oriented_box(bm, (0.0, 0.0, 21.4), (3.8, 3.8, 2.6), 0.25, 0)
    add_pitched_prism_roof(bm, 0.0, 0.0, 4.4, 4.4, 22.7, 1.35, 0.25, roof_mat=3, rib_mat=4, gable_mat=2)
    add_oriented_box(bm, (0.0, 0.0, 24.45), (0.08, 0.08, 1.1), 0.0, 6)
    add_cylinder_part(bm, (poly[0][0] * 0.65, poly[0][1] * 0.65, 22.05), 0.72, 0.92, 0.52, 8, 7, 7)

    col = create_collection("Landmark_Bujaco")
    return create_mesh_object("w385037728_TorreBujaco", bm, mat_list, col)


def build_torre_carvajal(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """w467504814 — Round medieval stone Torre de Carvajal on circular OSM footprint."""
    poly, _ = load_osm_footprint_rel(467504814)
    avg_r = sum(math.hypot(x, y) for x, y in poly) / len(poly)
    mat_list = [
        materials["wall_casco_stone"],     # 0 cylindrical stone body
        materials["wall_plinth_granite"],  # 1 tapered granite plinth
        materials["trim_stone_warm"],      # 2 stringcourses & corbels
        materials["roof_terracotta"],      # 3 conical tile turret cap
        materials["roof_terracotta_ridge"],# 4 cap ring
        materials["glass_sky"],            # 5 embrasures
        materials["metal_iron"],           # 6 iron finial
    ]
    bm = bmesh.new()

    # Cylindrical sub-plinth + flared medieval talus (-2.6..2.8m)
    add_cylinder_part(bm, (0.0, 0.0, -0.3), avg_r + 0.38, avg_r + 0.16, 4.6, 20, 1, 1)
    add_cylinder_part(bm, (0.0, 0.0, 3.0), avg_r + 0.16, avg_r, 2.0, 20, 1, 2)
    # Main tower cylinder (4.0..13.8m) with mid stone belt
    add_cylinder_part(bm, (0.0, 0.0, 8.9), avg_r, avg_r - 0.12, 9.8, 20, 0, 2)
    add_cylinder_part(bm, (0.0, 0.0, 8.5), avg_r + 0.08, avg_r + 0.08, 0.28, 20, 2, 2)
    # Top overhanging machicolation drum
    add_cylinder_part(bm, (0.0, 0.0, 14.05), avg_r - 0.10, avg_r + 0.24, 0.65, 20, 2, 1)

    # Ring of 16 curved battlements + 4 slit windows
    for k in range(16):
        ang = 2.0 * math.pi * k / 16.0
        mx = math.cos(ang) * (avg_r + 0.02)
        my = math.sin(ang) * (avg_r + 0.02)
        add_oriented_box(bm, (mx, my, 14.85), (0.42, 0.72, 1.05), ang, 0)
        add_oriented_box(bm, (mx, my, 15.46), (0.48, 0.76, 0.18), ang, 2)
    for k in range(4):
        ang = 2.0 * math.pi * k / 4.0 + 0.4
        wx = math.cos(ang) * (avg_r - 0.04)
        wy = math.sin(ang) * (avg_r - 0.04)
        add_oriented_box(bm, (wx, wy, 10.6), (0.18, 0.46, 1.55), ang, 5)
        add_oriented_box(bm, (wx, wy, 10.6), (0.12, 0.68, 1.78), ang, 2)

    # Inner rooftop drum + conical tiled lantern roof
    add_cylinder_part(bm, (0.0, 0.0, 15.2), avg_r * 0.56, avg_r * 0.56, 1.4, 14, 0, 2)
    add_cylinder_part(bm, (0.0, 0.0, 16.75), avg_r * 0.64, 0.08, 1.9, 14, 3, 4)
    add_oriented_box(bm, (0.0, 0.0, 17.95), (0.07, 0.07, 0.9), 0.0, 6)

    col = create_collection("Landmark_Carvajal")
    return create_mesh_object("w467504814_TorreCarvajal", bm, mat_list, col)


def build_concatedral_santa_maria(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """w385037723 — Gothic Concatedral de Santa María on 58-vertex buttressed OSM footprint."""
    poly, (cx, cz) = load_osm_footprint_rel(385037723)
    mat_list = [
        materials["wall_palace_granite"],  # 0 Gothic ashlar masonry
        materials["wall_plinth_granite"],  # 1 plinth / buttress caps
        materials["trim_stone_warm"],      # 2 portal mouldings & cornice
        materials["roof_terracotta"],      # 3 tiled nave roof
        materials["roof_terracotta_ridge"],# 4 ridge
        materials["glass_warm_shop"],      # 5 rose window & stained clerestory
        materials["metal_bronze"],         # 6 church bells
        materials["metal_iron"],           # 7 spire cross
    ]
    bm = bmesh.new()

    # Exact 58-vertex buttressed Gothic perimeter from -2.6m foundation to 12.6m eaves
    extrude_polygon_prism(bm, poly, -2.6, 2.0, wall_mat=1, cap_mat=1, inset=-0.12)
    extrude_polygon_prism(bm, poly, 2.0, 12.4, wall_mat=0, cap_mat=2, inset=0.0)
    extrude_polygon_prism(bm, poly, 12.4, 13.0, wall_mat=2, cap_mat=1, inset=-0.22)

    # Nave pitched roof aligned to main SW-NE axis (~42 deg in Blender XY)
    # Measure main OBB extent along diagonal axis to cover central nave cleanly
    nave_yaw = math.radians(-42.0)
    add_pitched_prism_roof(
        bm,
        1.5,
        0.0,
        36.0,
        22.0,
        12.95,
        4.6,
        nave_yaw,
        roof_mat=3,
        rib_mat=4,
        gable_mat=0,
    )
    # Transept cross roof over eastern choir
    add_pitched_prism_roof(
        bm,
        7.5,
        -2.5,
        24.0,
        13.5,
        13.2,
        4.1,
        nave_yaw + math.pi * 0.5,
        roof_mat=3,
        rib_mat=4,
        gable_mat=0,
    )

    # Pointed Gothic portal facing Plaza de Santa María (-X side)
    plaza_rel = (SANTA_MARIA_PLAZA_WORLD[0] - cx, -(SANTA_MARIA_PLAZA_WORLD[1] - cz))
    (px, py), (ox, oy), _, tang, out = longest_edge_facing(poly, plaza_rel)
    p_yaw = math.atan2(tang.y, tang.x)
    out_ang = math.atan2(oy, ox)
    add_oriented_box(bm, (px + ox * 0.25, py + oy * 0.25, 3.6), (4.6, 0.75, 6.8), p_yaw, 2)
    add_oriented_box(bm, (px + ox * 0.55, py + oy * 0.55, 2.7), (2.5, 0.35, 4.9), p_yaw, 1)
    # Rose oculus flush against facade above portal (vertical axis along outward normal)
    add_cylinder_part(
        bm,
        (px + ox * 0.22, py + oy * 0.22, 9.2),
        1.45,
        1.45,
        0.35,
        14,
        2,
        5,
        euler_xyz=(0.0, math.pi * 0.5, out_ang),
    )

    # Western three-body bell tower with grounded base (-2.6..24m) and 4 corner flameros
    west_pt = min(poly, key=lambda pt: pt[0])
    tx, ty = west_pt[0] + 4.3, west_pt[1] + 0.6
    t_yaw = nave_yaw
    add_oriented_box(bm, (tx, ty, 6.9), (5.5, 5.3, 19.0), t_yaw, 0)
    add_oriented_box(bm, (tx, ty, 18.0), (5.2, 5.0, 3.8), t_yaw, 0)
    add_oriented_box(bm, (tx, ty, 19.95), (5.6, 5.4, 0.35), t_yaw, 2)
    add_oriented_box(bm, (tx, ty, 22.1), (4.8, 4.6, 4.2), t_yaw, 2)
    # Bell openings & bronze bells
    for d_ang in (0.0, math.pi * 0.5, math.pi, math.pi * 1.5):
        a = t_yaw + d_ang
        bx_off = math.cos(a) * 2.2
        by_off = math.sin(a) * 2.2
        add_oriented_box(bm, (tx + bx_off, ty + by_off, 22.2), (0.35, 1.45, 2.15), a, 1)
        add_cylinder_part(bm, (tx + bx_off * 0.72, ty + by_off * 0.72, 22.3), 0.42, 0.25, 0.65, 8, 6, 6)
    # Top cornice, 4 corner flameros (pinnacles), pyramid spire & cross
    add_oriented_box(bm, (tx, ty, 24.35), (5.2, 5.0, 0.42), t_yaw, 2)
    c_rot = Matrix.Rotation(t_yaw, 2)
    for sx in (-2.2, 2.2):
        for sy in (-2.1, 2.1):
            off = c_rot @ Vector((sx, sy))
            add_cylinder_part(bm, (tx + off.x, ty + off.y, 25.35), 0.36, 0.08, 1.55, 6, 2, 2)
    add_cylinder_part(bm, (tx, ty, 26.25), 2.35, 0.12, 3.4, 4, 3, 4)
    add_oriented_box(bm, (tx, ty, 28.45), (0.10, 0.10, 1.4), 0.0, 7)
    add_oriented_box(bm, (tx, ty, 28.75), (0.75, 0.10, 0.10), t_yaw, 7)

    col = create_collection("Landmark_Concatedral")
    return create_mesh_object("w385037723_ConcatedralSantaMaria", bm, mat_list, col)


def build_ayuntamiento_caceres(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """w22358108 — Ayuntamiento de Cáceres facing Plaza Mayor with 5-arch granite arcade."""
    poly, (cx, cz) = load_osm_footprint_rel(22358108)
    mat_list = [
        materials["wall_civic_limestone"], # 0 upper neoclassical facade
        materials["wall_plinth_granite"],  # 1 plinth / piers / portico recessed shadow
        materials["trim_ivory"],           # 2 pilasters / pediment / arches
        materials["roof_terracotta"],      # 3 tiled hip roof
        materials["roof_terracotta_ridge"],# 4 ridge
        materials["glass_warm_shop"],      # 5 illuminated windows & clock face
        materials["metal_iron"],           # 6 wrought iron balcony rail
        materials["metal_gold_sign"],      # 7 crest / clock trim
    ]
    bm = bmesh.new()

    plaza_rel = (PLAZA_MAYOR_WORLD[0] - cx, -(PLAZA_MAYOR_WORLD[1] - cz))
    (fx, fy), (ox, oy), elen, tang, out = longest_edge_facing(poly, plaza_rel)
    f_yaw = math.atan2(tang.y, tang.x)

    # Solid foundation + lower granite body (-2.6..4.2m) & noble upper masonry (4.2..11.8m)
    extrude_polygon_prism(bm, poly, -2.6, 4.2, wall_mat=1, cap_mat=1, inset=0.0)
    extrude_polygon_prism(bm, poly, 4.2, 11.8, wall_mat=0, cap_mat=2, inset=0.0)
    extrude_polygon_prism(bm, poly, 11.8, 12.35, wall_mat=2, cap_mat=3, inset=-0.30)

    # Projecting 5-bay Plaza Mayor arcade (Soportales) along front edge
    bay_count = 5
    arcade_w = min(elen * 0.90, 24.0)
    bay_w = arcade_w / bay_count
    for k in range(bay_count + 1):
        along = (k / bay_count - 0.5) * arcade_w
        p = Vector((fx, fy)) + tang * along + out * 0.95
        # Massive granite pier
        add_oriented_box(bm, (p.x, p.y, 1.85), (0.72, 1.35, 4.2), f_yaw, 1)
    # Arcade upper entablature / balcony terrace & warm lit portal interior
    front_proj = Vector((fx, fy)) + out * 1.1
    add_oriented_box(bm, (front_proj.x, front_proj.y, 4.3), (arcade_w + 0.8, 1.9, 0.72), f_yaw, 2)
    for k in range(bay_count):
        along = ((k + 0.5) / bay_count - 0.5) * arcade_w
        wp = Vector((fx, fy)) + tang * along + out * 0.25
        add_oriented_box(bm, (wp.x, wp.y, 2.2), (bay_w * 0.55, 0.35, 3.2), f_yaw, 5)
        # Second-floor noble windows + pediment trim
        w2 = Vector((fx, fy)) + tang * along + out * 0.14
        add_oriented_box(bm, (w2.x, w2.y, 6.8), (1.35, 0.22, 2.45), f_yaw, 5)
        add_oriented_box(bm, (w2.x, w2.y, 8.2), (1.65, 0.34, 0.28), f_yaw, 2)
        # Attic level smaller windows
        add_oriented_box(bm, (w2.x, w2.y, 10.1), (1.15, 0.22, 1.55), f_yaw, 5)

    # Central openwork iron balcony railing & neoclassical pediment clock turret
    bal_w = arcade_w * 0.72
    bal_p = Vector((fx, fy)) + out * 1.9
    add_oriented_box(bm, (bal_p.x, bal_p.y, 4.72), (bal_w, 0.14, 0.14), f_yaw, 2)
    add_oriented_box(bm, (bal_p.x, bal_p.y, 5.52), (bal_w, 0.10, 0.08), f_yaw, 6)
    picket_count = 15
    for pk in range(picket_count):
        along_p = (pk / max(1, picket_count - 1) - 0.5) * (bal_w - 0.25)
        pp = bal_p + tang * along_p
        add_oriented_box(bm, (pp.x, pp.y, 5.14), (0.07, 0.07, 0.76), f_yaw, 6)
    ped_p = Vector((fx, fy)) - out * 0.6
    add_oriented_box(bm, (ped_p.x, ped_p.y, 13.0), (6.4, 1.2, 1.8), f_yaw, 2)
    add_oriented_box(bm, (ped_p.x + out.x * 0.65, ped_p.y + out.y * 0.65, 13.05), (1.35, 0.2, 1.35), f_yaw, 5)
    add_oriented_box(bm, (ped_p.x + out.x * 0.70, ped_p.y + out.y * 0.70, 14.2), (1.1, 0.25, 0.75), f_yaw, 7)

    # Main hipped terracotta roof
    add_pitched_prism_roof(bm, -2.0, 2.0, arcade_w + 1.5, 18.0, 12.25, 3.2, f_yaw, 3, 4, 2)

    col = create_collection("Landmark_Ayuntamiento")
    return create_mesh_object("w22358108_AyuntamientoCaceres", bm, mat_list, col)


def build_palacio_veletas(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """w382363931 — Casa / Palacio de las Veletas (Museo de Cáceres) with roof balustrade & finials."""
    poly, (cx, cz) = load_osm_footprint_rel(382363931)
    mat_list = [
        materials["wall_palace_granite"],  # 0 ashlar facade
        materials["wall_plinth_granite"],  # 1 plinth / portal voussoirs
        materials["trim_stone_warm"],      # 2 balustrade & pinnacles
        materials["roof_terracotta"],      # 3 terracotta roof
        materials["roof_terracotta_ridge"],# 4 ridge
        materials["glass_sky"],            # 5 recessed windows
        materials["metal_iron"],           # 6 wrought iron grilles & weathervanes
        materials["metal_gold_sign"],      # 7 heraldic crest
    ]
    bm = bmesh.new()

    extrude_polygon_prism(bm, poly, -2.6, 2.4, wall_mat=1, cap_mat=1, inset=-0.10)
    extrude_polygon_prism(bm, poly, 2.4, 9.4, wall_mat=0, cap_mat=2, inset=0.0)
    extrude_polygon_prism(bm, poly, 9.4, 9.85, wall_mat=2, cap_mat=3, inset=-0.28)

    # Parapet balustrade & signature corner pyramid pinnacles/weathervanes (las Veletas)
    for i, (vx, vy) in enumerate(poly):
        nx, ny = poly[(i + 1) % len(poly)]
        edge = Vector((nx - vx, ny - vy))
        elen = edge.length
        tang = edge.normalized()
        out = Vector((tang.y, -tang.x))
        yaw = math.atan2(tang.y, tang.x)
        # Pinnacle at corner
        add_cylinder_part(bm, (vx, vy, 10.6), 0.34, 0.08, 1.35, 4, 2, 2)
        add_oriented_box(bm, (vx, vy, 11.45), (0.06, 0.06, 0.65), 0.0, 6)
        if elen >= 4.0:
            bal_cnt = max(2, int(elen / 2.2))
            for k in range(bal_cnt):
                t = (k + 0.5) / bal_cnt
                bp = Vector((vx, vy)).lerp(Vector((nx, ny)), t) + out * 0.05
                add_oriented_box(bm, (bp.x, bp.y, 10.2), (1.15, 0.32, 0.65), yaw, 2)

    # Main facade towards Plaza de San Mateo with arch portal, grilles & heraldic shields
    plaza_rel = (SAN_MATEO_PLAZA_WORLD[0] - cx, -(SAN_MATEO_PLAZA_WORLD[1] - cz))
    (fx, fy), (ox, oy), elen, tang, out = longest_edge_facing(poly, plaza_rel)
    f_yaw = math.atan2(tang.y, tang.x)
    add_oriented_box(bm, (fx + out.x * 0.18, fy + out.y * 0.18, 2.2), (2.6, 0.55, 4.2), f_yaw, 1)
    add_oriented_box(bm, (fx + out.x * 0.25, fy + out.y * 0.25, 6.2), (1.25, 0.25, 1.35), f_yaw, 7)
    for frac in (-0.32, 0.32):
        wp = Vector((fx, fy)) + tang * (elen * frac) + out * 0.12
        add_oriented_box(bm, (wp.x, wp.y, 2.4), (1.15, 0.22, 1.9), f_yaw, 5)
        add_oriented_box(bm, (wp.x + out.x * 0.08, wp.y + out.y * 0.08, 2.4), (1.25, 0.08, 1.95), f_yaw, 6)
        add_oriented_box(bm, (wp.x, wp.y, 6.4), (1.25, 0.22, 2.2), f_yaw, 5)
        add_oriented_box(bm, (wp.x + out.x * 0.25, wp.y + out.y * 0.25, 5.2), (1.65, 0.55, 0.22), f_yaw, 6)

    # Architectural windows on every perimeter wall >= 8m so rear & flank views read rich
    for i, (vx, vy) in enumerate(poly):
        nx, ny = poly[(i + 1) % len(poly)]
        edge = Vector((nx - vx, ny - vy))
        elen_w = edge.length
        if elen_w < 8.0:
            continue
        tang_w = edge.normalized()
        out_w = Vector((tang_w.y, -tang_w.x))
        yaw_w = math.atan2(tang_w.y, tang_w.x)
        win_cnt = min(4, max(2, int(elen_w / 6.5)))
        for wk in range(win_cnt):
            frac = 0.18 + (wk + 0.5) * (0.64 / win_cnt)
            wp = Vector((vx, vy)).lerp(Vector((nx, ny)), frac) + out_w * 0.08
            add_oriented_box(bm, (wp.x, wp.y, 6.2), (1.1, 0.18, 2.0), yaw_w, 5)
            add_oriented_box(bm, (wp.x + out_w.x * 0.05, wp.y + out_w.y * 0.05, 2.6), (1.0, 0.16, 1.7), yaw_w, 5)
            add_oriented_box(bm, (wp.x + out_w.x * 0.09, wp.y + out_w.y * 0.09, 2.6), (1.06, 0.06, 1.74), yaw_w, 6)

    # Polygonal hipped terracotta roof fitted cleanly inside perimeter balustrade
    add_polygonal_hip_roof(
        bm,
        poly,
        z_eave=9.75,
        peak_h=2.1,
        eave_inset=0.45,
        shrink_factor=0.42,
        roof_mat=3,
        cap_mat=4,
    )

    col = create_collection("Landmark_Veletas")
    return create_mesh_object("w382363931_PalacioVeletas", bm, mat_list, col)


def _triangle_count(obj: bpy.types.Object) -> int:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(depsgraph)
    mesh = eval_obj.to_mesh()
    tris = sum(max(1, len(p.vertices) - 2) for p in mesh.polygons)
    eval_obj.to_mesh_clear()
    return tris


def _export_embedded_glb(obj: bpy.types.Object, out_path: Path) -> tuple[int, int]:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    out_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
    )
    data = out_path.read_bytes()
    jlen = struct.unpack_from("<I", data, 12)[0]
    hdr = json.loads(data[20 : 20 + jlen].decode("utf-8"))
    mats = len(hdr.get("materials", []))
    return out_path.stat().st_size, mats


def main() -> None:
    out_dir = REPO_ROOT / "public" / "landmarks"
    atlas_tmp = Path(tempfile.gettempdir()) / "cta_landmark_atlas"
    scene = bpy.context.scene

    builders = [
        ("w385037728", "Torre de Bujaco", build_torre_bujaco),
        ("w467504814", "Torre de Carvajal", build_torre_carvajal),
        ("w385037723", "Concatedral de Santa María", build_concatedral_santa_maria),
        ("w22358108", "Ayuntamiento de Cáceres", build_ayuntamiento_caceres),
        ("w382363931", "Palacio de las Veletas", build_palacio_veletas),
    ]

    summary = []
    for osm_id, label, fn in builders:
        reset_scene()
        configure_stylized_world_and_lighting(scene, gpu_optix=False)
        materials = ensure_palette_materials()
        mat_opaque, mat_glass, coords = ensure_shared_atlas_materials(atlas_tmp)
        obj = fn(materials)
        bake_object_to_shared_atlas(obj, mat_opaque, mat_glass, coords, apply_bevel=False)
        tris = _triangle_count(obj)
        glb_path = out_dir / f"{osm_id}.glb"
        size_bytes, mat_count = _export_embedded_glb(obj, glb_path)
        summary.append(
            {
                "id": osm_id,
                "name": label,
                "path": f"public/landmarks/{osm_id}.glb",
                "triangles": tris,
                "bytes": size_bytes,
                "materials": mat_count,
            }
        )

    print("BUILT_LANDMARK_GLBS:", json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
