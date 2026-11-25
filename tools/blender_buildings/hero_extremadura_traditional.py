"""Hero Building 5: Casa Tradicional Extremeña / Rural (Stylized Low Poly Blender model)."""

from __future__ import annotations

import math
import bmesh
import bpy
from mathutils import Vector

from arch_helpers import (
    add_pitched_roof_with_ribs,
    add_potted_shrub,
    add_solid_wall_panel,
    add_stylized_tree,
    add_subplinth_foundation,
    add_wall_panel_with_recessed_window,
    bm_add_box,
    bm_add_cylinder,
    create_collection,
    create_mesh_object,
)


def build_hero_extremadura_traditional(
    materials: dict[str, bpy.types.Material],
    collection_name: str = "Hero_Extremadura_Traditional",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    lod: int = 0,
    include_corral: bool = True,
) -> bpy.types.Object:
    """Model Hero 5: Authentic rural / vernacular Extremaduran whitewashed courtyard home.

    Features granite plinth, traditional indigo-painted base trim, deep limewashed walls,
    covered portico/soportal with granite pillar & oak timber lintel, iron reja grilles,
    olive wood shutters, geranium flowerpots, broad Extremaduran brick/lime chimney, ribbed
    terracotta tile roof, and walled corral courtyard with wooden gate and stylized olive tree.
    """
    detail_lod0 = lod == 0
    col = create_collection(collection_name)
    mat_list = [
        materials["wall_casco_lime"],        # 0
        materials["wall_plinth_granite"],    # 1
        materials["accent_indigo"],          # 2
        materials["trim_ivory"],             # 3
        materials["trim_stone_warm"],        # 4
        materials["wood_cedar"],             # 5
        materials["wood_olive"],             # 6
        materials["metal_iron"],             # 7
        materials["metal_bronze"],           # 8
        materials["roof_terracotta"],        # 9
        materials["roof_terracotta_ridge"],  # 10
        materials["wall_brick_terracotta"],  # 11
        materials["glass_sky"],              # 12
        materials["lamp_glow"],              # 13
        materials["foliage_bright"],         # 14
        materials["foliage_deep"],           # 15
        materials["flower_pink"],            # 16
        materials["bark"],                   # 17
    ]
    mats = {
        "lime": 0, "plinth": 1, "indigo": 2, "ivory": 3, "stone": 4,
        "wood": 5, "olive": 6, "iron": 7, "bronze": 8, "roof": 9,
        "ridge": 10, "brick": 11, "glass": 12, "lamp": 13,
        "foliage_bright": 14, "foliage_deep": 15, "flower": 16, "bark": 17,
    }

    bm = bmesh.new()

    # Main 2-story rural body: shifted left (-1.55m) when corral wall wing is present
    cx = -1.55 if include_corral else 0.0
    cy = 0.0
    w, d = 7.8, 7.6
    hx, hy = w * 0.5, d * 0.5
    plinth_h = 0.48
    indigo_h = 0.34
    z1 = 3.15
    z2 = 5.95

    add_subplinth_foundation(bm, (cx, cy), w + 0.16, d + 0.16, mats["plinth"])
    # Granite rubble plinth + signature rural Extremadura indigo base band
    bm_add_box(bm, (cx, cy, plinth_h * 0.5), (w + 0.16, d + 0.16, plinth_h), mats["plinth"])
    bm_add_box(bm, (cx, cy, plinth_h + indigo_h * 0.5), (w + 0.08, d + 0.08, indigo_h), mats["indigo"])

    # Corner stone quoins on rural house corners
    for sx in (-1, 1):
        for sy in (-1, 1):
            for k in range(6 if detail_lod0 else 3):
                qz = plinth_h + 0.35 + k * 0.88
                if qz + 0.25 > z2:
                    break
                long_x = k % 2 == 0
                qw = 0.44 if long_x else 0.24
                qd = 0.24 if long_x else 0.44
                bm_add_box(bm, (cx + sx * (hx - qw * 0.36), cy + sy * (hy - qd * 0.36), qz), (qw, qd, 0.34), mats["stone"])

    p_fl, p_fr = Vector((cx - hx, cy - hy)), Vector((cx + hx, cy - hy))
    p_br, p_bl = Vector((cx + hx, cy + hy)), Vector((cx - hx, cy + hy))
    shutter = mats["olive"] if detail_lod0 else None

    # --- Ground Floor (z = plinth_h .. z1) ---
    # Front (-Y): Left rustic doorway (under soportal) + Right grilled Extremadura window
    for i, kind in enumerate(("door", "win")):
        a = p_fl.lerp(p_fr, i * 0.5)
        b = p_fl.lerp(p_fr, (i + 1) * 0.5)
        out = Vector((0.0, -1.0))
        if kind == "door":
            add_wall_panel_with_recessed_window(
                bm, a, b, out, plinth_h, z1,
                wall_mat=mats["lime"], reveal_mat=mats["stone"],
                glass_mat=mats["wood"], frame_mat=mats["iron"],
                sill_mat=mats["stone"], win_width_frac=0.44, sill_frac=0.0,
                head_frac=0.76, recess_depth=0.34, shutter_mat=None,
                has_mullions=False, has_architrave=True, sill_depth=0.0, lintel_depth=0.14,
            )
            mid = (a + b) * 0.5
            # Traditional small wicket window ("postigo"), bronze knocker, threshold step & bench
            bm_add_box(bm, (mid.x, -hy + 0.29, plinth_h + 1.48), (0.36, 0.06, 0.42), mats["iron"])
            bm_add_box(bm, (mid.x + 0.14, -hy + 0.27, plinth_h + 1.05), (0.08, 0.06, 0.10), mats["bronze"])
            bm_add_box(bm, (mid.x, -hy - 0.16, 0.24), (1.9, 0.42, 0.48), mats["plinth"])
            # Rustic granite wall bench beside front entrance
            if detail_lod0:
                bx = mid.x + 1.38
                bm_add_box(bm, (bx, -hy - 0.28, 0.44), (1.05, 0.36, 0.10), mats["stone"])
                for bsx in (-0.38, 0.38):
                    bm_add_box(bm, (bx + bsx, -hy - 0.28, 0.22), (0.18, 0.32, 0.40), mats["plinth"])
        else:
            add_wall_panel_with_recessed_window(
                bm, a, b, out, plinth_h, z1,
                wall_mat=mats["lime"], reveal_mat=mats["stone"],
                glass_mat=mats["glass"], frame_mat=mats["wood"],
                sill_mat=mats["stone"], win_width_frac=0.44, sill_frac=0.28,
                head_frac=0.78, recess_depth=0.26, shutter_mat=shutter,
                has_mullions=True, has_architrave=True, sill_depth=0.14,
            )
            mid = (a + b) * 0.5
            if detail_lod0:
                # Projecting forged iron reja + geranium windowsill box
                ww = (b - a).length * 0.44
                wh = (z1 - plinth_h) * 0.50
                wz = plinth_h + (z1 - plinth_h) * 0.53
                bm_add_box(bm, (mid.x, -hy - 0.18, wz - wh * 0.5), (ww + 0.18, 0.20, 0.04), mats["iron"])
                bm_add_box(bm, (mid.x, -hy - 0.18, wz + wh * 0.5), (ww + 0.18, 0.20, 0.04), mats["iron"])
                for rx in (-0.5, -0.17, 0.17, 0.5):
                    bm_add_box(bm, (mid.x + rx * ww * 0.85, -hy - 0.24, wz), (0.032, 0.032, wh + 0.04), mats["iron"])
                bm_add_box(bm, (mid.x, -hy - 0.12, wz - wh * 0.5 - 0.08), (0.95, 0.20, 0.16), mats["brick"])
                bm_add_box(bm, (mid.x, -hy - 0.12, wz - wh * 0.5 + 0.05), (0.85, 0.14, 0.12), mats["foliage_bright"])
                for fx in (-0.28, 0.0, 0.26):
                    bm_add_box(bm, (mid.x + fx, -hy - 0.14, wz - wh * 0.5 + 0.12), (0.11, 0.11, 0.10), mats["flower"], (0.2, 0.3, fx))

    # --- Covered Traditional Timber Porch (Soportal) across left front bays ---
    porch_w = 3.7
    porch_d = 1.95
    porch_cx = cx - hx + porch_w * 0.5 + 0.08
    porch_front_y = cy - hy - porch_d
    porch_eave_z = 2.75
    porch_peak_z = 3.25
    # Porch stone terrace floor + front steps
    bm_add_box(bm, (porch_cx, cy - hy - porch_d * 0.5, 0.18), (porch_w + 0.12, porch_d + 0.10, 0.36), mats["plinth"])
    bm_add_box(bm, (porch_cx, cy - hy - porch_d - 0.22, 0.09), (2.2, 0.40, 0.18), mats["stone"])
    # Two granite columns with dark oak corbel capitals ("zapatas") + lintel beam
    for px in (porch_cx - porch_w * 0.44, porch_cx + porch_w * 0.44):
        bm_add_box(bm, (px, porch_front_y + 0.18, 0.48), (0.34, 0.34, 0.22), mats["stone"])
        bm_add_cylinder(bm, (px, porch_front_y + 0.18, 1.56), 0.14, 0.12, 2.0, 8, mats["stone"])
        bm_add_box(bm, (px, porch_front_y + 0.18, 2.60), (0.48, 0.26, 0.14), mats["wood"])
    bm_add_box(bm, (porch_cx, porch_front_y + 0.18, 2.74), (porch_w, 0.18, 0.16), mats["wood"])
    # Hanging lantern under soportal beam
    bm_add_box(bm, (porch_cx, porch_front_y + 0.18, 2.48), (0.20, 0.20, 0.24), mats["lamp"])
    bm_add_box(bm, (porch_cx, porch_front_y + 0.18, 2.62), (0.26, 0.26, 0.06), mats["iron"])

    # Lean-to pitched terracotta porch roof
    p_slope_len = math.hypot(porch_d + 0.28, porch_peak_z - porch_eave_z)
    p_slope_ang = math.atan2(porch_peak_z - porch_eave_z, porch_d + 0.28)
    bm_add_box(
        bm,
        (porch_cx, cy - hy - porch_d * 0.48, (porch_eave_z + porch_peak_z) * 0.5),
        (porch_w + 0.24, p_slope_len, 0.14),
        mats["roof"],
        (p_slope_ang, 0.0, 0.0),
    )
    n_pribs = 6 if detail_lod0 else 3
    for i in range(n_pribs + 1):
        rx = porch_cx - porch_w * 0.5 + (i / n_pribs) * porch_w
        bm_add_box(
            bm,
            (rx, cy - hy - porch_d * 0.48, (porch_eave_z + porch_peak_z) * 0.5 + 0.08),
            (0.09, p_slope_len, 0.06),
            mats["ridge"],
            (p_slope_ang, 0.0, 0.0),
        )

    # Side & Back Ground Walls
    add_wall_panel_with_recessed_window(
        bm, p_bl, p_fl, Vector((-1.0, 0.0)), plinth_h, z1,
        wall_mat=mats["lime"], reveal_mat=mats["stone"], glass_mat=mats["glass"],
        frame_mat=mats["wood"], sill_mat=mats["stone"],
        win_width_frac=0.28, sill_frac=0.34, head_frac=0.76, recess_depth=0.24,
        shutter_mat=shutter, has_mullions=detail_lod0,
    )
    add_wall_panel_with_recessed_window(
        bm, p_fr, p_br, Vector((1.0, 0.0)), plinth_h, z1,
        wall_mat=mats["lime"], reveal_mat=mats["stone"], glass_mat=mats["glass"],
        frame_mat=mats["wood"], sill_mat=mats["stone"],
        win_width_frac=0.26, sill_frac=0.38, head_frac=0.76, recess_depth=0.22,
        shutter_mat=None, has_mullions=detail_lod0,
    )
    add_solid_wall_panel(bm, p_br, p_bl, Vector((0.0, 1.0)), plinth_h, z1, mats["lime"])

    # --- Upper Story (z1 .. z2) ---
    for i in range(2):
        a = p_fl.lerp(p_fr, i * 0.5)
        b = p_fl.lerp(p_fr, (i + 1) * 0.5)
        add_wall_panel_with_recessed_window(
            bm, a, b, Vector((0.0, -1.0)), z1, z2,
            wall_mat=mats["lime"], reveal_mat=mats["stone"], glass_mat=mats["glass"],
            frame_mat=mats["wood"], sill_mat=mats["stone"],
            win_width_frac=0.40, sill_frac=0.20, head_frac=0.80, recess_depth=0.26,
            shutter_mat=shutter, has_mullions=detail_lod0, has_architrave=True,
        )
    add_wall_panel_with_recessed_window(
        bm, p_bl, p_fl, Vector((-1.0, 0.0)), z1, z2,
        wall_mat=mats["lime"], reveal_mat=mats["stone"], glass_mat=mats["glass"],
        frame_mat=mats["wood"], sill_mat=mats["stone"],
        win_width_frac=0.24, sill_frac=0.22, head_frac=0.78, recess_depth=0.22,
        shutter_mat=shutter, has_mullions=False,
    )
    add_wall_panel_with_recessed_window(
        bm, p_fr, p_br, Vector((1.0, 0.0)), z1, z2,
        wall_mat=mats["lime"], reveal_mat=mats["stone"], glass_mat=mats["glass"],
        frame_mat=mats["wood"], sill_mat=mats["stone"],
        win_width_frac=0.24, sill_frac=0.24, head_frac=0.76, recess_depth=0.22,
        shutter_mat=None, has_mullions=False,
    )
    add_solid_wall_panel(bm, p_br, p_bl, Vector((0.0, 1.0)), z1, z2, mats["lime"])

    # Timber eaves rafters under terracotta roof + front string cornice
    bm_add_box(bm, (cx, cy, z2 - 0.05), (w + 0.14, d + 0.14, 0.14), mats["stone"])
    if detail_lod0:
        for i in range(9):
            rx = cx - hx + 0.45 + (i / 8.0) * (w - 0.90)
            bm_add_box(bm, (rx, cy - hy - 0.22, z2 - 0.12), (0.09, 0.42, 0.09), mats["wood"])

    # --- Pitched Terracotta Roof + Broad Traditional Extremadura Chimney ---
    add_pitched_roof_with_ribs(
        bm, Vector((cx, cy)), w, d, z2, peak_h=2.25,
        overhang=0.46, roof_mat=mats["roof"], rib_mat=mats["ridge"],
        trim_mat=mats["wood"], wall_mat=mats["lime"],
        eave_thickness=0.14, rib_spacing=0.68,
        ridge_along_x=True, detailed_ribs=detail_lod0,
    )
    # Traditional wide Extremadura hearth chimney + brick cap
    ch_x, ch_y = cx + 2.1, cy + 1.0
    bm_add_box(bm, (ch_x, ch_y, z2 + 1.90), (0.95, 0.85, 2.2), mats["lime"])
    bm_add_box(bm, (ch_x, ch_y, z2 + 2.88), (1.12, 1.02, 0.24), mats["brick"])
    bm_add_box(bm, (ch_x, ch_y, z2 + 3.12), (1.05, 0.95, 0.12), mats["ridge"])

    # --- Traditional Walled Corral Courtyard Wing (Right +X side) ---
    if include_corral:
        corral_w = 3.55
        corral_d = 6.2
        c_x0 = cx + hx
        c_x1 = c_x0 + corral_w
        c_y0 = cy - corral_d * 0.5 + 0.4
        c_y1 = c_y0 + corral_d
        wall_h = 2.65
        cap_h = 0.20

        add_subplinth_foundation(bm, ((c_x0 + c_x1) * 0.5, (c_y0 + c_y1) * 0.5), corral_w, corral_d, mats["plinth"])
        # Corral dirt/stone ground slab inside tapia
        bm_add_box(bm, ((c_x0 + c_x1) * 0.5, (c_y0 + c_y1) * 0.5, 0.10), (corral_w, corral_d, 0.20), mats["stone"])

        # Right outer wall, back wall & front wall with arched wooden carriage/corral gate
        bm_add_box(bm, (c_x1 - 0.18, (c_y0 + c_y1) * 0.5, wall_h * 0.5), (0.36, corral_d, wall_h), mats["lime"])
        bm_add_box(bm, (c_x1 - 0.18, (c_y0 + c_y1) * 0.5, 0.24), (0.40, corral_d + 0.04, 0.48), mats["plinth"])
        bm_add_box(bm, (c_x1 - 0.18, (c_y0 + c_y1) * 0.5, wall_h + cap_h * 0.5), (0.48, corral_d + 0.16, cap_h), mats["roof"])

        bm_add_box(bm, ((c_x0 + c_x1) * 0.5, c_y1 - 0.18, wall_h * 0.5), (corral_w, 0.36, wall_h), mats["lime"])
        bm_add_box(bm, ((c_x0 + c_x1) * 0.5, c_y1 - 0.18, 0.24), (corral_w, 0.40, 0.48), mats["plinth"])
        bm_add_box(bm, ((c_x0 + c_x1) * 0.5, c_y1 - 0.18, wall_h + cap_h * 0.5), (corral_w + 0.12, 0.48, cap_h), mats["roof"])

        # Front corral wall with recessed timber double corral doors ("portón")
        gate_cx = (c_x0 + c_x1) * 0.5 - 0.08
        for side, pw in ((-1, 0.80), (1, 0.85)):
            px = gate_cx + side * 1.18
            bm_add_box(bm, (px, c_y0 + 0.18, wall_h * 0.5), (pw, 0.36, wall_h), mats["lime"])
            bm_add_box(bm, (px, c_y0 + 0.18, 0.24), (pw + 0.04, 0.40, 0.48), mats["plinth"])
        # Gate lintel tile canopy + timber double gate
        bm_add_box(bm, ((c_x0 + c_x1) * 0.5, c_y0 + 0.18, wall_h + cap_h * 0.5), (corral_w + 0.12, 0.54, cap_h + 0.06), mats["roof"])
        bm_add_box(bm, (gate_cx, c_y0 + 0.18, 2.38), (1.76, 0.38, 0.54), mats["lime"])
        bm_add_box(bm, (gate_cx, c_y0 + 0.24, 1.06), (1.56, 0.16, 2.12), mats["wood"])
        bm_add_box(bm, (gate_cx, c_y0 + 0.14, 1.06), (0.06, 0.12, 2.08), mats["iron"])

        # Olive tree rising naturally behind corral wall
        add_stylized_tree(bm, (gate_cx + 0.25, c_y0 + 3.2, 0.20), mats["bark"], mats["foliage_deep"], kind="round", scale=0.88)

    if detail_lod0:
        add_potted_shrub(bm, (cx - hx - 0.38, cy - hy + 0.65, 0.0), mats["brick"], mats["foliage_bright"], scale=0.72)

    bevel_w = 0.022 if detail_lod0 else 0.0
    name = "CasaExtrema_LOD0" if detail_lod0 else "CasaExtrema_LOD1"
    return create_mesh_object(name, bm, mat_list, col, bevel_width=bevel_w, bevel_segments=1, location=location)
