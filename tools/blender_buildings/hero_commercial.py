"""Hero Building 4: Edificio Comercial con Escaparates y Terraza (Stylized Low Poly Blender model)."""

from __future__ import annotations

import math
import bmesh
import bpy
from mathutils import Vector

from arch_helpers import (
    add_curved_striped_awning,
    add_potted_shrub,
    add_solid_wall_panel,
    add_subplinth_foundation,
    add_wall_panel_with_recessed_window,
    bm_add_box,
    bm_add_cylinder,
    create_collection,
    create_mesh_object,
)


def _add_cafe_terrace_set(bm: bmesh.types.BMesh, center: tuple[float, float, float], mats: dict[str, int], parasol: bool = True) -> None:
    """Create stylized sidewalk bistro table, 2 chairs, and market umbrella."""
    x, y, z = center
    # Table pedestal & round wood tabletop
    bm_add_cylinder(bm, (x, y, z + 0.37), 0.18, 0.05, 0.74, 8, mats["iron"])
    bm_add_cylinder(bm, (x, y, z + 0.76), 0.44, 0.44, 0.05, 10, mats["wood"])
    for side in (-1, 1):
        cx = x + side * 0.62
        bm_add_box(bm, (cx, y, z + 0.44), (0.36, 0.36, 0.06), mats["wood"])
        bm_add_box(bm, (cx, y, z + 0.22), (0.32, 0.32, 0.42), mats["iron"])
        bm_add_box(bm, (cx + side * 0.16, y, z + 0.68), (0.05, 0.36, 0.44), mats["iron"])
    if parasol:
        bm_add_cylinder(bm, (x, y, z + 1.45), 0.035, 0.035, 1.45, 6, mats["wood"])
        bm_add_cylinder(bm, (x, y, z + 2.28), 1.05, 0.10, 0.46, 8, mats["awning_red"])


