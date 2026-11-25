"""Hero Building 8: Edificio Público / Equipamiento Singular (Stylized Low Poly Blender model)."""

from __future__ import annotations

import math
import bmesh
import bpy
from mathutils import Vector

from arch_helpers import (
    add_potted_shrub,
    add_solid_wall_panel,
    add_subplinth_foundation,
    add_wall_panel_with_recessed_window,
    bm_add_box,
    bm_add_cylinder,
    create_collection,
    create_mesh_object,
)


def build_hero_civic_equipment(
    materials: dict[str, bpy.types.Material],
    collection_name: str = "Hero_Civic_Equipment",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    lod: int = 0,
) -> bpy.types.Object:
    """Model Hero 8: Monumental Civic / Cultural Public Building (Museum / Courthouse / Town Facility).

    Features wide granite grand entrance staircase with balustrade bollards & globe lamps,
    double-height limestone portico with 4 square columns, recessed golden glass curtain entrance,
    crowning clock pediment + gold municipal emblem & flagpole mast, symmetric two-story flanking
    wings with copper cornices, and central prismatic skylight pyramid on roof.
    """
    detail_lod0 = lod == 0
    col = create_collection(collection_name)
    mat_list = [
        materials["wall_civic_limestone"],   # 0
        materials["wall_casco_stone"],       # 1
        materials["wall_plinth_granite"],    # 2
        materials["trim_dark_concrete"],     # 3
        materials["trim_ivory"],             # 4
        materials["metal_copper"],           # 5
        materials["metal_iron"],             # 6
        materials["metal_steel"],            # 7
        materials["metal_gold_sign"],        # 8
        materials["glass_sky"],              # 9
        materials["glass_warm_shop"],        # 10
        materials["lamp_glow"],              # 11
        materials["roof_gravel"],            # 12
        materials["awning_red"],             # 13
        materials["awning_blue"],            # 14
        materials["foliage_bright"],         # 15
    ]
    mats = {
        "limestone": 0, "stone": 1, "plinth": 2, "dark": 3, "ivory": 4,
        "copper": 5, "iron": 6, "steel": 7, "gold": 8, "glass": 9,
        "warm_glass": 10, "lamp": 11, "gravel": 12, "flag_red": 13,
        "flag_blue": 14, "foliage": 15,
    }

    bm = bmesh.new()

    # Main 2-story flanking footprint: w = 16.0m, d = 10.6m
    # Central projecting civic pavilion: w_c = 7.2m, d_c = 11.4m (steps -0.6m proud at front & back)
    w, d = 16.0, 10.6
    hx, hy = w * 0.5, d * 0.5
    wc, dc = 7.2, 11.4
    hxc, hyc = wc * 0.5, dc * 0.5

    podium_h = 0.90
    wing_z1 = podium_h + 3.85
    wing_z2 = wing_z1 + 3.55
    center_top = wing_z2 + 2.35

    add_subplinth_foundation(bm, (0.0, 0.0), w + 0.24, d + 0.24, mats["plinth"])
    add_subplinth_foundation(bm, (0.0, -hyc + 1.0), wc + 0.4, 3.2, mats["plinth"])

    # Heavy granite podium base under entire building
    bm_add_box(bm, (0.0, 0.0, podium_h * 0.5), (w + 0.24, d + 0.24, podium_h), mats["plinth"])
    bm_add_box(bm, (0.0, 0.0, podium_h + 0.08), (w + 0.32, d + 0.32, 0.16), mats["ivory"])

    # --- Grand Monumental Entrance Staircase (front -Y in front of central portico) ---
    stair_w = 6.2
    stair_top_y = -hyc - 0.55
    # Upper terrace landing under portico columns
    bm_add_box(bm, (0.0, -hy - 0.70, podium_h * 0.5), (wc + 0.40, 2.2, podium_h), mats["plinth"])
    for step_idx in range(4):
        frac = step_idx / 4.0
        sh = podium_h * (1.0 - frac)
        sy = stair_top_y - 0.65 - step_idx * 0.44
        bm_add_box(bm, (0.0, sy, sh * 0.5), (stair_w + step_idx * 0.16, 0.48, sh), mats["ivory"])

    # Stepped granite stair cheek walls + stylized civic globe lampposts
    for sx in (-1, 1):
        cx_w = sx * (stair_w * 0.5 + 0.36)
        bm_add_box(bm, (cx_w, stair_top_y - 1.05, podium_h * 0.68), (0.44, 2.35, podium_h * 1.36), mats["plinth"])
        bm_add_box(bm, (cx_w, stair_top_y - 1.05, podium_h * 1.40), (0.52, 2.42, 0.12), mats["ivory"])
        # Globe lamp on front cheek pier
        bm_add_cylinder(bm, (cx_w, stair_top_y - 1.85, podium_h * 1.46 + 0.30), 0.06, 0.05, 0.60, 8, mats["iron"])
        bm_add_box(bm, (cx_w, stair_top_y - 1.85, podium_h * 1.46 + 0.74), (0.30, 0.30, 0.30), mats["lamp"])
        if detail_lod0:
            add_potted_shrub(bm, (sx * (hxc + 0.95), -hy - 0.45, 0.0), mats["dark"], mats["foliage"], scale=0.88)

    # === 1. FLANKING WINGS (Left & Right 2-story volumes) ===
    p_fl, p_fr = Vector((-hx, -hy)), Vector((hx, -hy))
    p_br, p_bl = Vector((hx, hy)), Vector((-hx, hy))

    for z_bot, z_top, f_idx in ((podium_h, wing_z1, 0), (wing_z1, wing_z2, 1)):
        # Front wing outer bays (Left 0..0.28 and Right 0.72..1.0)
        for u0, u1 in ((0.0, 0.275), (0.725, 1.0)):
            a = p_fl.lerp(p_fr, u0)
            b = p_fl.lerp(p_fr, u1)
            for k in range(2):
                va, vb = a.lerp(b, k * 0.5), a.lerp(b, (k + 1) * 0.5)
                add_wall_panel_with_recessed_window(
                    bm, va, vb, Vector((0.0, -1.0)), z_bot, z_top,
                    wall_mat=mats["limestone"], reveal_mat=mats["stone"],
                    glass_mat=mats["glass"], frame_mat=mats["dark"],
                    sill_mat=mats["ivory"], win_width_frac=0.62, sill_frac=0.18,
                    head_frac=0.82, recess_depth=0.30, shutter_mat=None,
                    has_mullions=detail_lod0, has_architrave=True,
                )
        # Flank sides (+X, -X) & Back
        for sa, sb, sout in ((p_fr, p_br, Vector((1.0, 0.0))), (p_bl, p_fl, Vector((-1.0, 0.0)))):
            for k in range(3):
                va, vb = sa.lerp(sb, k / 3.0), sa.lerp(sb, (k + 1) / 3.0)
                add_wall_panel_with_recessed_window(
                    bm, va, vb, sout, z_bot, z_top,
                    wall_mat=mats["limestone"], reveal_mat=mats["stone"],
                    glass_mat=mats["glass"], frame_mat=mats["dark"],
                    sill_mat=mats["ivory"], win_width_frac=0.58, sill_frac=0.20,
                    head_frac=0.82, recess_depth=0.28, shutter_mat=None,
                    has_mullions=detail_lod0, has_architrave=True,
                )
        for k in range(4):
            va, vb = p_br.lerp(p_bl, k / 4.0), p_br.lerp(p_bl, (k + 1) / 4.0)
            add_wall_panel_with_recessed_window(
                bm, va, vb, Vector((0.0, 1.0)), z_bot, z_top,
                wall_mat=mats["limestone"], reveal_mat=mats["stone"],
                glass_mat=mats["glass"], frame_mat=mats["dark"],
                sill_mat=mats["ivory"], win_width_frac=0.52, sill_frac=0.22,
                head_frac=0.82, recess_depth=0.24, shutter_mat=None, has_mullions=False,
            )

    # Copper fascia trim & rooftop parapet around side wings
    bm_add_box(bm, (0.0, 0.0, wing_z1), (w + 0.24, d + 0.24, 0.16), mats["stone"])
    bm_add_box(bm, (0.0, 0.0, wing_z2 + 0.16), (w + 0.34, d + 0.34, 0.32), mats["copper"])
    bm_add_box(bm, (0.0, 0.0, wing_z2 + 0.36), (w - 0.10, d - 0.10, 0.12), mats["gravel"])

    # === 2. CENTRAL MONUMENTAL PAVILION + DOUBLE-HEIGHT COLUMN PORTICO ===
    # Solid enclosing box slightly recessed at front to create deep classical loggia vestibule
    c_body_d = dc - 1.5
    c_body_cy = 0.65
    bm_add_box(bm, (0.0, c_body_cy, (podium_h + center_top) * 0.5), (wc, c_body_d, center_top - podium_h), mats["limestone"])

    # Recessed tall glazed entrance wall inside front portico
    ent_y = c_body_cy - c_body_d * 0.5 - 0.02
    bm_add_box(bm, (0.0, ent_y, podium_h + 3.55), (wc - 1.2, 0.16, 6.9), mats["dark"])
    bm_add_box(bm, (0.0, ent_y - 0.02, podium_h + 1.55), (3.1, 0.18, 2.95), mats["warm_glass"])
    bm_add_box(bm, (0.0, ent_y - 0.04, podium_h + 5.15), (wc - 1.5, 0.18, 3.65), mats["glass"])
    # Vertical aluminum mullions & bronze door pulls
    for mx in (-1.55, 0.0, 1.55):
        bm_add_box(bm, (mx, ent_y - 0.08, podium_h + 3.55), (0.09, 0.14, 6.8), mats["iron"])
    for sx in (-0.18, 0.18):
        bm_add_box(bm, (sx, ent_y - 0.14, podium_h + 1.35), (0.07, 0.08, 0.65), mats["gold"])

    # 4 Giant Monumental Limestone Portico Columns along front line (-hyc)
    col_y = -hyc + 0.42
    col_h = wing_z2 - podium_h + 0.15
    for cx_p in (-2.95, -1.05, 1.05, 2.95):
        # Plinth base + shaft + capital
        bm_add_box(bm, (cx_p, col_y, podium_h + 0.24), (0.72, 0.72, 0.48), mats["stone"])
        bm_add_cylinder(bm, (cx_p, col_y, podium_h + col_h * 0.5), 0.29, 0.26, col_h - 0.4, 10, mats["ivory"])
        bm_add_box(bm, (cx_p, col_y, podium_h + col_h - 0.18), (0.76, 0.76, 0.36), mats["stone"])

    # Grand Entablature spanning over portico + Flanking Stone Corner Piers
    entab_z = wing_z2 + 0.48
    bm_add_box(bm, (0.0, (col_y + c_body_cy) * 0.5 - 1.5, entab_z), (wc + 0.45, 2.75, 0.85), mats["ivory"])
    bm_add_box(bm, (0.0, col_y - 0.04, entab_z - 0.34), (wc + 0.38, 0.90, 0.24), mats["copper"])

    # === 3. CROWN PEDIMENT, CLOCK FACE, INSTITUTIONAL EMBLEM & FLAGPOLE ===
    ped_z = entab_z + 1.25
    bm_add_box(bm, (0.0, col_y + 0.10, ped_z), (wc - 0.5, 1.35, 1.65), mats["limestone"])
    bm_add_box(bm, (0.0, col_y + 0.10, ped_z + 0.90), (wc - 0.2, 1.50, 0.26), mats["ivory"])
    bm_add_box(bm, (0.0, col_y + 0.10, ped_z + 1.12), (4.2, 1.40, 0.30), mats["copper"])

    # Monumental Facade Clock ("Reloj Municipal") + Gold Crest Frame
    clk_y = col_y - 0.60
    bm_add_cylinder(bm, (0.0, clk_y, ped_z + 0.05), 0.76, 0.76, 0.14, 14, mats["gold"], (math.pi * 0.5, 0.0, 0.0))
    bm_add_cylinder(bm, (0.0, clk_y - 0.05, ped_z + 0.05), 0.64, 0.64, 0.10, 14, mats["ivory"], (math.pi * 0.5, 0.0, 0.0))
    bm_add_box(bm, (0.0, clk_y - 0.12, ped_z + 0.16), (0.06, 0.04, 0.34), mats["iron"])
    bm_add_box(bm, (0.14, clk_y - 0.12, ped_z + 0.05), (0.28, 0.04, 0.06), mats["iron"])

    # Stylized Flagpole + Twin Institutional Banners
    bm_add_cylinder(bm, (0.0, col_y + 0.10, ped_z + 2.75), 0.05, 0.035, 3.2, 8, mats["steel"])
    bm_add_box(bm, (0.62, col_y + 0.10, ped_z + 3.92), (1.16, 0.05, 0.68), mats["flag_red"])
    bm_add_box(bm, (0.62, col_y + 0.10, ped_z + 3.92), (1.16, 0.06, 0.24), mats["gold"])

    # === 4. ROOFTOP SKYLIGHT PYRAMID & TECHNICAL SCREEN ===
    sky_z = center_top
    bm_add_box(bm, (0.0, c_body_cy, sky_z + 0.22), (wc + 0.12, c_body_d + 0.12, 0.44), mats["ivory"])
    bm_add_cylinder(bm, (0.0, c_body_cy + 0.3, sky_z + 0.88), 2.55, 0.18, 1.30, 4, mats["glass"], (0.0, 0.0, math.pi * 0.25))
    if detail_lod0:
        for hx_s in (-5.6, 5.6):
            bm_add_box(bm, (hx_s, 1.8, wing_z2 + 0.72), (2.2, 1.6, 0.72), mats["dark"])
            bm_add_box(bm, (hx_s, 1.8, wing_z2 + 1.10), (2.3, 1.7, 0.10), mats["steel"])

    bevel_w = 0.022 if detail_lod0 else 0.0
    name = "EdificioCivico_LOD0" if detail_lod0 else "EdificioCivico_LOD1"
    return create_mesh_object(name, bm, mat_list, col, bevel_width=bevel_w, bevel_segments=1, location=location)
