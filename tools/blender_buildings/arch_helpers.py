"""Reusable Blender 5.2 architectural mesh modeling utilities for Stylized Low Poly buildings."""

from __future__ import annotations

import math
import bmesh
import bpy
from mathutils import Euler, Matrix, Vector


def reset_scene() -> None:
    """Clear all objects and orphaned meshes while preserving loaded materials."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)


def create_collection(name: str, parent: bpy.types.Collection | None = None) -> bpy.types.Collection:
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        target = parent or bpy.context.scene.collection
        target.children.link(col)
    return col


def _mat_index(obj: bpy.types.Object, mat: bpy.types.Material) -> int:
    for idx, m in enumerate(obj.data.materials):
        if m == mat:
            return idx
    obj.data.materials.append(mat)
    return len(obj.data.materials) - 1


def create_mesh_object(
    name: str,
    bm: bmesh.types.BMesh,
    mats: list[bpy.types.Material],
    collection: bpy.types.Collection,
    bevel_width: float = 0.0,
    bevel_segments: int = 1,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation_z: float = 0.0,
) -> bpy.types.Object:
    """Convert BMesh into a scene Object with assigned materials and optional crisp Bevel modifier."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    # Crisp flat-faceted Stylized Low Poly shading
    for poly in mesh.polygons:
        poly.use_smooth = False

    obj = bpy.data.objects.new(name, mesh)
    for m in mats:
        obj.data.materials.append(m)
    obj.location = location
    obj.rotation_euler = (0.0, 0.0, rotation_z)
    collection.objects.link(obj)

    if bevel_width > 0.0:
        bev = obj.modifiers.new(name="Bevel", type="BEVEL")
        bev.width = bevel_width
        bev.segments = bevel_segments
        bev.limit_method = "ANGLE"
        bev.angle_limit = math.radians(32)
        bev.harden_normals = False
    return obj


def bm_add_box(
    bm: bmesh.types.BMesh,
    center: tuple[float, float, float],
    size: tuple[float, float, float],
    mat_idx: int = 0,
    rot_euler: tuple[float, float, float] | None = None,
) -> list[bmesh.types.BMFace]:
    """Add an oriented box centered at `center` with extents `size`."""
    mat = Matrix.Translation(center)
    if rot_euler:
        mat = mat @ Euler(rot_euler, "XYZ").to_matrix().to_4x4()
    mat = mat @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    ret = bmesh.ops.create_cube(bm, size=1.0, matrix=mat)
    verts = ret["verts"]
    vset = set(verts)
    faces = [f for f in bm.faces if all(v in vset for v in f.verts)]
    for f in faces:
        f.material_index = mat_idx
    return faces


def bm_add_cylinder(
    bm: bmesh.types.BMesh,
    center: tuple[float, float, float],
    radius_bottom: float,
    radius_top: float,
    depth: float,
    segments: int = 8,
    mat_idx: int = 0,
    rot_euler: tuple[float, float, float] | None = None,
) -> list[bmesh.types.BMFace]:
    mat = Matrix.Translation(center)
    if rot_euler:
        mat = mat @ Euler(rot_euler, "XYZ").to_matrix().to_4x4()
    ret = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=segments,
        radius1=radius_bottom,
        radius2=radius_top,
        depth=depth,
        matrix=mat,
    )
    vset = set(ret["verts"])
    faces = [f for f in bm.faces if all(v in vset for v in f.verts)]
    for f in faces:
        f.material_index = mat_idx
    return faces


