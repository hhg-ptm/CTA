"""Hero Building 2: Edificio Residencial Moderno de 6 Plantas (Stylized Low Poly Blender model)."""

from __future__ import annotations

import math
import bmesh
import bpy
from mathutils import Vector

from arch_helpers import (
    add_cantilevered_balcony,
    add_potted_shrub,
    add_solid_wall_panel,
    add_subplinth_foundation,
    add_wall_panel_with_recessed_window,
    bm_add_box,
    bm_add_cylinder,
    create_collection,
    create_mesh_object,
)


def _add_ac_unit(bm: bmesh.types.BMesh, pos: tuple[float, float, float], mats: dict[str, int], yaw: float = 0.0) -> None:
    """Signature Stylized Low Poly wall AC unit (as seen on towers in reference ad2d3437)."""
    x, y, z = pos
    bm_add_box(bm, (x, y, z), (0.64, 0.28, 0.44), mats["ivory"], (0, 0, yaw))
    fx = x + math.sin(yaw) * 0.15
    fy = y - math.cos(yaw) * 0.15
    bm_add_cylinder(bm, (fx - math.cos(yaw) * 0.10, fy - math.sin(yaw) * 0.10, z), 0.15, 0.15, 0.03, 10, mats["iron"], (math.pi * 0.5, 0, yaw))


