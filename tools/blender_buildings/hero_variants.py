"""Architectural variation models for Cáceres Criminal (Stylized Low Poly Blender 5.2).

Breaks visual repetition across 3,400+ residential & modern buildings while sharing
the exact same 2-material UV atlas (CC_Atlas_Opaque + CC_Atlas_Glass).
"""

from __future__ import annotations

import math
import bmesh
import bpy
from mathutils import Vector

from arch_helpers import (
    add_cantilevered_balcony,
    add_pitched_roof_with_ribs,
    add_potted_shrub,
    add_solid_wall_panel,
    add_subplinth_foundation,
    add_wall_panel_with_recessed_window,
    bm_add_box,
    bm_add_cylinder,
    create_collection,
    create_mesh_object,
)


def build_variant_midrise_gabled(
    materials: dict[str, bpy.types.Material],
    collection_name: str = "Variant_Midrise_Gabled",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    lod: int = 0,
) -> bpy.types.Object:
    """Variant 07b: 3-story Spanish ensanche residential block with limestone/cream
    plaster walls, ground arcaded stone shops, shuttered French iron balconies,
    and a pitched terracotta roof with dormers (~12.4 m tall for 3-floor buildings).
    """
    detail_lod0 = lod == 0
    col = create_collection(collection_name)
    mat_list = [
        materials["wall_shop_cream"],        # 0
        materials["wall_casco_stone"],       # 1
        materials["wall_plinth_granite"],    # 2
        materials["trim_ivory"],             # 3
        materials["wood_olive"],             # 4
        materials["wood_cedar"],             # 5
        materials["metal_iron"],             # 6
        materials["glass_sky"],              # 7
        materials["glass_warm_shop"],        # 8
        materials["roof_terracotta"],        # 9
        materials["roof_terracotta_ridge"],  # 10
        materials["awning_red"],             # 11
        materials["awning_cream"],           # 12
        materials["foliage_bright"],         # 13
    ]
    m = {
        "cream": 0, "stone": 1, "plinth": 2, "ivory": 3, "olive": 4,
        "wood": 5, "iron": 6, "glass": 7, "warm_glass": 8,
        "roof": 9, "ridge": 10, "awn_r": 11, "awn_c": 12, "foliage": 13,
    }
    bm = bmesh.new()
    w, d = 13.6, 10.2
    hx, hy = w * 0.5, d * 0.5
    plinth_h = 0.40
    ground_h = 3.25
    floor_h = 2.95
    z_g = plinth_h + ground_h

    add_subplinth_foundation(bm, (0.0, 0.0), w + 0.16, d + 0.16, m["plinth"])
    bm_add_box(bm, (0.0, 0.0, plinth_h * 0.5), (w + 0.16, d + 0.16, plinth_h), m["plinth"])

    p_fl, p_fr = Vector((-hx, -hy)), Vector((hx, -hy))
    p_br, p_bl = Vector((hx, hy)), Vector((-hx, hy))

    # Ground floor: warm stone portal + flanking cream shopfronts
    for i in range(3):
        a = p_fl.lerp(p_fr, i / 3.0)
        b = p_fl.lerp(p_fr, (i + 1) / 3.0)
        is_portal = i == 1
        add_wall_panel_with_recessed_window(
            bm, a, b, Vector((0.0, -1.0)), plinth_h, z_g,
            wall_mat=m["stone"] if is_portal else m["plinth"],
            reveal_mat=m["ivory"],
            glass_mat=m["wood"] if is_portal else m["warm_glass"],
            frame_mat=m["iron"], sill_mat=m["ivory"],
            win_width_frac=0.58 if is_portal else 0.72,
            sill_frac=0.0 if is_portal else 0.16,
            head_frac=0.80, recess_depth=0.38 if is_portal else 0.28,
            has_mullions=detail_lod0, has_architrave=True,
        )
        if not is_portal and detail_lod0:
            mid = (a + b) * 0.5
            for s in range(4):
                sx = mid.x - 1.35 + s * 0.90
                bm_add_box(bm, (sx, -hy - 0.38, z_g - 0.55), (0.88, 0.85, 0.16), m["awn_r"] if s % 2 == 0 else m["awn_c"], (-0.28, 0.0, 0.0))

    for sa, sb, sout in ((p_fr, p_br, Vector((1.0, 0.0))), (p_br, p_bl, Vector((0.0, 1.0))), (p_bl, p_fl, Vector((-1.0, 0.0)))):
        add_wall_panel_with_recessed_window(
            bm, sa, sb, sout, plinth_h, z_g,
            wall_mat=m["plinth"], reveal_mat=m["ivory"], glass_mat=m["glass"],
            frame_mat=m["iron"], sill_mat=m["ivory"],
            win_width_frac=0.40, sill_frac=0.30, head_frac=0.80, recess_depth=0.20,
            has_mullions=False,
        )
    bm_add_box(bm, (0.0, 0.0, z_g + 0.04), (w + 0.28, d + 0.24, 0.20), m["ivory"])

    # Two upper floors (3 total stories) with shuttered windows & French iron balconies
    shutter = m["olive"] if detail_lod0 else None
    for f_idx in range(2):
        zf0 = z_g + f_idx * floor_h
        zf1 = zf0 + floor_h
        bm_add_box(bm, (0.0, 0.0, zf1 + 0.02), (w + 0.22, d + 0.20, 0.16), m["ivory"])
        for i in range(4):
            a = p_fl.lerp(p_fr, i / 4.0)
            b = p_fl.lerp(p_fr, (i + 1) / 4.0)
            is_bal = i in (1, 2)
            add_wall_panel_with_recessed_window(
                bm, a, b, Vector((0.0, -1.0)), zf0, zf1,
                wall_mat=m["cream"] if is_bal else m["stone"],
                reveal_mat=m["ivory"], glass_mat=m["glass"], frame_mat=m["wood"],
                sill_mat=m["ivory"], win_width_frac=0.52,
                sill_frac=0.06 if is_bal else 0.26, head_frac=0.84,
                recess_depth=0.26, shutter_mat=shutter,
                has_mullions=detail_lod0, has_architrave=True,
            )
            if is_bal:
                mid = (a + b) * 0.5
                add_cantilevered_balcony(
                    bm, Vector((mid.x, -hy)), Vector((0.0, -1.0)), Vector((1.0, 0.0)),
                    floor_z=zf0 + 0.06, width=(b - a).length * 0.68, proj=0.56,
                    slab_mat=m["ivory"], rail_mat=m["iron"], detailed=detail_lod0,
                )
        for sa, sb, sout in ((p_fr, p_br, Vector((1.0, 0.0))), (p_br, p_bl, Vector((0.0, 1.0))), (p_bl, p_fl, Vector((-1.0, 0.0)))):
            for k in range(2):
                a = sa.lerp(sb, k * 0.5)
                b = sa.lerp(sb, (k + 1) * 0.5)
                add_wall_panel_with_recessed_window(
                    bm, a, b, sout, zf0, zf1,
                    wall_mat=m["cream"], reveal_mat=m["ivory"], glass_mat=m["glass"],
                    frame_mat=m["wood"], sill_mat=m["ivory"],
                    win_width_frac=0.42, sill_frac=0.26, head_frac=0.80,
                    recess_depth=0.20, shutter_mat=None, has_mullions=detail_lod0,
                )

    z_top = z_g + 2 * floor_h
    add_pitched_roof_with_ribs(
        bm, Vector((0.0, 0.0)), w, d, z_top, 2.65, 0.48,
        roof_mat=m["roof"], rib_mat=m["ridge"], trim_mat=m["ivory"], wall_mat=m["cream"],
        ridge_along_x=True, rib_spacing=0.68, detailed_ribs=detail_lod0,
    )
    # Dormers & brick chimney
    bm_add_box(bm, (-2.8, 1.4, z_top + 1.8), (0.9, 0.8, 2.2), m["roof"])
    bm_add_box(bm, (-2.8, 1.4, z_top + 2.95), (1.05, 0.95, 0.16), m["ivory"])
    if detail_lod0:
        for dx in (-2.4, 2.4):
            bm_add_box(bm, (dx, -hy * 0.45, z_top + 1.25), (1.45, 1.4, 1.15), m["cream"])
            bm_add_box(bm, (dx, -hy * 0.45, z_top + 1.90), (1.65, 1.55, 0.22), m["roof"])
            bm_add_box(bm, (dx, -hy * 0.45 - 0.72, z_top + 1.25), (0.85, 0.08, 0.72), m["glass"])
        add_potted_shrub(bm, (-1.8, -hy - 0.38, 0.0), m["plinth"], m["foliage"], scale=0.72)

    return create_mesh_object(f"MidriseGabled_LOD{lod}", bm, mat_list, col, location=location)