def add_wall_panel_with_recessed_window(
    bm: bmesh.types.BMesh,
    p0: Vector,
    p1: Vector,
    outward: Vector,
    z0: float,
    z1: float,
    wall_mat: int,
    reveal_mat: int,
    glass_mat: int,
    frame_mat: int,
    sill_mat: int,
    win_width_frac: float = 0.48,
    sill_frac: float = 0.24,
    head_frac: float = 0.86,
    recess_depth: float = 0.22,
    shutter_mat: int | None = None,
    has_mullions: bool = True,
    has_architrave: bool = True,
    sill_depth: float = 0.14,
    lintel_depth: float = 0.11,
) -> None:
    """Build a crisp grid-split exterior wall bay with a genuinely recessed 3D window opening,
    architrave casing jambs, deep sill & header lintel, divided glass mullions, and optional shutters.
    Zero messy Booleans — clean quad topology ready for Bevel + GLB export.
    """
    edge = p1 - p0
    panel_len = edge.length
    tangent = edge.normalized()
    out3 = Vector((outward.x, outward.y, 0.0)).normalized()
    wall_h = z1 - z0

    u0 = 0.5 - win_width_frac * 0.5
    u1 = 0.5 + win_width_frac * 0.5
    wz0 = z0 + wall_h * sill_frac
    wz1 = z0 + wall_h * head_frac
    z_levels = [z0, wz0, wz1, z1]
    u_levels = [0.0, u0, u1, 1.0]

    # Build 3x3 face grid omitting center (1, 1) opening
    pts = [p0 + edge * u for u in u_levels]
    for r in range(3):
        for c in range(3):
            if r == 1 and c == 1:
                continue
            v_a = bm.verts.new((pts[c].x, pts[c].y, z_levels[r]))
            v_b = bm.verts.new((pts[c + 1].x, pts[c + 1].y, z_levels[r]))
            v_c = bm.verts.new((pts[c + 1].x, pts[c + 1].y, z_levels[r + 1]))
            v_d = bm.verts.new((pts[c].x, pts[c].y, z_levels[r + 1]))
            f = bm.faces.new((v_a, v_b, v_c, v_d))
            if f.normal.dot(out3) < 0:
                f.normal_flip()
            f.material_index = wall_mat

    # Recessed opening reveal walls + glazing pane
    w_a = pts[1]
    w_b = pts[2]
    in_off = -outward * recess_depth
    w_a_in = w_a + in_off
    w_b_in = w_b + in_off

    # Bottom, Top, Left, Right reveals
    reveal_quads = [
        ((w_a.x, w_a.y, wz0), (w_b.x, w_b.y, wz0), (w_b_in.x, w_b_in.y, wz0), (w_a_in.x, w_a_in.y, wz0)),
        ((w_a_in.x, w_a_in.y, wz1), (w_b_in.x, w_b_in.y, wz1), (w_b.x, w_b.y, wz1), (w_a.x, w_a.y, wz1)),
        ((w_a.x, w_a.y, wz0), (w_a_in.x, w_a_in.y, wz0), (w_a_in.x, w_a_in.y, wz1), (w_a.x, w_a.y, wz1)),
        ((w_b_in.x, w_b_in.y, wz0), (w_b.x, w_b.y, wz0), (w_b.x, w_b.y, wz1), (w_b_in.x, w_b_in.y, wz1)),
    ]
    for coords in reveal_quads:
        f = bm.faces.new([bm.verts.new(c) for c in coords])
        f.material_index = reveal_mat

    # Glossy Sky Glass pane recessed inside
    gf = bm.faces.new(
        [
            bm.verts.new((w_a_in.x, w_a_in.y, wz0)),
            bm.verts.new((w_b_in.x, w_b_in.y, wz0)),
            bm.verts.new((w_b_in.x, w_b_in.y, wz1)),
            bm.verts.new((w_a_in.x, w_a_in.y, wz1)),
        ]
    )
    if gf.normal.dot(out3) < 0:
        gf.normal_flip()
    gf.material_index = glass_mat

    win_w = panel_len * win_width_frac
    win_h = wz1 - wz0
    mid = (w_a + w_b) * 0.5
    yaw = math.atan2(tangent.y, tangent.x)

    # Interior 3D frame perimeter & mullions flush inside recess
    frame_center = mid - outward * (recess_depth - 0.03)
    if has_mullions:
        bar_t = 0.045
        bar_d = 0.055
        # Top/bottom/left/right inner casement sash + central mullion + upper transom
        bm_add_box(bm, (frame_center.x, frame_center.y, wz0 + bar_t * 0.5), (win_w, bar_d, bar_t), frame_mat, (0, 0, yaw))
        bm_add_box(bm, (frame_center.x, frame_center.y, wz1 - bar_t * 0.5), (win_w, bar_d, bar_t), frame_mat, (0, 0, yaw))
        for side in (-1, 1):
            sp = frame_center + tangent * (side * (win_w * 0.5 - bar_t * 0.5))
            bm_add_box(bm, (sp.x, sp.y, (wz0 + wz1) * 0.5), (bar_t, bar_d, win_h), frame_mat, (0, 0, yaw))
        bm_add_box(bm, (frame_center.x, frame_center.y, (wz0 + wz1) * 0.5), (bar_t * 0.9, bar_d, win_h), frame_mat, (0, 0, yaw))
        if win_h >= 1.25:
            zt = wz0 + win_h * 0.66
            bm_add_box(bm, (frame_center.x, frame_center.y, zt), (win_w, bar_d, bar_t * 0.85), frame_mat, (0, 0, yaw))

    # Projecting 3D stone Sill & Header Lintel & Side Architrave Jambs
    sill_center = mid + outward * (sill_depth * 0.5 - 0.02)
    bm_add_box(bm, (sill_center.x, sill_center.y, wz0 - 0.035), (win_w + 0.18, sill_depth + 0.04, 0.09), sill_mat, (0, 0, yaw))

    lintel_center = mid + outward * (lintel_depth * 0.5 - 0.01)
    bm_add_box(bm, (lintel_center.x, lintel_center.y, wz1 + 0.055), (win_w + 0.22, lintel_depth + 0.02, 0.13), sill_mat, (0, 0, yaw))

    if has_architrave:
        jamb_w = 0.095
        jamb_c_off = outward * 0.035
        for side in (-1, 1):
            jp = mid + tangent * (side * (win_w * 0.5 + jamb_w * 0.45)) + jamb_c_off
            bm_add_box(bm, (jp.x, jp.y, (wz0 + wz1) * 0.5), (jamb_w, 0.08, win_h + 0.02), sill_mat, (0, 0, yaw))

    if shutter_mat is not None and win_w * 0.5 + 0.35 < panel_len * 0.5:
        sh_w = min(0.38, win_w * 0.42)
        for side in (-1, 1):
            sp = mid + tangent * (side * (win_w * 0.5 + (0.12 if has_architrave else 0.04) + sh_w * 0.5)) + outward * 0.04
            bm_add_box(bm, (sp.x, sp.y, (wz0 + wz1) * 0.5), (sh_w, 0.05, win_h - 0.02), shutter_mat, (0, 0, yaw))


