"""Hero Building 6: Palacio Histórico de Piedra del Casco Antiguo de Cáceres (Stylized Low Poly)."""

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
    add_stork_nest,
    add_stylized_tree,
    add_subplinth_foundation,
    add_wall_panel_with_recessed_window,
    bm_add_box,
    bm_add_cylinder,
    create_collection,
    create_mesh_object,
)


def build_hero_casco_palace(
    materials: dict[str, bpy.types.Material],
    collection_name: str = "Hero_Casco_Palace",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    lod: int = 0,
) -> bpy.types.Object:
    """Model Hero 6: Noble Cáceres Golden-Granite Renaissance Palace with defensive corner tower.

    Inspired by the Ciudad Monumental palaces (Golfines / Veletas / Carvajal): features heavy
    battered granite plinth, 3D corner quoins, grand radial voussoir portal enclosed in carved
    stone alfiz & large heraldic coat of arms, cantilevered noble balconies with brackets,
    upper renaissance loggia gallery, crenelated corner watchtower with corbeled machicolations
    crowned by a stylized Cáceres stork nest, and aged terracotta hipped/gabled roofs.
    """
    detail_lod0 = lod == 0
    col = create_collection(collection_name)
    mat_list = [
        materials["wall_palace_granite"],    # 0
        materials["wall_casco_stone"],       # 1
        materials["wall_plinth_granite"],    # 2
        materials["trim_stone_warm"],        # 3
        materials["trim_ivory"],             # 4
        materials["wood_cedar"],             # 5
        materials["wood_olive"],             # 6
        materials["metal_iron"],             # 7
        materials["metal_bronze"],           # 8
        materials["metal_gold_sign"],        # 9
        materials["roof_moss_tile"],         # 10
        materials["roof_terracotta_ridge"],  # 11
        materials["glass_sky"],              # 12
        materials["lamp_glow"],              # 13
        materials["foliage_deep"],           # 14
        materials["bark"],                   # 15
        materials["nest_twig"],              # 16
        materials["roof_plum_rib"],          # 17
    ]
    mats = {
        "granite": 0, "stone": 1, "plinth": 2, "warm_trim": 3, "ivory": 4,
        "wood": 5, "olive": 6, "iron": 7, "bronze": 8, "gold": 9,
        "roof": 10, "ridge": 11, "glass": 12, "lamp": 13,
        "foliage_deep": 14, "bark": 15, "twig": 16, "plum": 17,
    }

    bm = bmesh.new()

    # Main 3-story noble palace wing (Left: 10.6m x 10.2m, wall_h = 11.4m)
    # Corner fortified watchtower (Right-Front corner: 4.1m x 4.4m, height = 15.2m)
    pw, pd = 10.6, 10.2
    px, py = -1.9, 0.2
    hx, hy = pw * 0.5, pd * 0.5

    tw, td = 4.1, 4.4
    tx = px + hx + tw * 0.5 - 0.15
    ty = py - hy + td * 0.5 + 0.15
    thx, thy = tw * 0.5, td * 0.5

    plinth_h = 0.65
    z1 = 4.25
    z2 = 8.15
    z3 = 11.45
    z_tower = 15.20

    # Deep hill-safe granite foundations for palace + tower
    add_subplinth_foundation(bm, (px, py), pw + 0.22, pd + 0.22, mats["plinth"])
    add_subplinth_foundation(bm, (tx, ty), tw + 0.20, td + 0.20, mats["plinth"])

    # Heavy beveled granite socles & continuous horizontal stone string courses
    bm_add_box(bm, (px, py, plinth_h * 0.5), (pw + 0.24, pd + 0.24, plinth_h), mats["plinth"])
    bm_add_box(bm, (tx, ty, plinth_h * 0.5), (tw + 0.24, td + 0.24, plinth_h), mats["plinth"])
    for hz in (z1, z2):
        bm_add_box(bm, (px, py, hz), (pw + 0.18, pd + 0.18, 0.20), mats["warm_trim"])
        bm_add_box(bm, (tx, ty, hz), (tw + 0.18, td + 0.18, 0.22), mats["warm_trim"])
    bm_add_box(bm, (tx, ty, z3), (tw + 0.18, td + 0.18, 0.22), mats["warm_trim"])

    # 3D stone corner quoins on palace & tower
    for (cx_q, cy_q, hqx, hqy, h_max) in ((px, py, hx, hy, z3), (tx, ty, thx, thy, z_tower - 1.1)):
        for sx in (-1, 1):
            for sy in (-1, 1):
                for k in range(11 if detail_lod0 else 4):
                    qz = plinth_h + 0.35 + k * 0.96
                    if qz + 0.28 > h_max:
                        break
                    wide = k % 2 == 0
                    qw = 0.56 if wide else 0.30
                    qd = 0.30 if wide else 0.56
                    bm_add_box(bm, (cx_q + sx * (hqx - qw * 0.35), cy_q + sy * (hqy - qd * 0.35), qz), (qw, qd, 0.42), mats["warm_trim"])

    # === 1. PALACE GROUND FLOOR (plinth_h .. z1) ===
    p_fl, p_fr = Vector((px - hx, py - hy)), Vector((px + hx, py - hy))
    p_br, p_bl = Vector((px + hx, py + hy)), Vector((px - hx, py + hy))
    shutter = mats["wood"] if detail_lod0 else None

    for i, kind in enumerate(("win", "portal", "win")):
        a = p_fl.lerp(p_fr, i / 3.0)
        b = p_fl.lerp(p_fr, (i + 1) / 3.0)
        out = Vector((0.0, -1.0))
        if kind == "portal":
            add_wall_panel_with_recessed_window(
                bm, a, b, out, plinth_h, z1,
                wall_mat=mats["granite"], reveal_mat=mats["plinth"],
                glass_mat=mats["wood"], frame_mat=mats["bronze"],
                sill_mat=mats["plinth"], win_width_frac=0.62, sill_frac=0.0,
                head_frac=0.74, recess_depth=0.46, shutter_mat=None,
                has_mullions=False, has_architrave=True, sill_depth=0.0, lintel_depth=0.18,
            )
            mid = (a + b) * 0.5
            door_w = (b - a).length * 0.62
            door_h = (z1 - plinth_h) * 0.74
            arch_z = plinth_h + door_h * 0.88
            r_mid = door_w * 0.54
            # Grand radial stone voussoirs ("dovelas")
            n_vous = 9 if detail_lod0 else 5
            for k in range(n_vous):
                ang = math.radians(15 + k * (150.0 / (n_vous - 1)))
                vx = mid.x - math.cos(ang) * r_mid
                vz = arch_z + math.sin(ang) * (r_mid * 0.54)
                is_key = k == n_vous // 2
                bm_add_box(
                    bm,
                    (vx, py - hy - (0.12 if is_key else 0.08), vz),
                    (0.26 if is_key else 0.22, 0.24 if is_key else 0.18, 0.42 if is_key else 0.30),
                    mats["warm_trim"],
                    (0.0, ang - math.pi * 0.5, 0.0),
                )
            # Signature Cáceres Carved Alfiz Rectangular Molding + Grand Heraldic Shield ("Escudo")
            alfiz_w = door_w + 1.05
            alfiz_top = z1 - 0.18
            bm_add_box(bm, (mid.x, py - hy - 0.11, alfiz_top), (alfiz_w, 0.22, 0.14), mats["warm_trim"])
            for sx in (-1, 1):
                bm_add_box(bm, (mid.x + sx * (alfiz_w * 0.5 - 0.07), py - hy - 0.11, (arch_z - 0.3 + alfiz_top) * 0.5), (0.14, 0.22, alfiz_top - arch_z + 0.45), mats["warm_trim"])
            # Sculpted Escudo Heráldico framed inside alfiz
            bm_add_box(bm, (mid.x, py - hy - 0.14, alfiz_top - 0.42), (0.64, 0.22, 0.72), mats["warm_trim"])
            bm_add_box(bm, (mid.x, py - hy - 0.22, alfiz_top - 0.44), (0.44, 0.14, 0.50), mats["stone"])
            bm_add_box(bm, (mid.x, py - hy - 0.24, alfiz_top - 0.02), (0.48, 0.16, 0.16), mats["gold"])
            # Studded cedar portal doors + iron torches + granite threshold
            bm_add_box(bm, (mid.x, py - hy - 0.20, plinth_h * 0.5), (door_w + 0.70, 0.48, plinth_h), mats["plinth"])
            if detail_lod0:
                bm_add_box(bm, (mid.x, py - hy + 0.42, plinth_h + door_h * 0.5), (0.08, 0.06, door_h - 0.08), mats["bronze"])
                for r_idx in range(4):
                    rz = plinth_h + 0.48 + r_idx * 0.58
                    for sx in (-0.75, -0.35, 0.35, 0.75):
                        bm_add_box(bm, (mid.x + sx, py - hy + 0.38, rz), (0.06, 0.04, 0.06), mats["bronze"])
                for sx in (-1, 1):
                    lx = mid.x + sx * (alfiz_w * 0.5 + 0.22)
                    bm_add_box(bm, (lx, py - hy - 0.20, plinth_h + 2.45), (0.08, 0.28, 0.08), mats["iron"])
                    bm_add_box(bm, (lx, py - hy - 0.30, plinth_h + 2.28), (0.18, 0.18, 0.26), mats["lamp"])
                    bm_add_box(bm, (lx, py - hy - 0.30, plinth_h + 2.45), (0.24, 0.24, 0.07), mats["iron"])
        else:
            add_wall_panel_with_recessed_window(
                bm, a, b, out, plinth_h, z1,
                wall_mat=mats["granite"], reveal_mat=mats["warm_trim"],
                glass_mat=mats["glass"], frame_mat=mats["wood"],
                sill_mat=mats["plinth"], win_width_frac=0.46, sill_frac=0.22,
                head_frac=0.72, recess_depth=0.30, shutter_mat=None,
                has_mullions=detail_lod0, has_architrave=True,
            )
            mid = (a + b) * 0.5
            if detail_lod0:
                ww = (b - a).length * 0.46
                wh = (z1 - plinth_h) * 0.50
                wz = plinth_h + (z1 - plinth_h) * 0.47
                for pz in (wz - wh * 0.5, wz + wh * 0.5):
                    bm_add_box(bm, (mid.x, py - hy - 0.14, pz), (ww + 0.16, 0.18, 0.045), mats["iron"])
                for rx in (-0.45, -0.15, 0.15, 0.45):
                    bm_add_box(bm, (mid.x + rx * ww, py - hy - 0.20, wz), (0.035, 0.035, wh), mats["iron"])

    # Palace Sides & Back Ground
    for sa, sb, sout in ((p_fr, p_br, Vector((1.0, 0.0))), (p_br, p_bl, Vector((0.0, 1.0))), (p_bl, p_fl, Vector((-1.0, 0.0)))):
        add_wall_panel_with_recessed_window(
            bm, sa, sb, sout, plinth_h, z1,
            wall_mat=mats["granite"], reveal_mat=mats["warm_trim"],
            glass_mat=mats["glass"], frame_mat=mats["wood"],
            sill_mat=mats["plinth"], win_width_frac=0.22, sill_frac=0.28,
            head_frac=0.72, recess_depth=0.24, shutter_mat=None, has_mullions=False,
        )

    # === 2. PALACE NOBLE FLOOR (z1 .. z2) WITH CANTILEVERED BALCONIES ===
    for i in range(3):
        a = p_fl.lerp(p_fr, i / 3.0)
        b = p_fl.lerp(p_fr, (i + 1) / 3.0)
        add_wall_panel_with_recessed_window(
            bm, a, b, Vector((0.0, -1.0)), z1, z2,
            wall_mat=mats["granite"], reveal_mat=mats["warm_trim"],
            glass_mat=mats["glass"], frame_mat=mats["wood"],
            sill_mat=mats["warm_trim"], win_width_frac=0.46, sill_frac=0.06,
            head_frac=0.78, recess_depth=0.32, shutter_mat=shutter,
            has_mullions=detail_lod0, has_architrave=True, lintel_depth=0.14,
        )
        mid = (a + b) * 0.5
        # Guardapolvo molded stone pediment cap above noble openings
        bm_add_box(bm, (mid.x, py - hy - 0.14, z1 + (z2 - z1) * 0.84), (2.25, 0.24, 0.14), mats["warm_trim"])
        if i in (0, 2):
            add_cantilevered_balcony(
                bm, Vector((mid.x, py - hy)), Vector((0.0, -1.0)), Vector((1.0, 0.0)),
                floor_z=z1 + 0.12, width=2.25, proj=0.74,
                slab_mat=mats["warm_trim"], rail_mat=mats["iron"], detailed=detail_lod0,
            )

    for sa, sb, sout in ((p_fr, p_br, Vector((1.0, 0.0))), (p_br, p_bl, Vector((0.0, 1.0))), (p_bl, p_fl, Vector((-1.0, 0.0)))):
        for k in range(2):
            u0, u1 = k * 0.5, (k + 1) * 0.5
            add_wall_panel_with_recessed_window(
                bm, sa.lerp(sb, u0), sa.lerp(sb, u1), sout, z1, z2,
                wall_mat=mats["granite"], reveal_mat=mats["warm_trim"],
                glass_mat=mats["glass"], frame_mat=mats["wood"],
                sill_mat=mats["warm_trim"], win_width_frac=0.36, sill_frac=0.22,
                head_frac=0.78, recess_depth=0.26, shutter_mat=None,
                has_mullions=detail_lod0, has_architrave=True,
            )

    # === 3. UPPER RENAISSANCE SOLANAR GALLERY (z2 .. z3) ===
    for i in range(4):
        a = p_fl.lerp(p_fr, i / 4.0)
        b = p_fl.lerp(p_fr, (i + 1) / 4.0)
        add_wall_panel_with_recessed_window(
            bm, a, b, Vector((0.0, -1.0)), z2, z3,
            wall_mat=mats["stone"], reveal_mat=mats["warm_trim"],
            glass_mat=mats["glass"], frame_mat=mats["wood"],
            sill_mat=mats["warm_trim"], win_width_frac=0.58, sill_frac=0.14,
            head_frac=0.74, recess_depth=0.40, shutter_mat=None,
            has_mullions=detail_lod0, has_architrave=True, lintel_depth=0.12,
        )
    for sa, sb, sout in ((p_fr, p_br, Vector((1.0, 0.0))), (p_br, p_bl, Vector((0.0, 1.0))), (p_bl, p_fl, Vector((-1.0, 0.0)))):
        add_wall_panel_with_recessed_window(
            bm, sa, sb, sout, z2, z3,
            wall_mat=mats["stone"], reveal_mat=mats["warm_trim"],
            glass_mat=mats["glass"], frame_mat=mats["wood"],
            sill_mat=mats["warm_trim"], win_width_frac=0.34, sill_frac=0.22,
            head_frac=0.72, recess_depth=0.26, shutter_mat=None, has_mullions=False,
        )

    # Molded cornice + carved stone corbels / modillions under eaves
    bm_add_box(bm, (px, py, z3 - 0.05), (pw + 0.34, pd + 0.34, 0.16), mats["warm_trim"])
    if detail_lod0:
        for i in range(10):
            cx_m = px - hx + 0.5 + (i / 9.0) * (pw - 1.0)
            bm_add_box(bm, (cx_m, py - hy - 0.16, z3 - 0.22), (0.14, 0.30, 0.22), mats["warm_trim"])
            bm_add_box(bm, (cx_m, py - hy - 0.32, z3 + 0.02), (0.10, 0.44, 0.10), mats["wood"])

    # Aged Terracotta Roof over Main Palace Wing (overlapping cleanly into Watchtower)
    add_pitched_roof_with_ribs(
        bm, Vector((px, py)), pw, pd, z3, peak_h=2.15,
        overhang=0.45, roof_mat=mats["roof"], rib_mat=mats["ridge"],
        trim_mat=mats["wood"], wall_mat=mats["stone"],
        eave_thickness=0.14, rib_spacing=0.68,
        ridge_along_x=True, detailed_ribs=detail_lod0,
    )

    # === 4. CORNER FORTIFIED WATCHTOWER ("Torre Señorial" at tx, ty) ===
    t_fl, t_fr = Vector((tx - thx, ty - thy)), Vector((tx + thx, ty - thy))
    t_br, t_bl = Vector((tx + thx, ty + thy)), Vector((tx - thx, ty + thy))

    # Ground + Noble Gothic-Renaissance Ajimez Window + High Slits
    add_wall_panel_with_recessed_window(
        bm, t_fl, t_fr, Vector((0.0, -1.0)), plinth_h, z1,
        wall_mat=mats["granite"], reveal_mat=mats["warm_trim"],
        glass_mat=mats["glass"], frame_mat=mats["wood"],
        sill_mat=mats["warm_trim"], win_width_frac=0.30, sill_frac=0.38,
        head_frac=0.72, recess_depth=0.28, shutter_mat=None, has_mullions=False,
    )
    add_wall_panel_with_recessed_window(
        bm, t_fr, t_br, Vector((1.0, 0.0)), plinth_h, z1,
        wall_mat=mats["granite"], reveal_mat=mats["warm_trim"],
        glass_mat=mats["glass"], frame_mat=mats["wood"],
        sill_mat=mats["warm_trim"], win_width_frac=0.28, sill_frac=0.38,
        head_frac=0.72, recess_depth=0.28, shutter_mat=None, has_mullions=False,
    )
    add_solid_wall_panel(bm, t_br, t_bl, Vector((0.0, 1.0)), plinth_h, z1, mats["granite"])
    add_solid_wall_panel(bm, t_bl, t_fl, Vector((-1.0, 0.0)), plinth_h, z1, mats["granite"])

    # Noble tower floor: corner ajimez (twin-light window with marble mullion)
    for ta, tb, tout in ((t_fl, t_fr, Vector((0.0, -1.0))), (t_fr, t_br, Vector((1.0, 0.0)))):
        add_wall_panel_with_recessed_window(
            bm, ta, tb, tout, z1, z2,
            wall_mat=mats["granite"], reveal_mat=mats["warm_trim"],
            glass_mat=mats["glass"], frame_mat=mats["ivory"],
            sill_mat=mats["warm_trim"], win_width_frac=0.44, sill_frac=0.20,
            head_frac=0.78, recess_depth=0.32, shutter_mat=None,
            has_mullions=True, has_architrave=True, lintel_depth=0.14,
        )
    add_solid_wall_panel(bm, t_br, t_bl, Vector((0.0, 1.0)), z1, z2, mats["granite"])
    add_solid_wall_panel(bm, t_bl, t_fl, Vector((-1.0, 0.0)), z1, z2, mats["granite"])

    # Upper tower shaft (z2 .. z_tower - 1.2)
    z_crown = z_tower - 1.20
    for ta, tb, tout in (
        (t_fl, t_fr, Vector((0.0, -1.0))),
        (t_fr, t_br, Vector((1.0, 0.0))),
        (t_br, t_bl, Vector((0.0, 1.0))),
        (t_bl, t_fl, Vector((-1.0, 0.0))),
    ):
        add_wall_panel_with_recessed_window(
            bm, ta, tb, tout, z2, z_crown,
            wall_mat=mats["granite"], reveal_mat=mats["warm_trim"],
            glass_mat=mats["glass"], frame_mat=mats["iron"],
            sill_mat=mats["warm_trim"], win_width_frac=0.22, sill_frac=0.36,
            head_frac=0.74, recess_depth=0.24, shutter_mat=None,
            has_mullions=False, has_architrave=True,
        )

    # Machicolations (projecting stone corbel crown) + Crenelated Merlons + Pyramidal Roof Cap
    corbel_w, corbel_d = tw + 0.52, td + 0.52
    bm_add_box(bm, (tx, ty, z_crown + 0.28), (corbel_w, corbel_d, 0.44), mats["warm_trim"])
    if detail_lod0:
        for sx in (-1, 0, 1):
            for sy in (-1, 1):
                bm_add_box(bm, (tx + sx * 1.15, ty + sy * (corbel_d * 0.5 - 0.14), z_crown - 0.10), (0.28, 0.34, 0.34), mats["plinth"])
        for sy in (-1, 0, 1):
            for sx in (-1, 1):
                bm_add_box(bm, (tx + sx * (corbel_w * 0.5 - 0.14), ty + sy * 1.20, z_crown - 0.10), (0.34, 0.28, 0.34), mats["plinth"])

    # Parapet ring + crenellated merlons around tower roof terrace
    par_z = z_crown + 0.50
    bm_add_box(bm, (tx, ty, par_z + 0.22), (corbel_w, corbel_d, 0.44), mats["stone"])
    # Inner dark slate / terracotta cap inset slightly + crenellation merlons
    bm_add_box(bm, (tx, ty, par_z + 0.48), (tw - 0.2, td - 0.2, 0.14), mats["plum"])
    mer_z = par_z + 0.78
    for sx in (-1, 1):
        for sy in (-1, 1):
            # Heavy stepped corner battlements
            mx = tx + sx * (corbel_w * 0.5 - 0.34)
            my = ty + sy * (corbel_d * 0.5 - 0.34)
            bm_add_box(bm, (mx, my, mer_z), (0.68, 0.68, 0.68), mats["warm_trim"])
            bm_add_box(bm, (mx, my, mer_z + 0.44), (0.48, 0.48, 0.20), mats["stone"])
    # Center merlons along all 4 sides
    for sx in (-1, 1):
        bm_add_box(bm, (tx + sx * (corbel_w * 0.5 - 0.24), ty, mer_z - 0.04), (0.46, 0.90, 0.60), mats["warm_trim"])
    for sy in (-1, 1):
        bm_add_box(bm, (tx, ty + sy * (corbel_d * 0.5 - 0.24), mer_z - 0.04), (0.90, 0.46, 0.60), mats["warm_trim"])

    # Low pyramidal terracotta turret roof inside battlements + Signature Stork Nest!
    bm_add_cylinder(bm, (tx, ty, par_z + 1.05), tw * 0.56, 0.22, 1.35, 4, mats["roof"], (0.0, 0.0, math.pi * 0.25))
    add_stork_nest(
        bm,
        (tx - (corbel_w * 0.5 - 0.36), ty - (corbel_d * 0.5 - 0.36), mer_z + 0.54),
        mats["twig"], mats["ivory"], mats["ridge"],
    )

    # Small side patio planter & Mediterranean cypress framing tower flank
    if detail_lod0:
        add_potted_shrub(bm, (px - hx + 0.85, py - hy - 0.46, 0.0), mats["plinth"], mats["foliage_deep"], scale=0.82)
        add_stylized_tree(bm, (tx + thx + 0.72, ty + 1.6, 0.0), mats["bark"], mats["foliage_deep"], kind="cypress", scale=0.92)

    bevel_w = 0.024 if detail_lod0 else 0.0
    name = "PalacioCasco_LOD0" if detail_lod0 else "PalacioCasco_LOD1"
    return create_mesh_object(name, bm, mat_list, col, bevel_width=bevel_w, bevel_segments=1, location=location)