def build_variant_midrise_attic(
    materials: dict[str, bpy.types.Material],
    collection_name: str = "Variant_Midrise_Attic",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    lod: int = 0,
) -> bpy.types.Object:
    """Variant 07c: 4-story + recessed setback attic penthouse ("ático retranqueado")
    Spanish apartment block in warm sand/ochre + dark slate vertical window bay & terrace.
    """
    detail_lod0 = lod == 0
    col = create_collection(collection_name)
    mat_list = [
        materials["wall_casco_ochre"],       # 0
        materials["wall_modern_sand"],       # 1
        materials["wall_modern_slate"],      # 2
        materials["trim_dark_concrete"],     # 3
        materials["trim_ivory"],             # 4
        materials["metal_iron"],             # 5
        materials["glass_sky"],              # 6
        materials["glass_frosted"],          # 7
        materials["glass_warm_shop"],        # 8
        materials["roof_gravel"],            # 9
        materials["awning_blue"],            # 10
        materials["lamp_glow"],              # 11
    ]
    m = {
        "ochre": 0, "sand": 1, "slate": 2, "dark": 3, "ivory": 4,
        "iron": 5, "glass": 6, "frosted": 7, "warm_glass": 8,
        "gravel": 9, "solar": 10, "lamp": 11,
    }
    bm = bmesh.new()
    w, d = 14.2, 11.2
    hx, hy = w * 0.5, d * 0.5
    plinth_h = 0.36
    ground_h = 3.45
    floor_h = 3.05
    z_g = plinth_h + ground_h

    add_subplinth_foundation(bm, (0.0, 0.0), w + 0.16, d + 0.16, m["dark"])
    bm_add_box(bm, (0.0, 0.0, plinth_h * 0.5), (w + 0.16, d + 0.16, plinth_h), m["dark"])

    p_fl, p_fr = Vector((-hx, -hy)), Vector((hx, -hy))
    p_br, p_bl = Vector((hx, hy)), Vector((-hx, hy))

    # Ground commercial + portal
    for i in range(3):
        a = p_fl.lerp(p_fr, i / 3.0)
        b = p_fl.lerp(p_fr, (i + 1) / 3.0)
        is_door = i == 2
        add_wall_panel_with_recessed_window(
            bm, a, b, Vector((0.0, -1.0)), plinth_h, z_g,
            wall_mat=m["slate"] if is_door else m["dark"], reveal_mat=m["ivory"],
            glass_mat=m["warm_glass"], frame_mat=m["iron"], sill_mat=m["ivory"],
            win_width_frac=0.68, sill_frac=0.0 if is_door else 0.14,
            head_frac=0.82, recess_depth=0.40, has_mullions=detail_lod0,
        )
    for sa, sb, sout in ((p_fr, p_br, Vector((1.0, 0.0))), (p_br, p_bl, Vector((0.0, 1.0))), (p_bl, p_fl, Vector((-1.0, 0.0)))):
        add_wall_panel_with_recessed_window(
            bm, sa, sb, sout, plinth_h, z_g,
            wall_mat=m["dark"], reveal_mat=m["ivory"], glass_mat=m["glass"],
            frame_mat=m["iron"], sill_mat=m["ivory"], win_width_frac=0.45,
            sill_frac=0.25, head_frac=0.80, recess_depth=0.20, has_mullions=False,
        )
    bm_add_box(bm, (0.0, 0.0, z_g + 0.04), (w + 0.30, d + 0.28, 0.22), m["ivory"])

    # 3 middle floors: continuous central protruding mirador + flanked sand/ochre bays
    for f_idx in range(3):
        zf0 = z_g + f_idx * floor_h
        zf1 = zf0 + floor_h
        bm_add_box(bm, (0.0, 0.0, zf1 + 0.02), (w + 0.20, d + 0.18, 0.16), m["ivory"])
        bays = [(0.0, 0.36, m["ochre"], False), (0.36, 0.64, m["slate"], True), (0.64, 1.0, m["sand"], False)]
        for u0, u1, wmat, is_mirador in bays:
            a = p_fl.lerp(p_fr, u0)
            b = p_fl.lerp(p_fr, u1)
            add_wall_panel_with_recessed_window(
                bm, a, b, Vector((0.0, -1.0)), zf0, zf1,
                wall_mat=wmat, reveal_mat=m["ivory"], glass_mat=m["glass"],
                frame_mat=m["iron"], sill_mat=m["ivory"],
                win_width_frac=0.72 if is_mirador else 0.58,
                sill_frac=0.06 if is_mirador else 0.22,
                head_frac=0.86, recess_depth=0.24, has_mullions=detail_lod0, has_architrave=True,
            )
            if is_mirador:
                mid = (a + b) * 0.5
                bw = (b - a).length * 0.88
                bm_add_box(bm, (mid.x, -hy - 0.36, (zf0 + zf1) * 0.5), (bw, 0.72, floor_h - 0.14), m["slate"])
                bm_add_box(bm, (mid.x, -hy - 0.72, (zf0 + zf1) * 0.52), (bw * 0.84, 0.08, floor_h * 0.66), m["glass"])
                bm_add_box(bm, (mid.x, -hy - 0.36, zf1 + 0.02), (bw + 0.14, 0.84, 0.14), m["ivory"])
            elif detail_lod0:
                mid = (a + b) * 0.5
                add_cantilevered_balcony(
                    bm, Vector((mid.x, -hy)), Vector((0.0, -1.0)), Vector((1.0, 0.0)),
                    floor_z=zf0 + 0.08, width=(b - a).length * 0.65, proj=0.75,
                    slab_mat=m["ivory"], rail_mat=m["iron"], glass_rail_mat=m["frosted"], detailed=detail_lod0,
                )
        for sa, sb, sout in ((p_fr, p_br, Vector((1.0, 0.0))), (p_br, p_bl, Vector((0.0, 1.0))), (p_bl, p_fl, Vector((-1.0, 0.0)))):
            for k in range(2):
                a = sa.lerp(sb, k * 0.5)
                b = sa.lerp(sb, (k + 1) * 0.5)
                add_wall_panel_with_recessed_window(
                    bm, a, b, sout, zf0, zf1,
                    wall_mat=m["ochre"] if k == 0 else m["sand"], reveal_mat=m["ivory"],
                    glass_mat=m["glass"], frame_mat=m["iron"], sill_mat=m["ivory"],
                    win_width_frac=0.46, sill_frac=0.26, head_frac=0.80, recess_depth=0.20,
                    has_mullions=detail_lod0,
                )

    # Setback Attic Penthouse ("Ático retranqueado") + glass perimeter balustrade
    z_attic0 = z_g + 3 * floor_h
    z_attic1 = z_attic0 + 2.85
    bm_add_box(bm, (0.0, 0.0, z_attic0 + 0.06), (w + 0.12, d + 0.12, 0.12), m["gravel"])
    bm_add_box(bm, (0.0, -hy + 0.10, z_attic0 + 0.52), (w + 0.10, 0.14, 0.92), m["frosted"])
    aw, ad = w * 0.72, d * 0.68
    bm_add_box(bm, (0.0, 0.4, (z_attic0 + z_attic1) * 0.5), (aw, ad, 2.85), m["sand"])
    bm_add_box(bm, (0.0, 0.4, z_attic1 + 0.10), (aw + 0.70, ad + 0.70, 0.22), m["ivory"])
    bm_add_box(bm, (0.0, 0.4 - ad * 0.5 - 0.04, z_attic0 + 1.45), (aw * 0.76, 0.10, 1.85), m["glass"])
    bm_add_box(bm, (-1.8, 0.4, z_attic1 + 0.42), (3.6, 1.5, 0.10), m["solar"], (-0.38, 0.0, 0.0))

    return create_mesh_object(f"MidriseAttic_LOD{lod}", bm, mat_list, col, location=location)