def add_solid_wall_panel(
    bm: bmesh.types.BMesh,
    p0: Vector,
    p1: Vector,
    outward: Vector,
    z0: float,
    z1: float,
    wall_mat: int,
) -> None:
    v_a = bm.verts.new((p0.x, p0.y, z0))
    v_b = bm.verts.new((p1.x, p1.y, z0))
    v_c = bm.verts.new((p1.x, p1.y, z1))
    v_d = bm.verts.new((p0.x, p0.y, z1))
    f = bm.faces.new((v_a, v_b, v_c, v_d))
    out3 = Vector((outward.x, outward.y, 0.0))
    if f.normal.dot(out3) < 0:
        f.normal_flip()
    f.material_index = wall_mat


def add_curved_striped_awning(
    bm: bmesh.types.BMesh,
    center_xy: Vector,
    outward: Vector,
    tangent: Vector,
    top_z: float,
    width: float,
    proj: float,
    drop: float,
    color_a_mat: int,
    color_b_mat: int,
    metal_mat: int,
    stripes: int = 7,
) -> None:
    """Create a rich Stylized curved striped awning with scalloped valance & metal side arms."""
    yaw = math.atan2(tangent.y, tangent.x)
    # Curved profile points (3 arc steps + vertical scalloped skirt)
    profile = [
        (0.0, 0.0),
        (proj * 0.38, -drop * 0.22),
        (proj * 0.78, -drop * 0.58),
        (proj, -drop),
        (proj, -drop - 0.16),
    ]
    sw = width / stripes
    for s in range(stripes):
        u0 = -width * 0.5 + s * sw
        u1 = u0 + sw
        mat_idx = color_a_mat if s % 2 == 0 else color_b_mat
        for i in range(len(profile) - 1):
            d0, dz0 = profile[i]
            d1, dz1 = profile[i + 1]
            # Thickness top & bottom shell for crisp Stylized solidity
            thick = 0.035
            q_pts = [
                center_xy + tangent * u0 + outward * d0,
                center_xy + tangent * u1 + outward * d0,
                center_xy + tangent * u1 + outward * d1,
                center_xy + tangent * u0 + outward * d1,
            ]
            f_top = bm.faces.new([
                bm.verts.new((q_pts[0].x, q_pts[0].y, top_z + dz0)),
                bm.verts.new((q_pts[1].x, q_pts[1].y, top_z + dz0)),
                bm.verts.new((q_pts[2].x, q_pts[2].y, top_z + dz1)),
                bm.verts.new((q_pts[3].x, q_pts[3].y, top_z + dz1)),
            ])
            f_top.material_index = mat_idx
            f_bot = bm.faces.new([
                bm.verts.new((q_pts[3].x, q_pts[3].y, top_z + dz1 - thick)),
                bm.verts.new((q_pts[2].x, q_pts[2].y, top_z + dz1 - thick)),
                bm.verts.new((q_pts[1].x, q_pts[1].y, top_z + dz0 - thick)),
                bm.verts.new((q_pts[0].x, q_pts[0].y, top_z + dz0 - thick)),
            ])
            f_bot.material_index = mat_idx
            if i == len(profile) - 2:
                # Scallop hem front edge thickness + bottom drop roundness
                f_end = bm.faces.new([
                    bm.verts.new((q_pts[0].x, q_pts[0].y, top_z + dz1)),
                    bm.verts.new((q_pts[1].x, q_pts[1].y, top_z + dz1)),
                    bm.verts.new((q_pts[1].x, q_pts[1].y, top_z + dz1 - thick)),
                    bm.verts.new((q_pts[0].x, q_pts[0].y, top_z + dz1 - thick)),
                ])
                f_end.material_index = mat_idx

    # Support steel rods
    for side in (-1, 1):
        rod_p = center_xy + tangent * (side * (width * 0.46)) + outward * (proj * 0.45)
        bm_add_box(bm, (rod_p.x, rod_p.y, top_z - drop * 0.6), (0.04, proj * 0.85, 0.04), metal_mat, (math.radians(-22), 0, yaw))


