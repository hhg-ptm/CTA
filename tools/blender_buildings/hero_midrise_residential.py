"""Hero Building 7: Bloque Residencial de 4 Plantas — Ensanche de Cáceres (Stylized Low Poly)."""

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


def build_hero_midrise_residential(
    materials: dict[str, bpy.types.Material],
    collection_name: str = "Hero_Midrise_Residential",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    lod: int = 0,
) -> bpy.types.Object:
    """Model Hero 7: 4-story Spanish urban apartment block typical of Cáceres Ensanche.

    Combines ground granite portal + steel marquee + flanking corner shop bay, exposed brick
    + warm sand masonry upper stories, continuous floor slab bands, covered loggia balconies
    with timber solar louver fins, glazed corner stairwell bay, rooftop pergola & solar array.
    """
    detail_lod0 = lod == 0
    col = create_collection(collection_name)
    mat_list = [
        materials["wall_brick_terracotta"],  # 0
        materials["wall_modern_sand"],       # 1
        materials["trim_dark_concrete"],     # 2
        materials["trim_ivory"],             # 3
        materials["wall_plinth_granite"],    # 4
        materials["wood_cedar"],             # 5
        materials["metal_iron"],             # 6
        materials["metal_steel"],            # 7
        materials["glass_sky"],              # 8
        materials["glass_frosted"],          # 9
        materials["glass_warm_shop"],        # 10
        materials["roof_gravel"],            # 11
        materials["lamp_glow"],              # 12
        materials["foliage_bright"],         # 13
        materials["awning_blue"],            # 14
    ]
    mats = {
        "brick": 0, "sand": 1, "dark": 2, "ivory": 3, "plinth": 4,
        "wood": 5, "iron": 6, "steel": 7, "glass": 8, "frosted": 9,
        "warm_glass": 10, "gravel": 11, "lamp": 12, "foliage": 13, "solar": 14,
    }

    bm = bmesh.new()
    w, d = 13.8, 10.0
    hx, hy = w * 0.5, d * 0.5
    plinth_h = 0.36
    ground_h = 3.45
    floor_h = 3.05

    add_subplinth_foundation(bm, (0.0, 0.0), w + 0.16, d + 0.16, mats["plinth"])
    bm_add_box(bm, (0.0, 0.0, plinth_h * 0.5), (w + 0.16, d + 0.16, plinth_h), mats["dark"])

    p_fl, p_fr = Vector((-hx, -hy)), Vector((hx, -hy))
    p_br, p_bl = Vector((hx, hy)), Vector((-hx, hy))
    z_g = plinth_h + ground_h

    # === 1. GROUND FLOOR: Shopfront Left + Recessed Portal Center + Brick Base Right ===
    bays = [0.0, 0.35, 0.65, 1.0]
    for i, kind in enumerate(("shop", "portal", "mezz")):
        a = p_fl.lerp(p_fr, bays[i])
        b = p_fl.lerp(p_fr, bays[i + 1])
        out = Vector((0.0, -1.0))
        if kind == "portal":
            add_wall_panel_with_recessed_window(
                bm, a, b, out, plinth_h, z_g,
                wall_mat=mats["plinth"], reveal_mat=mats["dark"],
                glass_mat=mats["warm_glass"], frame_mat=mats["iron"],
                sill_mat=mats["plinth"], win_width_frac=0.64, sill_frac=0.0,
                head_frac=0.78, recess_depth=0.50, shutter_mat=None,
                has_mullions=detail_lod0, has_architrave=True, sill_depth=0.0, lintel_depth=0.14,
            )
            mid = (a + b) * 0.5
            # Stepped canopy marquee & lobby step
            bm_add_box(bm, (mid.x, -hy - 0.52, z_g - 0.42), ((b - a).length * 0.88, 1.05, 0.16), mats["dark"])
            bm_add_box(bm, (mid.x, -hy - 0.50, z_g - 0.51), ((b - a).length * 0.78, 0.90, 0.04), mats["lamp"])
            bm_add_box(bm, (mid.x, -hy - 0.22, plinth_h * 0.5), ((b - a).length * 0.72, 0.44, plinth_h), mats["plinth"])
            if detail_lod0:
                add_potted_shrub(bm, (mid.x - 1.55, -hy - 0.34, 0.0), mats["dark"], mats["foliage"], scale=0.74)
                add_potted_shrub(bm, (mid.x + 1.55, -hy - 0.34, 0.0), mats["dark"], mats["foliage"], scale=0.74)
        elif kind == "shop":
            add_wall_panel_with_recessed_window(
                bm, a, b, out, plinth_h, z_g,
                wall_mat=mats["dark"], reveal_mat=mats["ivory"],
                glass_mat=mats["warm_glass"], frame_mat=mats["iron"],
                sill_mat=mats["plinth"], win_width_frac=0.72, sill_frac=0.14,
                head_frac=0.80, recess_depth=0.32, shutter_mat=None,
                has_mullions=True, has_architrave=True,
            )
        else:
            add_wall_panel_with_recessed_window(
                bm, a, b, out, plinth_h, z_g,
                wall_mat=mats["brick"], reveal_mat=mats["ivory"],
                glass_mat=mats["glass"], frame_mat=mats["iron"],
                sill_mat=mats["ivory"], win_width_frac=0.58, sill_frac=0.34,
                head_frac=0.80, recess_depth=0.22, shutter_mat=None,
                has_mullions=detail_lod0, has_architrave=True,
            )

    for sa, sb, sout in ((p_fr, p_br, Vector((1.0, 0.0))), (p_br, p_bl, Vector((0.0, 1.0))), (p_bl, p_fl, Vector((-1.0, 0.0)))):
        add_wall_panel_with_recessed_window(
            bm, sa, sb, sout, plinth_h, z_g,
            wall_mat=mats["dark"], reveal_mat=mats["ivory"],
            glass_mat=mats["glass"], frame_mat=mats["iron"],
            sill_mat=mats["plinth"], win_width_frac=0.40, sill_frac=0.32,
            head_frac=0.78, recess_depth=0.24, shutter_mat=None, has_mullions=False,
        )

    # Continuous exposed concrete slab band above ground floor
    bm_add_box(bm, (0.0, 0.0, z_g + 0.04), (w + 0.26, d + 0.22, 0.22), mats["ivory"])

    # === 2. THREE UPPER RESIDENTIAL FLOORS (Floors 2..4) ===
    for f_idx in range(3):
        zf0 = z_g + f_idx * floor_h
        zf1 = zf0 + floor_h

        # Horizontal slab stringer at floor top
        bm_add_box(bm, (0.0, 0.0, zf1 + 0.02), (w + 0.20, d + 0.18, 0.18), mats["ivory"])

        # Front 4 rhythmic bays: [Brick+Balcony] | [Sand Center Window] | [Brick+Terrace] | [Tall Stairwell/Window]
        col_specs = [
            (0.00, 0.28, mats["brick"], True, False),
            (0.28, 0.56, mats["sand"], False, False),
            (0.56, 0.84, mats["brick"], True, True),
            (0.84, 1.00, mats["sand"], False, False),
        ]
        for u0, u1, w_mat, has_balc, has_louvers in col_specs:
            a = p_fl.lerp(p_fr, u0)
            b = p_fl.lerp(p_fr, u1)
            is_stair = u0 > 0.80
            add_wall_panel_with_recessed_window(
                bm, a, b, Vector((0.0, -1.0)), zf0, zf1,
                wall_mat=w_mat, reveal_mat=mats["ivory"],
                glass_mat=mats["glass"], frame_mat=mats["iron"],
                sill_mat=mats["ivory"],
                win_width_frac=0.64 if not is_stair else 0.54,
                sill_frac=0.06 if has_balc else (0.12 if is_stair else 0.26),
                head_frac=0.82 if not is_stair else 0.90,
                recess_depth=0.34 if has_balc else 0.24,
                shutter_mat=None, has_mullions=detail_lod0 or is_stair,
                has_architrave=True,
            )
            mid = (a + b) * 0.5
            bw = (b - a).length * 0.72
            if has_balc:
                # Brick + glass modern mixed terrace balcony
                add_cantilevered_balcony(
                    bm, Vector((mid.x, -hy)), Vector((0.0, -1.0)), Vector((1.0, 0.0)),
                    floor_z=zf0 + 0.10, width=bw, proj=0.92,
                    slab_mat=mats["ivory"], rail_mat=mats["iron"],
                    glass_rail_mat=mats["frosted"], detailed=detail_lod0,
                )
                # Side timber solar fins ("celosías") along one edge of terrace
                if has_louvers and detail_lod0:
                    lx = mid.x + bw * 0.46
                    for s_idx in range(3):
                        bm_add_box(bm, (lx - s_idx * 0.12, -hy - 0.46, zf0 + floor_h * 0.52), (0.05, 0.78, floor_h - 0.16), mats["wood"])
            elif u0 == 0.28 and detail_lod0 and f_idx in (0, 2):
                # Subtle wall AC condenser unit next to center window
                bm_add_box(bm, (mid.x - 1.38, -hy - 0.12, zf0 + 1.05), (0.52, 0.24, 0.36), mats["ivory"])
                bm_add_cylinder(bm, (mid.x - 1.46, -hy - 0.25, zf0 + 1.05), 0.12, 0.12, 0.03, 8, mats["iron"], (math.pi * 0.5, 0.0, 0.0))

        # Flanks (+X and -X) alternating Brick / Sand bays
        for sa, sb, sout in ((p_fr, p_br, Vector((1.0, 0.0))), (p_bl, p_fl, Vector((-1.0, 0.0)))):
            for k in range(2):
                a = sa.lerp(sb, k * 0.5)
                b = sa.lerp(sb, (k + 1) * 0.5)
                wmat = mats["sand"] if k == 0 else mats["brick"]
                add_wall_panel_with_recessed_window(
                    bm, a, b, sout, zf0, zf1,
                    wall_mat=wmat, reveal_mat=mats["ivory"],
                    glass_mat=mats["glass"], frame_mat=mats["iron"],
                    sill_mat=mats["ivory"], win_width_frac=0.44, sill_frac=0.26,
                    head_frac=0.80, recess_depth=0.22, shutter_mat=None,
                    has_mullions=detail_lod0, has_architrave=True,
                )
        # Back (+Y) windows
        for k in range(3):
            a = p_br.lerp(p_bl, k / 3.0)
            b = p_br.lerp(p_bl, (k + 1) / 3.0)
            add_wall_panel_with_recessed_window(
                bm, a, b, Vector((0.0, 1.0)), zf0, zf1,
                wall_mat=mats["sand"] if k == 1 else mats["brick"],
                reveal_mat=mats["ivory"], glass_mat=mats["glass"], frame_mat=mats["iron"],
                sill_mat=mats["ivory"], win_width_frac=0.42, sill_frac=0.28,
                head_frac=0.80, recess_depth=0.22, shutter_mat=None, has_mullions=False,
            )

    # Vertical framing brick pilasters bounding center band on front facade
    z_top = z_g + 3 * floor_h
    for px_f in (p_fl.lerp(p_fr, 0.28).x, p_fl.lerp(p_fr, 0.56).x):
        bm_add_box(bm, (px_f, -hy - 0.06, (z_g + z_top) * 0.5), (0.30, 0.16, z_top - z_g), mats["ivory"])

    # === 3. ROOFTOP PARAPET, PERGOLA TERRACE, STAIR PENTHOUSE & SOLAR PANELS ===
    bm_add_box(bm, (0.0, 0.0, z_top + 0.06), (w + 0.10, d + 0.10, 0.12), mats["gravel"])
    par_h = 0.86
    bm_add_box(bm, (0.0, -hy + 0.15, z_top + par_h * 0.5), (w + 0.16, 0.30, par_h), mats["brick"])
    bm_add_box(bm, (0.0, hy - 0.15, z_top + par_h * 0.5), (w + 0.16, 0.30, par_h), mats["brick"])
    bm_add_box(bm, (-hx + 0.15, 0.0, z_top + par_h * 0.5), (0.30, d - 0.20, par_h), mats["brick"])
    bm_add_box(bm, (hx - 0.15, 0.0, z_top + par_h * 0.5), (0.30, d - 0.20, par_h), mats["brick"])
    # Ivory concrete coping on roof parapet
    bm_add_box(bm, (0.0, -hy + 0.15, z_top + par_h + 0.05), (w + 0.24, 0.38, 0.10), mats["ivory"])
    bm_add_box(bm, (0.0, hy - 0.15, z_top + par_h + 0.05), (w + 0.24, 0.38, 0.10), mats["ivory"])
    bm_add_box(bm, (-hx + 0.15, 0.0, z_top + par_h + 0.05), (0.38, d - 0.12, 0.10), mats["ivory"])
    bm_add_box(bm, (hx - 0.15, 0.0, z_top + par_h + 0.05), (0.38, d - 0.12, 0.10), mats["ivory"])

    # Stair & elevator penthouse box on right rear
    ph_x, ph_y = 3.2, 1.4
    bm_add_box(bm, (ph_x, ph_y, z_top + 1.15), (4.2, 3.6, 2.3), mats["sand"])
    bm_add_box(bm, (ph_x, ph_y, z_top + 2.35), (4.4, 3.8, 0.16), mats["ivory"])
    bm_add_box(bm, (ph_x - 2.12, ph_y, z_top + 1.0), (0.06, 1.0, 2.0), mats["dark"])

    # Rooftop Pergola Structure on left half + Solar collector array
    perg_cx, perg_cy = -2.8, -0.6
    for sx in (-1, 1):
        for sy in (-1, 1):
            bm_add_box(bm, (perg_cx + sx * 1.9, perg_cy + sy * 1.6, z_top + 1.15), (0.14, 0.14, 2.2), mats["iron"])
    for sy in (-1, 1):
        bm_add_box(bm, (perg_cx, perg_cy + sy * 1.6, z_top + 2.28), (4.2, 0.14, 0.14), mats["iron"])
    n_beams = 6 if detail_lod0 else 3
    for i in range(n_beams):
        bx = perg_cx - 1.7 + (i / max(1, n_beams - 1)) * 3.4
        bm_add_box(bm, (bx, perg_cy, z_top + 2.38), (0.10, 3.5, 0.10), mats["wood"])

    for sx_i in (-1, 1):
        bm_add_box(bm, (-2.6 + sx_i * 1.5, 2.8, z_top + 0.56), (2.2, 1.3, 0.08), mats["solar"], (-0.42, 0.0, 0.0))
    if detail_lod0:
        bm_add_cylinder(bm, (ph_x + 1.1, ph_y, z_top + 2.85), 0.16, 0.16, 0.90, 8, mats["steel"])
        bm_add_cylinder(bm, (ph_x + 1.7, ph_y + 1.2, z_top + 3.45), 0.03, 0.02, 2.1, 6, mats["steel"])

    bevel_w = 0.020 if detail_lod0 else 0.0
    name = "BloqueCuatroPlantas_LOD0" if detail_lod0 else "BloqueCuatroPlantas_LOD1"
    return create_mesh_object(name, bm, mat_list, col, bevel_width=bevel_w, bevel_segments=1, location=location)