def build_variant_modern_setback(
    materials: dict[str, bpy.types.Material],
    collection_name: str = "Variant_Modern_Setback",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    lod: int = 0,
) -> bpy.types.Object:
    """Variant 02b: 6-story mirrored Slate/Sage/Ivory modern Cáceres apartment block
    with right-side tall stepped tower, vertical panoramic glass stair spine,
    and cantilevered rooftop helipad/HVAC deck (~22.8 m tall).
    """
    detail_lod0 = lod == 0
    col = create_collection(collection_name)
    mat_list = [
        materials["wall_modern_slate"],      # 0
        materials["wall_shop_sage"],         # 1
        materials["wall_shop_cream"],        # 2
        materials["trim_dark_concrete"],     # 3
        materials["trim_ivory"],             # 4
        materials["metal_iron"],             # 5
        materials["glass_sky"],              # 6
        materials["glass_frosted"],          # 7
        materials["glass_warm_shop"],        # 8
        materials["roof_gravel"],            # 9
        materials["lamp_glow"],              # 10
    ]
    m = {
        "slate": 0, "sage": 1, "cream": 2, "dark": 3, "ivory": 4,
        "iron": 5, "glass": 6, "frosted": 7, "warm_glass": 8, "gravel": 9, "lamp": 10,
    }
    bm = bmesh.new()
    w, d = 14.0, 11.4
    hx, hy = w * 0.5, d * 0.5
    ground_h = 3.8
    floor_h = 3.05

    add_subplinth_foundation(bm, (0.0, 0.0), w + 0.16, d + 0.16, m["dark"])
    bm_add_box(bm, (0.0, 0.0, 0.24), (w + 0.16, d + 0.16, 0.48), m["dark"])
    p_fl, p_fr = Vector((-hx, -hy)), Vector((hx, -hy))
    p_br, p_bl = Vector((hx, hy)), Vector((-hx, hy))

    for i in range(3):
        a = p_fl.lerp(p_fr, i / 3.0)
        b = p_fl.lerp(p_fr, (i + 1) / 3.0)
        add_wall_panel_with_recessed_window(
            bm, a, b, Vector((0.0, -1.0)), 0.44, ground_h,
            wall_mat=m["dark"], reveal_mat=m["ivory"],
            glass_mat=m["warm_glass"], frame_mat=m["iron"], sill_mat=m["ivory"],
            win_width_frac=0.72, sill_frac=0.0 if i == 1 else 0.14,
            head_frac=0.86, recess_depth=0.35, has_mullions=detail_lod0,
        )
    for sa, sb, sout in ((p_fr, p_br, Vector((1.0, 0.0))), (p_br, p_bl, Vector((0.0, 1.0))), (p_bl, p_fl, Vector((-1.0, 0.0)))):
        add_solid_wall_panel(bm, sa, sb, sout, 0.44, ground_h, m["dark"])
    bm_add_box(bm, (0.0, 0.0, ground_h + 0.06), (w + 0.36, d + 0.32, 0.24), m["ivory"])

    # 5 upper floors (right wing extends 1 floor higher for asymmetrical modern silhouette)
    for fl in range(5):
        zf0 = ground_h + fl * floor_h
        zf1 = zf0 + floor_h
        bm_add_box(bm, (0.0, 0.0, zf1 + 0.02), (w + 0.20, d + 0.18, 0.16), m["ivory"])
        for i, (u0, u1, wmat, has_bal) in enumerate([
            (0.0, 0.35, m["cream"], fl % 2 == 0),
            (0.35, 0.55, m["slate"], False),
            (0.55, 1.0, m["sage"], True),
        ]):
            a = p_fl.lerp(p_fr, u0)
            b = p_fl.lerp(p_fr, u1)
            is_stair = i == 1
            add_wall_panel_with_recessed_window(
                bm, a, b, Vector((0.0, -1.0)), zf0, zf1,
                wall_mat=wmat, reveal_mat=m["ivory"], glass_mat=m["glass"],
                frame_mat=m["iron"], sill_mat=m["ivory"],
                win_width_frac=0.74 if is_stair else 0.62,
                sill_frac=0.06 if (has_bal or is_stair) else 0.22,
                head_frac=0.90 if is_stair else 0.84,
                recess_depth=0.34, has_mullions=detail_lod0,
            )
            if has_bal:
                mid = (a + b) * 0.5
                add_cantilevered_balcony(
                    bm, Vector((mid.x, -hy)), Vector((0.0, -1.0)), Vector((1.0, 0.0)),
                    floor_z=zf0 + 0.08, width=(b - a).length * 0.78, proj=0.88,
                    slab_mat=m["ivory"], rail_mat=m["dark"], glass_rail_mat=m["frosted"], detailed=detail_lod0,
                )
        for sa, sb, sout in ((p_fr, p_br, Vector((1.0, 0.0))), (p_br, p_bl, Vector((0.0, 1.0))), (p_bl, p_fl, Vector((-1.0, 0.0)))):
            for k in range(2):
                a = sa.lerp(sb, k * 0.5)
                b = sa.lerp(sb, (k + 1) * 0.5)
                add_wall_panel_with_recessed_window(
                    bm, a, b, sout, zf0, zf1,
                    wall_mat=m["cream"] if k == 0 else m["sage"], reveal_mat=m["ivory"],
                    glass_mat=m["glass"], frame_mat=m["iron"], sill_mat=m["ivory"],
                    win_width_frac=0.45, sill_frac=0.24, head_frac=0.80, recess_depth=0.20,
                    has_mullions=False,
                )

    z6_0 = ground_h + 5 * floor_h
    z6_1 = z6_0 + 2.95
    # Crown penthouse box shifted right (+2.2m) for asymmetric modern profile
    bm_add_box(bm, (0.0, 0.0, z6_0 + 0.06), (w + 0.12, d + 0.12, 0.12), m["gravel"])
    bm_add_box(bm, (2.2, 0.2, (z6_0 + z6_1) * 0.5), (7.6, 8.8, 2.95), m["cream"])
    bm_add_box(bm, (2.2, 0.2, z6_1 + 0.10), (8.0, 9.2, 0.22), m["ivory"])
    bm_add_box(bm, (2.2, 0.2 - 4.42, z6_0 + 1.45), (5.2, 0.08, 1.8), m["glass"])
    if detail_lod0:
        bm_add_cylinder(bm, (-3.4, 1.2, z6_0 + 1.1), 0.72, 0.72, 1.8, 10, m["dark"])

    return create_mesh_object(f"ModernSetback_LOD{lod}", bm, mat_list, col, location=location)