def add_pitched_roof_with_ribs(
    bm: bmesh.types.BMesh,
    center_xy: Vector,
    span_x: float,
    span_y: float,
    base_z: float,
    peak_h: float,
    overhang: float,
    roof_mat: int,
    rib_mat: int,
    trim_mat: int,
    wall_mat: int,
    ridge_along_x: bool = True,
    rib_spacing: float = 0.65,
    eave_thickness: float = 0.16,
    detailed_ribs: bool = True,
) -> None:
    """Create a sculpted gabled roof with closed gable tympanums, thick overhanging fascia,
    raised 3D tile/standing-seam ribs along slopes, and bold ridge beam ("cumbrera").
    """
    hx = span_x * 0.5
    hy = span_y * 0.5
    ohx = hx + overhang
    ohy = hy + overhang

    if ridge_along_x:
        # Gable ends at -X and +X; slopes face -Y and +Y
        for sign_x in (-1, 1):
            ex = center_xy.x + sign_x * hx
            v1 = bm.verts.new((ex, center_xy.y - hy, base_z))
            v2 = bm.verts.new((ex, center_xy.y + hy, base_z))
            v3 = bm.verts.new((ex, center_xy.y, base_z + peak_h))
            f = bm.faces.new((v1, v2, v3) if sign_x > 0 else (v2, v1, v3))
            f.material_index = wall_mat

        # Roof slabs (front slope & back slope with thickness)
        slope_len = math.hypot(ohy, peak_h)
        slope_ang = math.atan2(peak_h, ohy)
        for sign_y in (-1, 1):
            mid_y = center_xy.y + sign_y * (ohy * 0.5)
            mid_z = base_z + peak_h * 0.5
            # Lower roof slightly outside at overhang
            eave_drop = (overhang / hy) * peak_h if hy > 0 else 0.0
            bm_add_box(
                bm,
                (center_xy.x, mid_y, mid_z - eave_drop * 0.35),
                (ohx * 2.0, slope_len, eave_thickness),
                roof_mat,
                (sign_y * -slope_ang, 0.0, 0.0),
            )
            # Bargeboard / trim fascia along gable rakes
            for sign_x in (-1, 1):
                bm_add_box(
                    bm,
                    (center_xy.x + sign_x * (ohx - 0.04), mid_y, mid_z - eave_drop * 0.35 + 0.02),
                    (0.10, slope_len + 0.08, eave_thickness + 0.07),
                    trim_mat,
                    (sign_y * -slope_ang, 0.0, 0.0),
                )
            # Horizontal eave fascia board
            bm_add_box(
                bm,
                (center_xy.x, center_xy.y + sign_y * (ohy - 0.03), base_z - eave_drop * 0.85),
                (ohx * 2.0, 0.08, eave_thickness + 0.04),
                trim_mat,
            )

        if detailed_ribs:
            count = max(4, int((ohx * 2.0) / rib_spacing))
            for i in range(count + 1):
                rx = center_xy.x - ohx + 0.14 + (i / count) * (ohx * 2.0 - 0.28)
                for sign_y in (-1, 1):
                    mid_y = center_xy.y + sign_y * (ohy * 0.5)
                    mid_z = base_z + peak_h * 0.5 + eave_thickness * 0.55 - ((overhang / max(0.5, hy)) * peak_h) * 0.35
                    bm_add_box(
                        bm,
                        (rx, mid_y, mid_z),
                        (0.11, slope_len, 0.085),
                        rib_mat,
                        (sign_y * -slope_ang, 0.0, 0.0),
                    )
        # Bold 3D ridge cap beam
        bm_add_box(
            bm,
            (center_xy.x, center_xy.y, base_z + peak_h + 0.09),
            (ohx * 2.0 + 0.12, 0.24, 0.16),
            rib_mat,
        )
    else:
        # Gable ends at -Y and +Y; slopes face -X and +X
        for sign_y in (-1, 1):
            ey = center_xy.y + sign_y * hy
            v1 = bm.verts.new((center_xy.x - hx, ey, base_z))
            v2 = bm.verts.new((center_xy.x + hx, ey, base_z))
            v3 = bm.verts.new((center_xy.x, ey, base_z + peak_h))
            f = bm.faces.new((v1, v2, v3) if sign_y < 0 else (v2, v1, v3))
            f.material_index = wall_mat

        slope_len = math.hypot(ohx, peak_h)
        slope_ang = math.atan2(peak_h, ohx)
        for sign_x in (-1, 1):
            mid_x = center_xy.x + sign_x * (ohx * 0.5)
            mid_z = base_z + peak_h * 0.5
            eave_drop = (overhang / hx) * peak_h if hx > 0 else 0.0
            bm_add_box(
                bm,
                (mid_x, center_xy.y, mid_z - eave_drop * 0.35),
                (slope_len, ohy * 2.0, eave_thickness),
                roof_mat,
                (0.0, sign_x * slope_ang, 0.0),
            )
            for sign_y in (-1, 1):
                bm_add_box(
                    bm,
                    (mid_x, center_xy.y + sign_y * (ohy - 0.04), mid_z - eave_drop * 0.35 + 0.02),
                    (slope_len + 0.08, 0.10, eave_thickness + 0.07),
                    trim_mat,
                    (0.0, sign_x * slope_ang, 0.0),
                )
            bm_add_box(
                bm,
                (center_xy.x + sign_x * (ohx - 0.03), center_xy.y, base_z - eave_drop * 0.85),
                (0.08, ohy * 2.0, eave_thickness + 0.04),
                trim_mat,
            )

        if detailed_ribs:
            count = max(4, int((ohy * 2.0) / rib_spacing))
            for i in range(count + 1):
                ry = center_xy.y - ohy + 0.14 + (i / count) * (ohy * 2.0 - 0.28)
                for sign_x in (-1, 1):
                    mid_x = center_xy.x + sign_x * (ohx * 0.5)
                    mid_z = base_z + peak_h * 0.5 + eave_thickness * 0.55 - ((overhang / max(0.5, hx)) * peak_h) * 0.35
                    bm_add_box(
                        bm,
                        (mid_x, ry, mid_z),
                        (slope_len, 0.11, 0.085),
                        rib_mat,
                        (0.0, sign_x * slope_ang, 0.0),
                    )
        bm_add_box(
            bm,
            (center_xy.x, center_xy.y, base_z + peak_h + 0.09),
            (0.24, ohy * 2.0 + 0.12, 0.16),
            rib_mat,
        )


