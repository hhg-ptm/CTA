"""Hero Building 3: Chalet Unifamiliar con Jardín y Tejado Inclinado (Stylized Low Poly Blender model)."""

from __future__ import annotations

import math
import bmesh
import bpy
from mathutils import Vector

from arch_helpers import (
    add_curved_striped_awning,
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


def _add_flower_box(bm: bmesh.types.BMesh, center: tuple[float, float, float], mats: dict[str, int], width: float = 1.25) -> None:
    x, y, z = center
    bm_add_box(bm, (x, y, z), (width, 0.24, 0.20), mats["wood_cedar"])
    bm_add_box(bm, (x, y, z + 0.14), (width - 0.10, 0.18, 0.12), mats["foliage_bright"])
    for k, dx in enumerate((-0.38, -0.12, 0.14, 0.38)):
        fmat = mats["flower_pink"] if k % 2 == 0 else mats["flower_gold"]
        bm_add_box(bm, (x + dx * (width / 1.2), y - 0.02, z + 0.23), (0.12, 0.12, 0.10), fmat, (0.2, 0.3, k * 0.6))


def build_hero_chalet(
    materials: dict[str, bpy.types.Material],
    collection_name: str = "Hero_Chalet",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    lod: int = 0,
    include_garden: bool = True,
) -> bpy.types.Object:
    """Model Hero 3: Cozy Stylized Low Poly 2-story peach-stucco cottage with stone foundation,
    covered timber porch with steps & handrail, projecting front gable wing, attached garage,
    curved scalloped blue-and-cream awnings, tall exterior stone chimney, standing-seam plum roof,
    picket garden fence, stepping stones, and low-poly trees/shrubs.
    """
    detail_lod0 = lod == 0
    col = create_collection(collection_name)
    mat_list = [
        materials["wall_chalet_peach"],   # 0
        materials["wall_plinth_granite"], # 1
        materials["trim_ivory"],          # 2
        materials["wood_cedar"],          # 3
        materials["wood_olive"],          # 4
        materials["wood_cream"],          # 5
        materials["metal_iron"],          # 6
        materials["roof_plum_slate"],     # 7
        materials["roof_plum_rib"],       # 8
        materials["glass_sky"],           # 9
        materials["awning_blue"],         # 10
        materials["awning_cream"],        # 11
        materials["lamp_glow"],           # 12
        materials["grass_lawn"],          # 13
        materials["foliage_bright"],      # 14
        materials["foliage_deep"],        # 15
        materials["bark"],                # 16
        materials["flower_pink"],         # 17
        materials["flower_gold"],         # 18
        materials["curb_granite"],        # 19
    ]
    mats = {
        "peach": 0, "stone": 1, "ivory": 2, "wood_cedar": 3, "wood_olive": 4, "wood_cream": 5,
        "iron": 6, "roof": 7, "rib": 8, "glass": 9, "awning_blue": 10, "awning_cream": 11,
        "lamp": 12, "grass": 13, "foliage_bright": 14, "foliage_deep": 15, "bark": 16,
        "flower_pink": 17, "flower_gold": 18, "curb": 19,
    }

    bm = bmesh.new()

    # Main 2-story house body positioned at cx=-1.4, cy=0.6 (w=8.6m x d=7.0m)
    cx, cy = -1.35, 0.65
    w, d = 8.6, 7.0
    hx, hy = w * 0.5, d * 0.5
    plinth_h = 0.45
    z1 = plinth_h + 2.95
    z2 = z1 + 2.75

    # River-stone foundation plinth + hill-safe subplinth skirt
    add_subplinth_foundation(bm, (cx, cy), w + 0.16, d + 0.16, mats["stone"])
    bm_add_box(bm, (cx, cy, plinth_h * 0.5), (w + 0.16, d + 0.16, plinth_h), mats["stone"])

    # Main House Ground Floor (plinth_h .. z1)
    p_fl, p_fr = Vector((cx - hx, cy - hy)), Vector((cx + hx, cy - hy))
    p_br, p_bl = Vector((cx + hx, cy + hy)), Vector((cx - hx, cy + hy))

    # Front (-Y): Left Bay = front door + right bay = living room picture window
    for i in range(2):
        sa, sb = p_fl.lerp(p_fr, i / 2), p_fl.lerp(p_fr, (i + 1) / 2)
        if i == 0:
            # Cozy front door tucked behind covered porch
            add_wall_panel_with_recessed_window(
                bm, sa, sb, Vector((0, -1)), plinth_h, z1,
                mats["peach"], mats["ivory"], mats["wood_olive"], mats["wood_cream"], mats["ivory"],
                win_width_frac=0.38, sill_frac=0.0, head_frac=0.78, recess_depth=0.22,
                has_mullions=False, has_architrave=True, sill_depth=0.04,
            )
            mid = (sa + sb) * 0.5
            if detail_lod0:
                bm_add_box(bm, (mid.x, cy - hy + 0.16, plinth_h + 1.65), (0.65, 0.04, 0.55), mats["glass"])
                bm_add_box(bm, (mid.x + 0.45, cy - hy - 0.12, plinth_h + 1.15), (0.06, 0.08, 0.16), mats["flower_gold"])
                bm_add_box(bm, (mid.x - 0.95, cy - hy - 0.12, plinth_h + 1.85), (0.16, 0.18, 0.24), mats["lamp"])
        else:
            add_wall_panel_with_recessed_window(
                bm, sa, sb, Vector((0, -1)), plinth_h, z1,
                mats["peach"], mats["ivory"], mats["glass"], mats["wood_cream"], mats["ivory"],
                win_width_frac=0.58, sill_frac=0.26, head_frac=0.82, recess_depth=0.20,
                has_mullions=detail_lod0, has_architrave=True,
            )
            mid = (sa + sb) * 0.5
            if detail_lod0:
                _add_flower_box(bm, (mid.x, cy - hy - 0.14, plinth_h + 0.64), mats, width=1.85)
                add_curved_striped_awning(
                    bm, Vector((mid.x, cy - hy)), Vector((0, -1)), Vector((1, 0)),
                    z1 - 0.36, 2.55, 0.72, 0.42, mats["awning_blue"], mats["awning_cream"], mats["iron"], stripes=7,
                )

    # Upper floor (z1 .. z2): Front (-Y) 2 bays with scalloped curved blue/cream awnings!
    for i in range(2):
        sa, sb = p_fl.lerp(p_fr, i / 2), p_fl.lerp(p_fr, (i + 1) / 2)
        add_wall_panel_with_recessed_window(
            bm, sa, sb, Vector((0, -1)), z1, z2,
            mats["peach"], mats["ivory"], mats["glass"], mats["wood_cream"], mats["ivory"],
            win_width_frac=0.46, sill_frac=0.22, head_frac=0.82, recess_depth=0.20,
            has_mullions=detail_lod0, has_architrave=True,
        )
        mid = (sa + sb) * 0.5
        if detail_lod0:
            add_curved_striped_awning(
                bm, Vector((mid.x, cy - hy)), Vector((0, -1)), Vector((1, 0)),
                z2 - 0.50, 2.15, 0.65, 0.36, mats["awning_blue"], mats["awning_cream"], mats["iron"], stripes=7,
            )

    # Side & Back walls with cozy upper/lower windows
    for f0, f1 in ((plinth_h, z1), (z1, z2)):
        for i in range(2):
            add_wall_panel_with_recessed_window(
                bm, p_br.lerp(p_bl, i / 2), p_br.lerp(p_bl, (i + 1) / 2), Vector((0, 1)), f0, f1,
                mats["peach"], mats["ivory"], mats["glass"], mats["wood_cream"], mats["ivory"],
                win_width_frac=0.44, sill_frac=0.26, head_frac=0.82, recess_depth=0.18,
                has_mullions=detail_lod0,
            )
        add_wall_panel_with_recessed_window(
            bm, p_bl, p_fl, Vector((-1, 0)), f0, f1,
            mats["peach"], mats["ivory"], mats["glass"], mats["wood_cream"], mats["ivory"],
            win_width_frac=0.26, sill_frac=0.28, head_frac=0.80, recess_depth=0.18,
            has_mullions=detail_lod0,
        )
        if f0 >= z1:
            add_wall_panel_with_recessed_window(
                bm, p_fr, p_br, Vector((1, 0)), f0, f1,
                mats["peach"], mats["ivory"], mats["glass"], mats["wood_cream"], mats["ivory"],
                win_width_frac=0.34, sill_frac=0.28, head_frac=0.80, recess_depth=0.18,
                has_mullions=detail_lod0,
            )
        else:
            add_solid_wall_panel(bm, p_fr, p_br, Vector((1, 0)), f0, f1, mats["peach"])

    # Main House Pitched Standing-Seam Plum Roof (reference ad2d3437 signature roof!)
    add_pitched_roof_with_ribs(
        bm, Vector((cx, cy)), w, d, z2, 2.15, 0.55,
        roof_mat=mats["roof"], rib_mat=mats["rib"], trim_mat=mats["ivory"], wall_mat=mats["peach"],
        ridge_along_x=True, rib_spacing=0.68, detailed_ribs=detail_lod0,
    )

    # Projecting Front Cross-Gable Wing (+X side of front facade, creating rich L-roof silhouette!)
    gw, gd = 4.1, 1.5
    gcx = cx + hx - gw * 0.5 - 0.1
    gcy = cy - hy - gd * 0.5 + 0.1
    bm_add_box(bm, (gcx, gcy, plinth_h * 0.5), (gw + 0.14, gd + 0.14, plinth_h), mats["stone"])
    bm_add_box(bm, (gcx, gcy, (plinth_h + z2) * 0.5), (gw, gd, z2 - plinth_h), mats["peach"])
    add_pitched_roof_with_ribs(
        bm, Vector((gcx, gcy + 0.35)), gw, gd + 0.70, z2, 1.85, 0.45,
        roof_mat=mats["roof"], rib_mat=mats["rib"], trim_mat=mats["ivory"], wall_mat=mats["peach"],
        ridge_along_x=False, rib_spacing=0.60, detailed_ribs=detail_lod0,
    )
    if detail_lod0:
        # Gable upper window with cross mullions + louvered attic gable vent
        bm_add_box(bm, (gcx, gcy - gd * 0.5 - 0.04, z1 + 1.25), (1.38, 0.16, 1.48), mats["ivory"])
        bm_add_box(bm, (gcx, gcy - gd * 0.5 - 0.08, z1 + 1.25), (1.14, 0.12, 1.24), mats["glass"])
        bm_add_box(bm, (gcx, gcy - gd * 0.5 - 0.12, z1 + 1.25), (0.05, 0.06, 1.24), mats["wood_cream"])
        bm_add_box(bm, (gcx, gcy - gd * 0.5 - 0.12, z1 + 1.25), (1.14, 0.06, 0.05), mats["wood_cream"])
        bm_add_box(bm, (gcx, gcy - gd * 0.5 - 0.02, z2 + 0.72), (0.72, 0.12, 0.48), mats["ivory"])
        bm_add_box(bm, (gcx, gcy - gd * 0.5 - 0.07, z2 + 0.72), (0.52, 0.06, 0.30), mats["wood_cedar"])
        # Big front living-room bay window with cross mullions + sill + flowerbox
        bm_add_box(bm, (gcx, gcy - gd * 0.5 - 0.05, plinth_h + 1.42), (1.78, 0.14, 1.50), mats["ivory"])
        bm_add_box(bm, (gcx, gcy - gd * 0.5 - 0.09, plinth_h + 1.42), (1.52, 0.10, 1.24), mats["glass"])
        bm_add_box(bm, (gcx, gcy - gd * 0.5 - 0.13, plinth_h + 1.42), (0.06, 0.06, 1.24), mats["wood_cream"])
        bm_add_box(bm, (gcx, gcy - gd * 0.5 - 0.13, plinth_h + 1.52), (1.52, 0.06, 0.05), mats["wood_cream"])
        _add_flower_box(bm, (gcx, gcy - gd * 0.5 - 0.22, plinth_h + 0.56), mats, width=1.65)
        add_curved_striped_awning(
            bm, Vector((gcx, gcy - gd * 0.5)), Vector((0, -1)), Vector((1, 0)),
            z1 - 0.38, 2.05, 0.65, 0.36, mats["awning_blue"], mats["awning_cream"], mats["iron"], stripes=7,
        )

    # Welcoming Covered Timber Front Porch Deck on Left Half + Concrete Steps & Iron Handrails
    px_c = cx - hx * 0.48
    pw, pd = 4.2, 2.2
    py_c = cy - hy - pd * 0.5
    bm_add_box(bm, (px_c, py_c, plinth_h * 0.5), (pw, pd, plinth_h), mats["stone"])
    bm_add_box(bm, (px_c, py_c, plinth_h + 0.04), (pw + 0.10, pd + 0.10, 0.08), mats["wood_cedar"])
    # Steps leading down to garden path + dark iron rails
    for st in range(3):
        sy = cy - hy - pd - 0.20 - st * 0.34
        sz = plinth_h * (1.0 - (st + 0.5) / 3.0)
        bm_add_box(bm, (px_c - 0.4, sy, sz * 0.5), (1.85, 0.36, sz), mats["ivory"])
    for side in (-1, 1):
        bm_add_box(bm, (px_c - 0.4 + side * 0.88, cy - hy - pd - 0.52, plinth_h * 0.5 + 0.52), (0.05, 1.15, 0.05), mats["iron"], (math.radians(-22), 0, 0))
    # Chunky cedar porch columns on stone pedestals supporting porch gable awning roof
    for col_x in (px_c - pw * 0.45, px_c + pw * 0.45):
        bm_add_box(bm, (col_x, cy - hy - pd + 0.22, plinth_h + 0.45), (0.34, 0.34, 0.90), mats["stone"])
        bm_add_box(bm, (col_x, cy - hy - pd + 0.22, plinth_h + 1.65), (0.18, 0.18, 1.65), mats["wood_cedar"])
    bm_add_box(bm, (px_c, py_c, z1 - 0.22), (pw + 0.45, pd + 0.50, 0.16), mats["roof"], (math.radians(-14), 0, 0))
    bm_add_box(bm, (px_c, cy - hy - pd - 0.16, z1 - 0.44), (pw + 0.48, 0.10, 0.16), mats["ivory"])

    # Tall Stepped Exterior Stone Chimney climbing Left (-X) gable wall above roof crest
    ch_x = cx - hx - 0.28
    ch_y = cy + 0.1
    bm_add_box(bm, (ch_x, ch_y, 1.6), (0.95, 1.25, 3.2), mats["stone"])
    bm_add_box(bm, (ch_x + 0.10, ch_y, 4.9), (0.76, 0.95, 3.8), mats["stone"])
    bm_add_box(bm, (ch_x + 0.12, ch_y, 7.6), (0.68, 0.82, 2.2), mats["stone"])
    bm_add_box(bm, (ch_x + 0.12, ch_y, 8.75), (0.86, 0.98, 0.16), mats["ivory"])
    bm_add_cylinder(bm, (ch_x + 0.12, ch_y, 9.02), 0.16, 0.14, 0.42, 8, mats["roof"])

    # Attached 1-Story Garage Annex Wing on Right (+X) with segmented garage door + pitched roof
    gar_w, gar_d, gar_h = 4.5, 5.6, 3.35
    gar_cx = cx + hx + gar_w * 0.5 - 0.15
    gar_cy = cy + 0.35
    bm_add_box(bm, (gar_cx, gar_cy, plinth_h * 0.5), (gar_w + 0.12, gar_d + 0.12, plinth_h), mats["stone"])
    bm_add_box(bm, (gar_cx, gar_cy, plinth_h + (gar_h - plinth_h) * 0.5), (gar_w, gar_d, gar_h - plinth_h), mats["peach"])
    # Recessed paneled garage door facing front (-Y)
    gd_y = gar_cy - gar_d * 0.5
    bm_add_box(bm, (gar_cx, gd_y - 0.04, plinth_h + 1.25), (3.15, 0.12, 2.48), mats["ivory"])
    bm_add_box(bm, (gar_cx, gd_y - 0.06, plinth_h + 1.20), (2.88, 0.08, 2.34), mats["wood_cream"])
    if detail_lod0:
        for band_z in (0.6, 1.2, 1.8):
            bm_add_box(bm, (gar_cx, gd_y - 0.11, plinth_h + band_z), (2.72, 0.04, 0.06), mats["wood_cedar"])
    add_pitched_roof_with_ribs(
        bm, Vector((gar_cx, gar_cy)), gar_w, gar_d, gar_h, 1.45, 0.42,
        roof_mat=mats["roof"], rib_mat=mats["rib"], trim_mat=mats["ivory"], wall_mat=mats["peach"],
        ridge_along_x=False, rib_spacing=0.62, detailed_ribs=detail_lod0,
    )

    # --- Enclosed Garden Lawn, Stone Walkway, Driveway & Stylized Low-Poly Picket Fence + Trees ---
    if include_garden:
        lot_w, lot_d = 15.8, 12.6
        lot_cx, lot_cy = 0.25, -0.35
        bm_add_box(bm, (lot_cx, lot_cy, 0.04), (lot_w, lot_d, 0.08), mats["grass"])
        # Concrete driveway apron in front of garage
        bm_add_box(bm, (gar_cx, -lot_d * 0.5 + 1.65, 0.06), (3.35, 3.85, 0.09), mats["curb"])
        # Stone garden stepping path ending cleanly at gate piers
        for k in range(3):
            bm_add_box(bm, (px_c - 0.38 + (k % 2 - 0.5) * 0.08, cy - hy - pd - 0.95 - k * 0.68, 0.07), (1.15, 0.48, 0.08), mats["ivory"])

        # White picket perimeter garden fence with stone pillars (leaving open driveway + front gate gap)
        fx0, fx1 = lot_cx - lot_w * 0.5 + 0.15, lot_cx + lot_w * 0.5 - 0.15
        fy0, fy1 = lot_cy - lot_d * 0.5 + 0.15, lot_cy + lot_d * 0.5 - 0.15
        # Front fence segments (skipped across front path & driveway)
        segments = [
            ((fx0, fy0), (px_c - 1.45, fy0)),
            ((px_c + 0.75, fy0), (gar_cx - 1.85, fy0)),
            ((fx0, fy0), (fx0, fy1)),
            ((fx0, fy1), (fx1, fy1)),
            ((fx1, fy1), (fx1, fy0)),
        ]
        for (ax, ay), (bx, by) in segments:
            seg_len = math.hypot(bx - ax, by - ay)
            if seg_len < 0.4:
                continue
            mid_x, mid_y = (ax + bx) * 0.5, (ay + by) * 0.5
            ang = math.atan2(by - ay, bx - ax)
            bm_add_box(bm, (mid_x, mid_y, 0.25), (seg_len, 0.12, 0.36), mats["stone"], (0, 0, ang))
            if detail_lod0:
                n_pickets = max(3, int(seg_len / 0.34))
                for pk in range(n_pickets + 1):
                    t = pk / n_pickets
                    px = ax + (bx - ax) * t
                    py = ay + (by - ay) * t
                    bm_add_box(bm, (px, py, 0.65), (0.14, 0.06, 0.78), mats["wood_cream"], (0, 0, ang))
                bm_add_box(bm, (mid_x, mid_y, 0.85), (seg_len, 0.07, 0.07), mats["wood_cream"], (0, 0, ang))
        # Stone corner gate piers + cute low-poly mailbox by walkway
        for gx in (fx0, px_c - 1.45, px_c + 0.75, gar_cx - 1.85, fx1):
            bm_add_box(bm, (gx, fy0, 0.62), (0.42, 0.42, 1.15), mats["stone"])
            bm_add_box(bm, (gx, fy0, 1.24), (0.50, 0.50, 0.10), mats["ivory"])
        if detail_lod0:
            bm_add_box(bm, (px_c + 1.05, fy0 + 0.45, 0.55), (0.10, 0.10, 1.0), mats["wood_cedar"])
            bm_add_box(bm, (px_c + 1.05, fy0 + 0.45, 1.08), (0.28, 0.44, 0.26), mats["awning_blue"])
            add_stylized_tree(bm, (fx0 + 0.95, fy0 + 2.4, 0.05), mats["bark"], mats["foliage_deep"], kind="pine", scale=1.05)
            add_stylized_tree(bm, (fx0 + 1.3, cy + 1.8, 0.05), mats["bark"], mats["foliage_bright"], kind="round", scale=0.95)
            add_stylized_tree(bm, (fx1 - 1.1, fy1 - 1.4, 0.05), mats["bark"], mats["foliage_deep"], kind="pine", scale=1.05)
            add_potted_shrub(bm, (px_c - 1.9, fy0 + 0.55, 0.05), mats["stone"], mats["foliage_bright"], scale=0.68)

    return create_mesh_object(
        f"ChaletJardin_LOD{lod}",
        bm,
        mat_list,
        col,
        bevel_width=0.02 if detail_lod0 else 0.0,
        location=location,
    )