def build_variant_lowrise_village(
    materials: dict[str, bpy.types.Material],
    collection_name: str = "Variant_Lowrise_Village",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    lod: int = 0,
) -> bpy.types.Object:
    """Variant 05b: Compact 1-2 story Extremaduran ochre/lime townhouse (~7.6 m tall)
    so short 1-2 floor rural, Aldea Moret, and ancillary buildings match real heights cleanly.
    """
    detail_lod0 = lod == 0
    col = create_collection(collection_name)
    mat_list = [
        materials["wall_casco_ochre"],       # 0
        materials["wall_casco_lime"],        # 1
        materials["wall_plinth_granite"],    # 2
        materials["trim_ivory"],             # 3
        materials["wood_cedar"],             # 4
        materials["metal_iron"],             # 5
        materials["glass_sky"],              # 6
        materials["roof_terracotta"],        # 7
        materials["roof_terracotta_ridge"],  # 8
        materials["lamp_glow"],              # 9
    ]
    m = {
        "ochre": 0, "lime": 1, "plinth": 2, "ivory": 3, "wood": 4,
        "iron": 5, "glass": 6, "roof": 7, "ridge": 8, "lamp": 9,
    }
    bm = bmesh.new()
    w, d = 10.6, 8.6
    hx, hy = w * 0.5, d * 0.5
    plinth_h = 0.42
    z_g = 3.25
    z_top = 5.85

    add_subplinth_foundation(bm, (0.0, 0.0), w + 0.16, d + 0.16, m["plinth"])
    bm_add_box(bm, (0.0, 0.0, plinth_h * 0.5), (w + 0.16, d + 0.16, plinth_h), m["plinth"])
    p_fl, p_fr = Vector((-hx, -hy)), Vector((hx, -hy))
    p_br, p_bl = Vector((hx, hy)), Vector((-hx, hy))

    for z0, z1, wall_m in ((plinth_h, z_g, m["ochre"]), (z_g, z_top, m["lime"])):
        for i in range(3):
            a = p_fl.lerp(p_fr, i / 3.0)
            b = p_fl.lerp(p_fr, (i + 1) / 3.0)
            is_door = z0 == plinth_h and i == 1
            add_wall_panel_with_recessed_window(
                bm, a, b, Vector((0.0, -1.0)), z0, z1,
                wall_mat=wall_m, reveal_mat=m["ivory"],
                glass_mat=m["wood"] if is_door else m["glass"],
                frame_mat=m["wood"], sill_mat=m["ivory"],
                win_width_frac=0.46, sill_frac=0.0 if is_door else 0.26,
                head_frac=0.80, recess_depth=0.24, shutter_mat=m["wood"] if (detail_lod0 and not is_door) else None,
                has_mullions=detail_lod0 and not is_door,
            )
        for sa, sb, sout in ((p_fr, p_br, Vector((1.0, 0.0))), (p_br, p_bl, Vector((0.0, 1.0))), (p_bl, p_fl, Vector((-1.0, 0.0)))):
            add_wall_panel_with_recessed_window(
                bm, sa, sb, sout, z0, z1,
                wall_mat=wall_m, reveal_mat=m["ivory"], glass_mat=m["glass"],
                frame_mat=m["wood"], sill_mat=m["ivory"],
                win_width_frac=0.38, sill_frac=0.28, head_frac=0.78, recess_depth=0.18,
                has_mullions=False,
            )
    bm_add_box(bm, (0.0, 0.0, z_g), (w + 0.18, d + 0.18, 0.14), m["ivory"])
    add_pitched_roof_with_ribs(
        bm, Vector((0.0, 0.0)), w, d, z_top, 1.75, 0.42,
        roof_mat=m["roof"], rib_mat=m["ridge"], trim_mat=m["ivory"], wall_mat=m["lime"],
        ridge_along_x=True, rib_spacing=0.66, detailed_ribs=detail_lod0,
    )
    bm_add_box(bm, (2.2, 1.2, z_top + 1.05), (0.76, 0.72, 1.45), m["roof"])
    bm_add_box(bm, (2.2, 1.2, z_top + 1.82), (0.90, 0.86, 0.12), m["ivory"])

    return create_mesh_object(f"LowriseVillage_LOD{lod}", bm, mat_list, col, location=location)