def build_hero_commercial(
    materials: dict[str, bpy.types.Material],
    collection_name: str = "Hero_Commercial",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    lod: int = 0,
) -> bpy.types.Object:
    """Model Hero 4: 3-story European commercial corner/street building inspired by reference f3b4b01b ('CAFE').
    Features dark-tiled shopfront podium, double illuminated recessed showcase bays with interior counters,
    scalloped red-and-cream + blue-and-cream striped awnings, topiary flanked center entrance, sidewalk terrace,
    exterior wall-mounted AC + galvanized duct stack, sage/cream masonry pilasters, and stepped crown parapet.
    """
    detail_lod0 = lod == 0
    col = create_collection(collection_name)
    mat_list = [
        materials["wall_shop_cream"],     # 0
        materials["wall_shop_sage"],      # 1
        materials["trim_dark_concrete"],  # 2
        materials["trim_ivory"],          # 3
        materials["wood_cedar"],          # 4
        materials["metal_iron"],          # 5
        materials["metal_steel"],         # 6
        materials["metal_gold_sign"],     # 7
        materials["glass_sky"],           # 8
        materials["glass_warm_shop"],     # 9
        materials["awning_red"],          # 10
        materials["awning_blue"],         # 11
        materials["awning_cream"],        # 12
        materials["roof_gravel"],         # 13
        materials["foliage_bright"],      # 14
        materials["lamp_glow"],           # 15
    ]
    mats = {
        "cream": 0, "sage": 1, "dark": 2, "ivory": 3, "wood": 4, "iron": 5, "steel": 6,
        "gold": 7, "glass": 8, "warm_glass": 9, "awning_red": 10, "awning_blue": 11,
        "awning_cream": 12, "gravel": 13, "foliage": 14, "lamp": 15,
    }

    bm = bmesh.new()
    w, d = 12.8, 9.2
    hx, hy = w * 0.5, d * 0.5
    plinth_h = 0.28
    g_h = 3.95
    u1_h = 3.20
    u2_h = 3.05
    z1 = plinth_h + g_h
    z2 = z1 + u1_h
    z3 = z2 + u2_h

    # Dark ground plinth + hill-safe subplinth
    add_subplinth_foundation(bm, (0.0, 0.0), w + 0.16, d + 0.16, mats["dark"])
    bm_add_box(bm, (0.0, 0.0, plinth_h * 0.5), (w + 0.16, d + 0.16, plinth_h), mats["dark"])

    p_fl, p_fr = Vector((-hx, -hy)), Vector((hx, -hy))
    p_br, p_bl = Vector((hx, hy)), Vector((-hx, hy))

    # --- Ground Floor: 2 Wide Recessed Display Storefronts ("escaparates") + Central Double Entrance ---
    for i in range(3):
        sa, sb = p_fl.lerp(p_fr, i / 3), p_fl.lerp(p_fr, (i + 1) / 3)
        mid = (sa + sb) * 0.5
        bay_w = (sb - sa).length
        is_center = i == 1
        add_wall_panel_with_recessed_window(
            bm, sa, sb, Vector((0, -1)), plinth_h, z1,
            mats["dark"], mats["wood"], mats["warm_glass"], mats["iron"], mats["ivory"],
            win_width_frac=0.68 if is_center else 0.80,
            sill_frac=0.0 if is_center else 0.14,
            head_frac=0.84,
            recess_depth=0.52 if is_center else 0.44,
            has_mullions=detail_lod0, has_architrave=False, sill_depth=0.14, lintel_depth=0.12,
        )
        if is_center:
            if detail_lod0:
                # Brass door handles, recessed threshold step, and twin topiary planters (ref f3b4b01b)
                bm_add_box(bm, (mid.x, -hy - 0.18, plinth_h * 0.5), (bay_w * 0.75, 0.40, plinth_h), mats["ivory"])
                for dx in (-0.12, 0.12):
                    bm_add_box(bm, (mid.x + dx, -hy + 0.42, plinth_h + 1.12), (0.04, 0.08, 0.45), mats["gold"])
                for side in (-1, 1):
                    add_potted_shrub(bm, (mid.x + side * (bay_w * 0.44), -hy - 0.52, 0.0), mats["ivory"], mats["foliage"], scale=0.82)
        else:
            # Storefront curved striped awnings + interior warm shelf display counters + wall sconces
            awn_a = mats["awning_red"] if i == 0 else mats["awning_blue"]
            add_curved_striped_awning(
                bm, Vector((mid.x, -hy)), Vector((0, -1)), Vector((1, 0)),
                z1 - 0.25, bay_w * 0.90, 1.35, 0.62, awn_a, mats["awning_cream"], mats["iron"], stripes=9,
            )
            if detail_lod0:
                # Visible shop interior counter shelf inside showcase pocket + glowing exterior globe sconces
                bm_add_box(bm, (mid.x, -hy + 0.28, plinth_h + 0.68), (bay_w * 0.66, 0.24, 0.16), mats["wood"])
                bm_add_box(bm, (mid.x - 0.6, -hy + 0.25, plinth_h + 0.86), (0.28, 0.18, 0.20), mats["awning_red" if i == 0 else "awning_blue"])
                bm_add_box(bm, (mid.x + 0.6, -hy + 0.25, plinth_h + 0.88), (0.24, 0.16, 0.24), mats["gold"])
                for side in (-1, 1):
                    sx = mid.x + side * (bay_w * 0.47)
                    bm_add_box(bm, (sx, -hy - 0.12, z1 - 0.72), (0.14, 0.14, 0.18), mats["iron"])
                    bm_add_box(bm, (sx, -hy - 0.22, z1 - 0.72), (0.18, 0.18, 0.20), mats["lamp"])

    # Side (-X, +X) & Back (+Y) Ground Floor Commercial Display / Service Bays
    for i in range(2):
        sa, sb = p_fr.lerp(p_br, i / 2), p_fr.lerp(p_br, (i + 1) / 2)
        add_wall_panel_with_recessed_window(
            bm, sa, sb, Vector((1, 0)), plinth_h, z1,
            mats["dark"], mats["wood"], mats["warm_glass"] if i == 0 else mats["glass"], mats["iron"], mats["ivory"],
            win_width_frac=0.68, sill_frac=0.18, head_frac=0.82, recess_depth=0.36, has_mullions=detail_lod0, has_architrave=False,
        )
    add_solid_wall_panel(bm, p_bl, p_fl, Vector((-1, 0)), plinth_h, z1, mats["dark"])
    add_solid_wall_panel(bm, p_br, p_bl, Vector((0, 1)), plinth_h, z1, mats["dark"])

    # Rich Shopfront Entablature Shelf Cornice separating Ground Shopfronts from Upper Lofts
    bm_add_box(bm, (0.0, 0.0, z1), (w + 0.48, d + 0.48, 0.26), mats["ivory"])
    bm_add_box(bm, (0.0, -hy - 0.22, z1 + 0.16), (w + 0.56, 0.24, 0.14), mats["gold"])

    # --- Upper Loft Floors (z1..z2, z2..z3): Grouped Divided Commercial Windows & Vertical Pilasters ---
    for fl, (zf0, zf1) in enumerate(((z1, z2), (z2, z3))):
        wall_m = mats["sage"] if fl == 0 else mats["cream"]
        # Front (-Y): 3 symmetrical multi-pane bays framed by vertical masonry pilasters
        for i in range(3):
            sa, sb = p_fl.lerp(p_fr, i / 3), p_fl.lerp(p_fr, (i + 1) / 3)
            add_wall_panel_with_recessed_window(
                bm, sa, sb, Vector((0, -1)), zf0, zf1,
                wall_m, mats["dark"], mats["glass"], mats["iron"], mats["ivory"],
                win_width_frac=0.60, sill_frac=0.22, head_frac=0.86, recess_depth=0.24,
                has_mullions=detail_lod0, has_architrave=True, sill_depth=0.16, lintel_depth=0.14,
            )
            if detail_lod0 and i == 1:
                # Subtle wrought-iron Juliet guardrail bar across center commercial bay
                mid = (sa + sb) * 0.5
                bw = (sb - sa).length * 0.62
                bm_add_box(bm, (mid.x, -hy - 0.14, zf0 + 1.05), (bw, 0.05, 0.05), mats["iron"])
                for k in range(5):
                    bm_add_box(bm, (mid.x - bw * 0.45 + (k / 4) * (bw * 0.9), -hy - 0.14, zf0 + 0.85), (0.03, 0.03, 0.40), mats["iron"])

        # Right (+X) 2 window bays + Back (+Y) 3 bays + Left (-X) 2 bays
        for p0, p1, out, n_s in (
            (p_fr, p_br, Vector((1, 0)), 2),
            (p_br, p_bl, Vector((0, 1)), 3),
            (p_bl, p_fl, Vector((-1, 0)), 2),
        ):
            for i in range(n_s):
                sa, sb = p0.lerp(p1, i / n_s), p0.lerp(p1, (i + 1) / n_s)
                add_wall_panel_with_recessed_window(
                    bm, sa, sb, out, zf0, zf1,
                    wall_m, mats["dark"], mats["glass"], mats["iron"], mats["ivory"],
                    win_width_frac=0.52, sill_frac=0.24, head_frac=0.84, recess_depth=0.20,
                    has_mullions=detail_lod0, has_architrave=True,
                )

    # Vertical Masonry Pilasters dividing Front & Side Bays cleanly
    for px in (-hx + 0.18, -hx / 3, hx / 3, hx - 0.18):
        bm_add_box(bm, (px, -hy - 0.08, (z1 + z3) * 0.5), (0.34, 0.20, z3 - z1), mats["ivory"])
    bm_add_box(bm, (0.0, 0.0, z2), (w + 0.28, d + 0.28, 0.16), mats["ivory"])

    # Sculpted Horizontal Signage Frieze Plaque ("CAFÉ / BAZAR" geometric emblem relief between floor 1 & 2)
    bm_add_box(bm, (0.0, -hy - 0.14, z2 + 0.04), (5.8, 0.20, 0.72), mats["dark"])
    bm_add_box(bm, (0.0, -hy - 0.16, z2 + 0.04), (5.5, 0.18, 0.58), mats["ivory"])
    if detail_lod0:
        # Geometric Stylized Café cup + stylized relief letter blocks (brand-safe non-ASCII ornament)
        for bx in (-1.8, -1.0, -0.2, 0.6, 1.4, 2.0):
            bm_add_box(bm, (bx, -hy - 0.27, z2 + 0.04), (0.34, 0.08, 0.34), mats["awning_red"])

    # Side Wall Authentic Urban Detail: Exterior Galvanized Kitchen Vent Stack grounded in hood box + AC Unit (+X wall)
    if detail_lod0:
        duct_bot = z1 + 0.45
        duct_top = z3 + 1.35
        bm_add_box(bm, (hx + 0.22, 1.6, duct_bot), (0.46, 0.54, 0.42), mats["steel"])
        bm_add_cylinder(bm, (hx + 0.22, 1.6, (duct_bot + duct_top) * 0.5), 0.16, 0.16, duct_top - duct_bot, 8, mats["steel"])
        bm_add_cylinder(bm, (hx + 0.22, 1.6, duct_top + 0.10), 0.26, 0.08, 0.22, 8, mats["steel"])
        bm_add_box(bm, (hx + 0.18, -1.4, z1 + 1.4), (0.28, 0.74, 0.48), mats["ivory"])
        bm_add_cylinder(bm, (hx + 0.33, -1.4, z1 + 1.4), 0.16, 0.16, 0.03, 10, mats["iron"], (0, math.pi * 0.5, 0))

    # --- Crowning Cornice + Stepped Sculpted European Parapet Crest ("Frontón Escalonado") & Rooftop ---
    bm_add_box(bm, (0.0, 0.0, z3 + 0.10), (w + 0.52, d + 0.52, 0.26), mats["ivory"])
    bm_add_box(bm, (0.0, 0.0, z3 - 0.06), (w, d, 0.24), mats["gravel"])

    p_h = 0.92
    p_t = 0.34
    for sx in (-1, 1):
        bm_add_box(bm, (sx * (hx - p_t * 0.5), 0.0, z3 + 0.22 + p_h * 0.5), (p_t, d + 0.20, p_h), mats["cream"])
        bm_add_box(bm, (sx * (hx - p_t * 0.5), 0.0, z3 + 0.22 + p_h + 0.07), (p_t + 0.16, d + 0.32, 0.14), mats["ivory"])
    for sy in (-1, 1):
        bm_add_box(bm, (0.0, sy * (hy - p_t * 0.5), z3 + 0.22 + p_h * 0.5), (w + 0.20, p_t, p_h), mats["cream"])
        bm_add_box(bm, (0.0, sy * (hy - p_t * 0.5), z3 + 0.22 + p_h + 0.07), (w + 0.32, p_t + 0.16, 0.14), mats["ivory"])

    # Raised Stepped Center Front Crest Architrave crowning street facade
    bm_add_box(bm, (0.0, -hy + p_t * 0.5, z3 + 1.48), (4.8, p_t + 0.06, 0.72), mats["sage"])
    bm_add_box(bm, (0.0, -hy + p_t * 0.5, z3 + 1.90), (5.1, p_t + 0.20, 0.16), mats["ivory"])
    bm_add_box(bm, (0.0, -hy - 0.02, z3 + 1.48), (1.4, 0.14, 0.36), mats["gold"])

    # Rooftop HVAC Chillers + Glass Skylight Lantern Box
    if detail_lod0:
        bm_add_box(bm, (-2.2, 0.5, z3 + 0.38), (2.4, 1.8, 0.55), mats["glass"])
        bm_add_box(bm, (-2.2, 0.5, z3 + 0.68), (2.55, 1.95, 0.10), mats["iron"])
        for dx in (2.2, 3.4):
            bm_add_box(bm, (dx, 1.6, z3 + 0.45), (0.90, 1.10, 0.85), mats["steel"])
            bm_add_cylinder(bm, (dx, 1.6, z3 + 0.90), 0.30, 0.30, 0.06, 10, mats["iron"])

    # --- Sidewalk Bistro Café Terrace Props (under Left Red Awning!) ---
    if detail_lod0:
        _add_cafe_terrace_set(bm, (-4.1, -hy - 1.55, 0.0), mats, parasol=True)
        _add_cafe_terrace_set(bm, (-2.1, -hy - 1.55, 0.0), mats, parasol=False)
        # Menu chalkboard A-frame near shop door
        bm_add_box(bm, (-1.15, -hy - 0.95, 0.52), (0.54, 0.08, 0.96), mats["wood"], (math.radians(-12), 0, 0.25))
        bm_add_box(bm, (-1.15, -hy - 0.78, 0.52), (0.54, 0.08, 0.96), mats["wood"], (math.radians(12), 0, 0.25))

    return create_mesh_object(
        f"EdificioComercial_LOD{lod}",
        bm,
        mat_list,
        col,
        bevel_width=0.02 if detail_lod0 else 0.0,
        location=location,
    )