def add_cantilevered_balcony(
    bm: bmesh.types.BMesh,
    wall_mid: Vector,
    outward: Vector,
    tangent: Vector,
    floor_z: float,
    width: float,
    proj: float,
    slab_mat: int,
    rail_mat: int,
    glass_rail_mat: int | None = None,
    detailed: bool = True,
) -> None:
    """Create a 3D cantilevered balcony with corbel brackets, beveled slab, and wrought-iron/glass rail."""
    yaw = math.atan2(tangent.y, tangent.x)
    slab_c = wall_mid + outward * (proj * 0.5)
    bm_add_box(bm, (slab_c.x, slab_c.y, floor_z - 0.08), (width, proj + 0.08, 0.16), slab_mat, (0, 0, yaw))

    if detailed:
        for side in (-1, 1):
            cp = wall_mid + tangent * (side * width * 0.34) + outward * (proj * 0.36)
            bm_add_box(bm, (cp.x, cp.y, floor_z - 0.24), (0.14, proj * 0.72, 0.22), slab_mat, (0, 0, yaw))
            cp2 = wall_mid + tangent * (side * width * 0.34) + outward * (proj * 0.18)
            bm_add_box(bm, (cp2.x, cp2.y, floor_z - 0.38), (0.14, proj * 0.36, 0.16), slab_mat, (0, 0, yaw))

    rail_h = 0.96
    rail_top_z = floor_z + rail_h
    front_c = wall_mid + outward * (proj - 0.05)

    # Top handrail perimeter + corner posts
    bm_add_box(bm, (front_c.x, front_c.y, rail_top_z), (width, 0.06, 0.05), rail_mat, (0, 0, yaw))
    bm_add_box(bm, (front_c.x, front_c.y, floor_z + 0.05), (width - 0.04, 0.04, 0.04), rail_mat, (0, 0, yaw))
    for side in (-1, 1):
        side_c = wall_mid + tangent * (side * (width * 0.5 - 0.04)) + outward * (proj * 0.5)
        bm_add_box(bm, (side_c.x, side_c.y, rail_top_z), (0.06, proj, 0.05), rail_mat, (0, 0, yaw))
        corner_p = wall_mid + tangent * (side * (width * 0.5 - 0.04)) + outward * (proj - 0.05)
        bm_add_box(bm, (corner_p.x, corner_p.y, floor_z + rail_h * 0.5), (0.06, 0.06, rail_h), rail_mat, (0, 0, yaw))

    if glass_rail_mat is not None:
        # Modern frosted/tinted glass balustrade panels
        bm_add_box(bm, (front_c.x, front_c.y, floor_z + rail_h * 0.48), (width - 0.12, 0.025, rail_h - 0.14), glass_rail_mat, (0, 0, yaw))
        for side in (-1, 1):
            sp = wall_mid + tangent * (side * (width * 0.5 - 0.04)) + outward * (proj * 0.5)
            bm_add_box(bm, (sp.x, sp.y, floor_z + rail_h * 0.48), (0.025, proj - 0.12, rail_h - 0.14), glass_rail_mat, (0, 0, yaw))
    elif detailed:
        # Wrought-iron vertical spindles
        n_bars = max(5, int(width / 0.22))
        for k in range(1, n_bars):
            u = -width * 0.5 + (k / n_bars) * width
            bp = front_c + tangent * u
            bm_add_box(bm, (bp.x, bp.y, floor_z + rail_h * 0.5), (0.032, 0.032, rail_h - 0.06), rail_mat, (0, 0, yaw))
        for side in (-1, 1):
            for frac in (0.28, 0.62):
                sp = wall_mid + tangent * (side * (width * 0.5 - 0.04)) + outward * (proj * frac)
                bm_add_box(bm, (sp.x, sp.y, floor_z + rail_h * 0.5), (0.032, 0.032, rail_h - 0.06), rail_mat, (0, 0, yaw))