def build_hero_modern_residential(
    materials: dict[str, bpy.types.Material],
    collection_name: str = "Hero_Modern_Residential",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    lod: int = 0,
) -> bpy.types.Object:
    """Model Hero 2: 6-story stepped modern Cáceres/Stylized apartment tower with
    glazed commercial lobby podium + marquee canopy, chamfered concrete fins, recessed loggias,
    cantilevered glass balconies, exterior zigzag stair/shade spine, stepped floor-5 terrace,
    and full rooftop penthouse/HVAC/solar/antenna skyline.
    """
    detail_lod0 = lod == 0
    col = create_collection(collection_name)
    mat_list = [
        materials["wall_modern_sand"],    # 0
        materials["wall_modern_coral"],   # 1
        materials["wall_modern_slate"],   # 2
        materials["trim_ivory"],          # 3
        materials["trim_dark_concrete"],  # 4
        materials["metal_iron"],          # 5
        materials["metal_steel"],         # 6
        materials["glass_sky"],           # 7
        materials["glass_frosted"],       # 8
        materials["glass_warm_shop"],     # 9
        materials["roof_gravel"],         # 10
        materials["foliage_bright"],      # 11
        materials["lamp_glow"],           # 12
    ]
    mats = {
        "sand": 0, "coral": 1, "slate": 2, "ivory": 3, "dark": 4,
        "iron": 5, "steel": 6, "glass": 7, "frosted": 8, "warm_glass": 9,
        "gravel": 10, "foliage": 11, "lamp": 12,
    }

    bm = bmesh.new()
    # Two interlocking stepped volumes:
    # Wing A (Left-Main): 8.0m x 10.6m, 6 floors (ground 3.8m + 5 x 3.1m = 19.3m)
    # Wing B (Right-Stepped): 5.8m x 9.6m, 5 floors (ground 3.8m + 4 x 3.1m = 16.2m -> open terrace!)
    floor_h_g = 3.8
    floor_h = 3.1

    w_a, d_a = 8.0, 10.6
    cx_a, cy_a = -2.8, 0.0
    hx_a, hy_a = w_a * 0.5, d_a * 0.5

    w_b, d_b = 5.8, 9.6
    cx_b, cy_b = cx_a + hx_a + w_b * 0.5 - 0.2, 0.4
    hx_b, hy_b = w_b * 0.5, d_b * 0.5

    # Ground dark concrete podium base across full width + hill-safe subplinth
    add_subplinth_foundation(bm, (cx_a, cy_a), w_a + 0.16, d_a + 0.16, mats["dark"])
    add_subplinth_foundation(bm, (cx_b, cy_b), w_b + 0.16, d_b + 0.16, mats["dark"])
    bm_add_box(bm, (cx_a, cy_a, 0.25), (w_a + 0.16, d_a + 0.16, 0.50), mats["dark"])
    bm_add_box(bm, (cx_b, cy_b, 0.25), (w_b + 0.16, d_b + 0.16, 0.50), mats["dark"])

    # --- Ground Floor Podium (0 .. 3.8m) ---
    # Wing A Front (-Y): Grand entrance portal center + flanked tall commercial windows
    a_fl = Vector((cx_a - hx_a, cy_a - hy_a))
    a_fr = Vector((cx_a + hx_a, cy_a - hy_a))
    for i in range(3):
        sa, sb = a_fl.lerp(a_fr, i / 3), a_fl.lerp(a_fr, (i + 1) / 3)
        is_door = i == 1
        add_wall_panel_with_recessed_window(
            bm, sa, sb, Vector((0, -1)), 0.45, floor_h_g,
            mats["dark"], mats["dark"], mats["warm_glass"] if is_door else mats["glass"],
            mats["steel"], mats["ivory"],
            win_width_frac=0.66 if is_door else 0.72,
            sill_frac=0.0 if is_door else 0.14,
            head_frac=0.84, recess_depth=0.45 if is_door else 0.28,
            has_mullions=detail_lod0, has_architrave=False, sill_depth=0.06, lintel_depth=0.12,
        )
    # Cantilevered entrance marquee canopy + boxed shrubs
    bm_add_box(bm, (cx_a, cy_a - hy_a - 0.68, floor_h_g - 0.18), (4.2, 1.40, 0.20), mats["dark"])
    bm_add_box(bm, (cx_a, cy_a - hy_a - 0.68, floor_h_g - 0.30), (3.8, 1.25, 0.06), mats["lamp"])
    if detail_lod0:
        for sx in (-1, 1):
            add_potted_shrub(bm, (cx_a + sx * 1.45, cy_a - hy_a - 0.55, 0.0), mats["dark"], mats["foliage"], scale=0.82)

    # Wing B Ground Front (-Y): Slate modern showcase bays
    b_fl = Vector((cx_b - hx_b, cy_b - hy_b))
    b_fr = Vector((cx_b + hx_b, cy_b - hy_b))
    for i in range(2):
        sa, sb = b_fl.lerp(b_fr, i / 2), b_fl.lerp(b_fr, (i + 1) / 2)
        add_wall_panel_with_recessed_window(
            bm, sa, sb, Vector((0, -1)), 0.45, floor_h_g,
            mats["slate"], mats["dark"], mats["warm_glass"], mats["iron"], mats["ivory"],
            win_width_frac=0.70, sill_frac=0.14, head_frac=0.86, recess_depth=0.30,
            has_mullions=detail_lod0, has_architrave=False,
        )

    # Side & Back ground floor walls + solid interior junction pier closing Wing A / Wing B seam
    a_br, a_bl = Vector((cx_a + hx_a, cy_a + hy_a)), Vector((cx_a - hx_a, cy_a + hy_a))
    b_br, b_bl = Vector((cx_b + hx_b, cy_b + hy_b)), Vector((cx_b - hx_b, cy_b + hy_b))
    add_solid_wall_panel(bm, a_bl, a_fl, Vector((-1, 0)), 0.45, floor_h_g, mats["dark"])
    add_solid_wall_panel(bm, a_fr, a_br, Vector((1, 0)), 0.45, floor_h_g + 5 * floor_h, mats["sand"])
    add_solid_wall_panel(bm, a_br, a_bl, Vector((0, 1)), 0.45, floor_h_g, mats["dark"])
    add_solid_wall_panel(bm, b_fr, b_br, Vector((1, 0)), 0.45, floor_h_g, mats["slate"])
    add_solid_wall_panel(bm, b_br, b_bl, Vector((0, 1)), 0.45, floor_h_g, mats["slate"])

    # Heavy projecting podium slab band separating ground floor
    bm_add_box(bm, (cx_a, cy_a, floor_h_g + 0.08), (w_a + 0.48, d_a + 0.48, 0.24), mats["ivory"])
    bm_add_box(bm, (cx_b, cy_b, floor_h_g + 0.08), (w_b + 0.40, d_b + 0.40, 0.24), mats["ivory"])

    # --- Upper Floors of Wing A (floors 1..5 -> 5 residential floors above ground) ---
    for fl in range(5):
        zf0 = floor_h_g + fl * floor_h
        zf1 = zf0 + floor_h
        # Front (-Y): 3 residential bays — Left & Right alternate glass balcony, Center is wide panoramic window
        for i in range(3):
            sa, sb = a_fl.lerp(a_fr, i / 3), a_fl.lerp(a_fr, (i + 1) / 3)
            has_bal = (i == 0 and fl % 2 == 0) or (i == 2 and fl % 2 == 1)
            is_center = i == 1
            wall_c = mats["coral"] if is_center else mats["sand"]
            add_wall_panel_with_recessed_window(
                bm, sa, sb, Vector((0, -1)), zf0, zf1,
                wall_c, mats["dark"], mats["glass"], mats["iron"], mats["ivory"],
                win_width_frac=0.62 if has_bal else 0.72,
                sill_frac=0.05 if has_bal else 0.20,
                head_frac=0.88,
                recess_depth=0.48 if has_bal else 0.24,
                has_mullions=detail_lod0, has_architrave=False, sill_depth=0.14, lintel_depth=0.14,
            )
            if has_bal:
                mid = (sa + sb) * 0.5
                add_cantilevered_balcony(
                    bm, mid, Vector((0, -1)), Vector((1, 0)), zf0 + 0.04,
                    (sb - sa).length * 0.84, 0.88, mats["ivory"], mats["dark"],
                    glass_rail_mat=mats["frosted"], detailed=detail_lod0,
                )
                if detail_lod0 and fl % 2 == 0:
                    _add_ac_unit(bm, (mid.x + 0.85, cy_a - hy_a - 0.16, zf0 + 1.95), mats)

        # Back (+Y): 3 recessed window bays
        for i in range(3):
            sa, sb = a_br.lerp(a_bl, i / 3), a_br.lerp(a_bl, (i + 1) / 3)
            add_wall_panel_with_recessed_window(
                bm, sa, sb, Vector((0, 1)), zf0, zf1,
                mats["sand"], mats["dark"], mats["glass"], mats["iron"], mats["ivory"],
                win_width_frac=0.56, sill_frac=0.22, head_frac=0.86, recess_depth=0.22,
                has_mullions=detail_lod0, has_architrave=False,
            )
        # Left (-X): 3 recessed bays (center stairwell ribbon window, corners warm sand)
        for i in range(3):
            sa, sb = a_bl.lerp(a_fl, i / 3), a_bl.lerp(a_fl, (i + 1) / 3)
            is_stair = i == 1
            add_wall_panel_with_recessed_window(
                bm, sa, sb, Vector((-1, 0)), zf0, zf1,
                mats["coral"] if is_stair else mats["sand"], mats["dark"],
                mats["frosted"] if is_stair else mats["glass"], mats["iron"], mats["ivory"],
                win_width_frac=0.64 if is_stair else 0.48,
                sill_frac=0.12 if is_stair else 0.24, head_frac=0.90,
                recess_depth=0.24, has_mullions=detail_lod0, has_architrave=False,
            )
        # Horizontal floor concrete brow rib around Wing A
        if detail_lod0:
            bm_add_box(bm, (cx_a, cy_a, zf1), (w_a + 0.28, d_a + 0.28, 0.14), mats["ivory"])

    # Signature exterior zigzag architectural concrete rib spine on visible Right (+X) flank + Left-Front corner (ref ad2d3437!)
    if detail_lod0:
        # Left flank spine
        px_l = cx_a - hx_a - 0.10
        for k in range(5):
            z_base = floor_h_g + k * floor_h
            bm_add_box(bm, (px_l, cy_a - hy_a + 1.8, z_base + floor_h * 0.28), (0.34, 1.4, 0.24), mats["ivory"], (math.radians(24), 0, 0))
            bm_add_box(bm, (px_l, cy_a - hy_a + 1.8, z_base + floor_h * 0.72), (0.34, 1.4, 0.24), mats["ivory"], (math.radians(-24), 0, 0))
        # Prominent sculptural zigzag concrete stair feature along Wing B visible +X corner bay
        px_r = cx_b + hx_b + 0.14
        for k in range(4):
            z_base = floor_h_g + k * floor_h
            bm_add_box(bm, (px_r, cy_b + 0.4, z_base + floor_h * 0.28), (0.42, 2.1, 0.28), mats["ivory"], (math.radians(-24), 0, 0))
            bm_add_box(bm, (px_r, cy_b + 0.4, z_base + floor_h * 0.72), (0.42, 2.1, 0.28), mats["ivory"], (math.radians(24), 0, 0))
        for sy in (-0.85, 1.65):
            bm_add_box(bm, (px_r - 0.04, cy_b + sy, floor_h_g + 2.0 * floor_h), (0.28, 0.26, 4.0 * floor_h + 0.2), mats["dark"])

    # --- Upper Floors of Wing B (floors 1..4 -> 4 floors above ground, leaving Roof Terrace on level 5!) ---
    for fl in range(4):
        zf0 = floor_h_g + fl * floor_h
        zf1 = zf0 + floor_h
        # Front (-Y): 2 modern slate/cream loggia + curtain bays
        for i in range(2):
            sa, sb = b_fl.lerp(b_fr, i / 2), b_fl.lerp(b_fr, (i + 1) / 2)
            has_bal = (i + fl) % 2 == 0
            add_wall_panel_with_recessed_window(
                bm, sa, sb, Vector((0, -1)), zf0, zf1,
                mats["slate"], mats["dark"], mats["glass"], mats["steel"], mats["ivory"],
                win_width_frac=0.70, sill_frac=0.06 if has_bal else 0.18, head_frac=0.88,
                recess_depth=0.45 if has_bal else 0.24, has_mullions=detail_lod0, has_architrave=False,
            )
            if has_bal:
                mid = (sa + sb) * 0.5
                add_cantilevered_balcony(
                    bm, mid, Vector((0, -1)), Vector((1, 0)), zf0 + 0.04,
                    (sb - sa).length * 0.80, 0.78, mats["ivory"], mats["iron"],
                    glass_rail_mat=mats["frosted"], detailed=detail_lod0,
                )
        # Right (+X) curtain bays
        for i in range(3):
            sa, sb = b_fr.lerp(b_br, i / 3), b_fr.lerp(b_br, (i + 1) / 3)
            add_wall_panel_with_recessed_window(
                bm, sa, sb, Vector((1, 0)), zf0, zf1,
                mats["slate"], mats["dark"], mats["glass"], mats["steel"], mats["ivory"],
                win_width_frac=0.64, sill_frac=0.18, head_frac=0.88, recess_depth=0.24,
                has_mullions=detail_lod0, has_architrave=False,
            )
        # Back (+Y)
        for i in range(2):
            sa, sb = b_br.lerp(b_bl, i / 2), b_br.lerp(b_bl, (i + 1) / 2)
            add_wall_panel_with_recessed_window(
                bm, sa, sb, Vector((0, 1)), zf0, zf1,
                mats["slate"], mats["dark"], mats["glass"], mats["steel"], mats["ivory"],
                win_width_frac=0.58, sill_frac=0.22, head_frac=0.86, recess_depth=0.20,
                has_mullions=detail_lod0, has_architrave=False,
            )
        if detail_lod0:
            bm_add_box(bm, (cx_b, cy_b, zf1), (w_b + 0.22, d_b + 0.22, 0.14), mats["ivory"])

    # --- Wing A Hollow 3D Parapet Roof + Rooftop Penthouse + HVAC + Solar + Mast ---
    top_a = floor_h_g + 5 * floor_h
    bm_add_box(bm, (cx_a, cy_a, top_a - 0.12), (w_a, d_a, 0.24), mats["gravel"])
    p_h = 0.78
    p_t = 0.34
    for sx in (-1, 1):
        bm_add_box(bm, (cx_a + sx * (hx_a - p_t * 0.5), cy_a, top_a + p_h * 0.5), (p_t, d_a + 0.18, p_h), mats["sand"])
        bm_add_box(bm, (cx_a + sx * (hx_a - p_t * 0.5), cy_a, top_a + p_h + 0.07), (p_t + 0.14, d_a + 0.30, 0.14), mats["ivory"])
    for sy in (-1, 1):
        bm_add_box(bm, (cx_a, cy_a + sy * (hy_a - p_t * 0.5), top_a + p_h * 0.5), (w_a + 0.18, p_t, p_h), mats["sand"])
        bm_add_box(bm, (cx_a, cy_a + sy * (hy_a - p_t * 0.5), top_a + p_h + 0.07), (w_a + 0.30, p_t + 0.14, 0.14), mats["ivory"])

    # Rooftop Penthouse staircase bulkhead + HVAC chillers + tilted Solar panels + Mast
    bm_add_box(bm, (cx_a - 1.1, cy_a + 1.4, top_a + 1.15), (3.4, 3.2, 2.3), mats["sand"])
    bm_add_box(bm, (cx_a - 1.1, cy_a + 1.4, top_a + 2.36), (3.65, 3.45, 0.18), mats["ivory"])
    bm_add_box(bm, (cx_a - 1.1, cy_a - 0.22, top_a + 1.05), (1.05, 0.08, 2.0), mats["dark"])
    if detail_lod0:
        for dx in (1.6, 2.6):
            bm_add_box(bm, (cx_a + dx, cy_a + 1.8, top_a + 0.52), (0.85, 1.35, 1.04), mats["steel"])
            bm_add_cylinder(bm, (cx_a + dx, cy_a + 1.8, top_a + 1.06), 0.32, 0.32, 0.06, 10, mats["iron"])
        # Solar panels angled toward South (-Y)
        for sx in (-1.8, 0.0, 1.8):
            bm_add_box(bm, (cx_a + sx, cy_a - 2.3, top_a + 0.45), (1.45, 1.15, 0.07), mats["glass"], (math.radians(-26), 0, 0))
        # Communications mast & dish
        bm_add_cylinder(bm, (cx_a + 2.5, cy_a + 2.5, top_a + 3.6), 0.04, 0.03, 3.2, 6, mats["steel"])

    # --- Wing B Level-5 Open Terrace + Railings + Pergola Beam + Shrubs ---
    top_b = floor_h_g + 4 * floor_h
    bm_add_box(bm, (cx_b, cy_b, top_b - 0.12), (w_b, d_b, 0.24), mats["gravel"])
    bm_add_box(bm, (cx_b + hx_b - 0.16, cy_b, top_b + 0.52), (0.28, d_b, 1.04), mats["slate"])
    bm_add_box(bm, (cx_b, cy_b - hy_b + 0.08, top_b + 0.52), (w_b, 0.06, 1.04), mats["frosted"])
    bm_add_box(bm, (cx_b, cy_b - hy_b + 0.08, top_b + 1.06), (w_b + 0.10, 0.10, 0.08), mats["iron"])
    if detail_lod0:
        add_potted_shrub(bm, (cx_b + 1.2, cy_b - hy_b + 1.2, top_b), mats["dark"], mats["foliage"], scale=0.9)
        add_potted_shrub(bm, (cx_b - 0.8, cy_b - hy_b + 1.2, top_b), mats["dark"], mats["foliage"], scale=0.75)

    return create_mesh_object(
        f"ResidencialModerno_LOD{lod}",
        bm,
        mat_list,
        col,
        bevel_width=0.025 if detail_lod0 else 0.0,
        location=location,
    )