def add_potted_shrub(
    bm: bmesh.types.BMesh,
    pos: tuple[float, float, float],
    pot_mat: int,
    foliage_mat: int,
    scale: float = 1.0,
) -> None:
    """Create a beveled stone planter + faceted Stylized low-poly ornamental bush."""
    x, y, z = pos
    bm_add_box(bm, (x, y, z + 0.22 * scale), (0.56 * scale, 0.56 * scale, 0.44 * scale), pot_mat)
    bm_add_box(bm, (x, y, z + 0.46 * scale), (0.64 * scale, 0.64 * scale, 0.08 * scale), pot_mat)
    mat_ico = Matrix.Translation((x, y, z + 0.85 * scale)) @ Matrix.Diagonal((0.44 * scale, 0.44 * scale, 0.52 * scale, 1.0))
    ret = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0, matrix=mat_ico)
    vset = set(ret["verts"])
    for f in bm.faces:
        if all(v in vset for v in f.verts):
            f.material_index = foliage_mat


def add_stylized_tree(
    bm: bmesh.types.BMesh,
    pos: tuple[float, float, float],
    bark_mat: int,
    foliage_mat: int,
    kind: str = "round",
    scale: float = 1.0,
) -> None:
    """Create lush multi-cluster faceted Stylized tree (pine/cypress/deciduous) for staging."""
    x, y, z = pos
    if kind == "pine":
        bm_add_cylinder(bm, (x, y, z + 0.8 * scale), 0.20 * scale, 0.13 * scale, 1.6 * scale, 6, bark_mat)
        for tier, (tz, rad, th) in enumerate([(1.7, 1.15, 1.7), (2.7, 0.90, 1.5), (3.6, 0.60, 1.3)]):
            bm_add_cylinder(bm, (x, y, z + tz * scale), rad * scale, 0.08 * scale, th * scale, 7, foliage_mat, (0, 0, tier * 0.4))
    elif kind == "cypress":
        bm_add_cylinder(bm, (x, y, z + 0.5 * scale), 0.14 * scale, 0.11 * scale, 1.0 * scale, 6, bark_mat)
        bm_add_cylinder(bm, (x, y, z + 2.8 * scale), 0.58 * scale, 0.12 * scale, 4.4 * scale, 7, foliage_mat)
    else:
        bm_add_cylinder(bm, (x, y, z + 1.2 * scale), 0.22 * scale, 0.14 * scale, 2.4 * scale, 6, bark_mat)
        clusters = [
            (0.0, 0.0, 3.2, 1.25),
            (0.62, 0.32, 2.7, 0.85),
            (-0.55, 0.35, 2.75, 0.88),
            (0.1, -0.58, 2.85, 0.82),
        ]
        for dx, dy, cz, rad in clusters:
            m = Matrix.Translation((x + dx * scale, y + dy * scale, z + cz * scale)) @ Matrix.Diagonal((rad * scale, rad * scale, rad * 0.88 * scale, 1.0))
            ret = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0, matrix=m)
            vset = set(ret["verts"])
            for f in bm.faces:
                if all(v in vset for v in f.verts):
                    f.material_index = foliage_mat
