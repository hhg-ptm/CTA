"""Hero Building 1: Casa / Casona Histórica de Cáceres (Stylized Low Poly Blender model)."""

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
    add_wall_panel_with_recessed_window,
    bm_add_box,
    bm_add_cylinder,
    create_collection,
    create_mesh_object,
)


def _add_faceted_ring_walls(
    bm: bmesh.types.BMesh,
    w: float,
    d: float,
    z0: float,
    z1: float,
    mats: dict[str, int],
    *,
    front_bays: list[str],
    back_mat: int,
    side_bays: bool,
    detail_lod0: bool,
) -> None:
    """Build 4 walls of main Casco body centered around X=0, Y=0 with ground & upper articulation."""
    hx, hy = w * 0.5, d * 0.5
    p_fl = Vector((-hx, -hy))
    p_fr = Vector((hx, -hy))
    p_br = Vector((hx, hy))
    p_bl = Vector((-hx, hy))

    # Front (-Y): grid bays left -> right
    n_f = len(front_bays)
    for i, bay_kind in enumerate(front_bays):
        a = p_fl.lerp(p_fr, i / n_f)
        b = p_fl.lerp(p_fr, (i + 1) / n_f)
        out = Vector((0.0, -1.0))
        if bay_kind == "portal":
            # Monumental carved granite arch portal bay
            add_wall_panel_with_recessed_window(
                bm, a, b, out, z0, z1,
                wall_mat=mats["wall_stone"], reveal_mat=mats["plinth"],
                glass_mat=mats["wood_cedar"], frame_mat=mats["metal_iron"],
                sill_mat=mats["plinth"], win_width_frac=0.56, sill_frac=0.0,
                head_frac=0.72, recess_depth=0.40, shutter_mat=None,
                has_mullions=False, has_architrave=True, sill_depth=0.0, lintel_depth=0.16,
            )
            mid = (a + b) * 0.5
            # Radial carved voussoirs ("dovelas") framing arched door top
            door_h = (z1 - z0) * 0.72
            door_w = (b - a).length * 0.56
            arch_z = z0 + door_h * 0.86
            r_mid = door_w * 0.52
            if detail_lod0:
                for k in range(7):
                    ang = math.radians(18 + k * 24)
                    vx = mid.x - math.cos(ang) * r_mid
                    vz = arch_z + math.sin(ang) * (r_mid * 0.55)
                    is_key = k == 3
                    bm_add_box(
                        bm,
                        (vx, -hy - (0.09 if is_key else 0.06), vz),
                        (0.24 if is_key else 0.20, 0.22 if is_key else 0.16, 0.34 if is_key else 0.26),
                        mats["plinth"],
                        (0.0, ang - math.pi * 0.5, 0.0),
                    )
                # Carved wooden double door panels, brass knockers & granite threshold step down to street
                bm_add_box(bm, (mid.x, -hy + 0.36, z0 + door_h * 0.5), (0.07, 0.06, door_h - 0.1), mats["metal_iron"])
                for sx in (-1, 1):
                    bm_add_box(bm, (mid.x + sx * (door_w * 0.23), -hy + 0.36, z0 + door_h * 0.36), (door_w * 0.32, 0.05, door_h * 0.42), mats["wood_olive"])
                    bm_add_box(bm, (mid.x + sx * (door_w * 0.10), -hy + 0.32, z0 + 1.15), (0.06, 0.06, 0.14), mats["metal_gold"])
                bm_add_box(bm, (mid.x, -hy - 0.16, z0 * 0.5), (door_w + 0.45, 0.42, z0 + 0.04), mats["plinth"])
                # Twin warm wall lanterns + sculpted granite coat of arms ("escudo heráldico")
                for side in (-1, 1):
                    lx = mid.x + side * (door_w * 0.5 + 0.32)
                    bm_add_box(bm, (lx, -hy - 0.16, z0 + 2.25), (0.08, 0.24, 0.08), mats["metal_iron"])
                    bm_add_box(bm, (lx, -hy - 0.24, z0 + 2.10), (0.18, 0.18, 0.24), mats["lamp_glow"])
                    bm_add_box(bm, (lx, -hy - 0.24, z0 + 2.24), (0.24, 0.24, 0.06), mats["metal_iron"])
                # Carved Escudo above portal
                bm_add_box(bm, (mid.x, -hy - 0.12, z0 + door_h + 0.44), (0.58, 0.18, 0.68), mats["plinth"])
                bm_add_box(bm, (mid.x, -hy - 0.17, z0 + door_h + 0.46), (0.34, 0.12, 0.42), mats["trim_ivory"])
                bm_add_box(bm, (mid.x, -hy - 0.14, z0 + door_h + 0.84), (0.42, 0.20, 0.14), mats["metal_gold"])
        elif bay_kind == "reja_window":
            add_wall_panel_with_recessed_window(
                bm, a, b, out, z0, z1,
                wall_mat=mats["wall_stone"], reveal_mat=mats["plinth"],
                glass_mat=mats["glass_sky"], frame_mat=mats["wood_cedar"],
                sill_mat=mats["trim_ivory"], win_width_frac=0.46, sill_frac=0.28,
                head_frac=0.82, recess_depth=0.22, shutter_mat=mats["wood_olive"],
                has_mullions=detail_lod0, has_architrave=True,
            )
            if detail_lod0:
                # 3D protruding forged wrought-iron cage grille ("reja cacereña")
                mid = (a + b) * 0.5
                ww = (b - a).length * 0.52
                wh = (z1 - z0) * 0.56
                zc = z0 + (z1 - z0) * 0.55
                for fz in (zc - wh * 0.5, zc + wh * 0.5):
                    bm_add_box(bm, (mid.x, -hy - 0.14, fz), (ww + 0.08, 0.28, 0.045), mats["metal_iron"])
                for k in range(5):
                    bx = mid.x - ww * 0.5 + (k / 4) * ww
                    bm_add_box(bm, (bx, -hy - 0.25, zc), (0.035, 0.035, wh), mats["metal_iron"])
        elif bay_kind == "balconera":
            add_wall_panel_with_recessed_window(
                bm, a, b, out, z0, z1,
                wall_mat=mats["wall_lime"], reveal_mat=mats["trim_stone"],
                glass_mat=mats["glass_sky"], frame_mat=mats["wood_cedar"],
                sill_mat=mats["trim_ivory"], win_width_frac=0.42, sill_frac=0.04,
                head_frac=0.86, recess_depth=0.24, shutter_mat=mats["wood_olive"] if detail_lod0 else None,
                has_mullions=detail_lod0, has_architrave=True, sill_depth=0.06, lintel_depth=0.14,
            )
            mid = (a + b) * 0.5
            bw = (b - a).length * 0.64
            add_cantilevered_balcony(
                bm, mid, out, Vector((1.0, 0.0)), z0 + 0.02, bw, 0.62,
                mats["trim_stone"], mats["metal_iron"], detailed=detail_lod0,
            )
            if detail_lod0:
                add_potted_shrub(bm, (mid.x - bw * 0.28, -hy - 0.34, z0 + 0.02), mats["roof_terracotta"], mats["flower_pink"], scale=0.45)
        elif bay_kind == "window":
            add_wall_panel_with_recessed_window(
                bm, a, b, out, z0, z1,
                wall_mat=mats["wall_lime"], reveal_mat=mats["trim_stone"],
                glass_mat=mats["glass_sky"], frame_mat=mats["wood_cedar"],
                sill_mat=mats["trim_ivory"], win_width_frac=0.44, sill_frac=0.26,
                head_frac=0.84, recess_depth=0.20, shutter_mat=mats["wood_olive"] if detail_lod0 else None,
                has_mullions=detail_lod0, has_architrave=True,
            )
        else:
            add_solid_wall_panel(bm, a, b, out, z0, z1, mats["wall_lime"])

    # Back (+Y) articulated rear courtyard facade
    n_b = 3
    for i in range(n_b):
        a = p_br.lerp(p_bl, i / n_b)
        b = p_br.lerp(p_bl, (i + 1) / n_b)
        add_wall_panel_with_recessed_window(
            bm, a, b, Vector((0.0, 1.0)), z0, z1,
            wall_mat=back_mat, reveal_mat=mats["trim_stone"],
            glass_mat=mats["glass_sky"], frame_mat=mats["wood_cedar"],
            sill_mat=mats["trim_ivory"], win_width_frac=0.42, sill_frac=0.28,
            head_frac=0.82, recess_depth=0.18, shutter_mat=None, has_mullions=detail_lod0,
        )

    # Left (-X) & Right (+X) side walls
    for p_start, p_end, out in ((p_bl, p_fl, Vector((-1.0, 0.0))), (p_fr, p_br, Vector((1.0, 0.0)))):
        if side_bays:
            for i in range(2):
                sa = p_start.lerp(p_end, i / 2)
                sb = p_start.lerp(p_end, (i + 1) / 2)
                add_wall_panel_with_recessed_window(
                    bm, sa, sb, out, z0, z1,
                    wall_mat=back_mat, reveal_mat=mats["trim_stone"],
                    glass_mat=mats["glass_sky"], frame_mat=mats["wood_cedar"],
                    sill_mat=mats["trim_ivory"], win_width_frac=0.40, sill_frac=0.28,
                    head_frac=0.82, recess_depth=0.18, shutter_mat=mats["wood_olive"] if detail_lod0 else None,
                    has_mullions=detail_lod0,
                )
        else:
            add_solid_wall_panel(bm, p_start, p_end, out, z0, z1, back_mat)


def build_hero_casco_house(
    materials: dict[str, bpy.types.Material],
    collection_name: str = "Hero_Casco_House",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    lod: int = 0,
) -> bpy.types.Object:
    """Model Hero 1: Historic Cáceres manor house with granite plinth, quoins,
    arched portal, wrought-iron rejas, cantilevered balconies, stepped torreón + mirador bay,
    sculpted terracotta barrel-tile roof, corbel eave rafters, and brick chimney.
    """
    detail_lod0 = lod == 0
    col = create_collection(collection_name)
    mat_list = [
        materials["wall_casco_stone"],     # 0
        materials["wall_casco_lime"],      # 1
        materials["wall_plinth_granite"],  # 2
        materials["trim_ivory"],           # 3
        materials["trim_stone_warm"],      # 4
        materials["wood_cedar"],           # 5
        materials["wood_olive"],           # 6
        materials["metal_iron"],           # 7
        materials["metal_gold_sign"],      # 8
        materials["metal_copper"],         # 9
        materials["glass_sky"],            # 10
        materials["lamp_glow"],            # 11
        materials["roof_terracotta"],      # 12
        materials["roof_terracotta_ridge"],# 13
        materials["foliage_bright"],       # 14
        materials["flower_pink"],          # 15
    ]
    mats = {
        "wall_stone": 0, "wall_lime": 1, "plinth": 2, "trim_ivory": 3, "trim_stone": 4,
        "wood_cedar": 5, "wood_olive": 6, "metal_iron": 7, "metal_gold": 8, "metal_copper": 9,
        "glass_sky": 10, "lamp_glow": 11, "roof_terracotta": 12, "roof_ridge": 13,
        "foliage": 14, "flower_pink": 15,
    }

    bm = bmesh.new()
    w, d = 11.4, 8.2
    hx, hy = w * 0.5, d * 0.5
    plinth_h = 0.52
    g_h = 3.55
    u_h = 3.35
    z1 = plinth_h + g_h
    z2 = z1 + u_h

    # 1. Stepped carved granite plinth ("zócalo") around full perimeter
    bm_add_box(bm, (0.0, 0.0, plinth_h * 0.5), (w + 0.16, d + 0.16, plinth_h), mats["plinth"])

    # 2. Ground Floor + Planta Noble main facades
    _add_faceted_ring_walls(
        bm, w, d, plinth_h, z1, mats,
        front_bays=["reja_window", "portal", "reja_window"],
        back_mat=mats["wall_stone"], side_bays=True, detail_lod0=detail_lod0,
    )
    _add_faceted_ring_walls(
        bm, w, d, z1, z2, mats,
        front_bays=["balconera", "balconera", "window"],
        back_mat=mats["wall_lime"], side_bays=True, detail_lod0=detail_lod0,
    )

    # 3. Carved 3D horizontal granite belt cornice + heavy upper eaves cornice + timber corbels ("canecillos")
    bm_add_box(bm, (0.0, 0.0, z1), (w + 0.24, d + 0.24, 0.20), mats["trim_ivory"])
    bm_add_box(bm, (0.0, 0.0, z2 - 0.10), (w + 0.34, d + 0.34, 0.24), mats["trim_ivory"])
    if detail_lod0:
        for sign_y in (-1, 1):
            n_can = 14
            for k in range(n_can):
                cx = -hx + 0.35 + (k / (n_can - 1)) * (w - 0.7)
                bm_add_box(bm, (cx, sign_y * (hy + 0.20), z2 - 0.25), (0.14, 0.42, 0.18), mats["wood_cedar"])

    # 4. Sculpted 3D alternating corner stone quoins ("sillares en esquina") on all 4 vertical corners
    if detail_lod0:
        quoin_z = plinth_h + 0.24
        row = 0
        while quoin_z + 0.24 < z2 - 0.2:
            long_x = row % 2 == 0
            qx = 0.62 if long_x else 0.36
            qy = 0.36 if long_x else 0.62
            for sx in (-1, 1):
                for sy in (-1, 1):
                    bm_add_box(
                        bm,
                        (sx * (hx - qx * 0.45), sy * (hy - qy * 0.45), quoin_z),
                        (qx + 0.10, qy + 0.10, 0.40),
                        mats["plinth"],
                    )
            quoin_z += 0.48
            row += 1

    # 5. Signature Cáceres stepped 3rd-story corner Torreón (+X, -Y corner) + projecting enclosed Wood Mirador
    tw, td = 4.3, 4.3
    tcx = hx - tw * 0.5 + 0.12
    tcy = -hy + td * 0.5 - 0.12
    tz0 = z2
    tz1 = tz0 + 2.95

    # Torreón recessed arched-feel window pairs on front & right street faces
    t_hx, t_hy = tw * 0.5, td * 0.5
    p_tfl = Vector((tcx - t_hx, tcy - t_hy))
    p_tfr = Vector((tcx + t_hx, tcy - t_hy))
    p_tbr = Vector((tcx + t_hx, tcy + t_hy))
    p_tbl = Vector((tcx - t_hx, tcy + t_hy))
    for k in range(2):
        add_wall_panel_with_recessed_window(
            bm, p_tfl.lerp(p_tfr, k / 2), p_tfl.lerp(p_tfr, (k + 1) / 2), Vector((0.0, -1.0)),
            tz0, tz1, mats["wall_stone"], mats["plinth"], mats["glass_sky"],
            mats["wood_cedar"], mats["trim_ivory"], win_width_frac=0.46, sill_frac=0.22, head_frac=0.80,
            recess_depth=0.20, shutter_mat=None, has_mullions=detail_lod0,
        )
        add_wall_panel_with_recessed_window(
            bm, p_tfr.lerp(p_tbr, k / 2), p_tfr.lerp(p_tbr, (k + 1) / 2), Vector((1.0, 0.0)),
            tz0, tz1, mats["wall_stone"], mats["plinth"], mats["glass_sky"],
            mats["wood_cedar"], mats["trim_ivory"], win_width_frac=0.46, sill_frac=0.22, head_frac=0.80,
            recess_depth=0.20, shutter_mat=None, has_mullions=detail_lod0,
        )
    add_solid_wall_panel(bm, p_tbr, p_tbl, Vector((0.0, 1.0)), tz0, tz1, mats["wall_stone"])
    add_solid_wall_panel(bm, p_tbl, p_tfl, Vector((-1.0, 0.0)), tz0, tz1, mats["wall_stone"])
    bm_add_box(bm, (tcx, tcy, tz1 - 0.06), (tw + 0.30, td + 0.30, 0.18), mats["trim_ivory"])

    # Enclosed wooden/glass cantilevered Mirador attached onto Planta Noble right front corner (+X, -Y)
    mw, md_proj, mh = 1.85, 0.68, 2.75
    mcx = tcx
    mcy = -hy - md_proj * 0.5
    mzb = z1 + 0.20
    # Corbel under-deck
    bm_add_box(bm, (mcx, -hy - md_proj * 0.5, mzb), (mw + 0.14, md_proj + 0.10, 0.20), mats["trim_stone"])
    # Paneled wood apron & mullions & 3-sided glass + copper hip cap
    bm_add_box(bm, (mcx, mcy, mzb + 0.50), (mw, md_proj, 0.72), mats["wood_cedar"])
    bm_add_box(bm, (mcx, mcy, mzb + 1.62), (mw - 0.08, md_proj - 0.08, 1.56), mats["glass_sky"])
    for sx in (-1, 0, 1):
        bm_add_box(bm, (mcx + sx * (mw * 0.48), -hy - md_proj + 0.04, mzb + 1.62), (0.09, 0.09, 1.62), mats["wood_cedar"])
    for sx in (-1, 1):
        bm_add_box(bm, (mcx + sx * (mw * 0.48), -hy - 0.05, mzb + 1.62), (0.09, 0.09, 1.62), mats["wood_cedar"])
    # Stepped copper roof hood over mirador
    bm_add_box(bm, (mcx, mcy, mzb + mh - 0.15), (mw + 0.18, md_proj + 0.18, 0.14), mats["metal_copper"])
    bm_add_cylinder(bm, (mcx, mcy, mzb + mh + 0.12), mw * 0.65, 0.08, 0.42, 4, mats["metal_copper"], (0, 0, math.pi * 0.25))

    # 6. Pitched terracotta roof recessed cleanly flush into Torreón without protruding corner horn
    add_pitched_roof_with_ribs(
        bm, Vector((-0.35, 0.0)), w - 0.7, d, z2, 2.05, 0.45,
        roof_mat=mats["roof_terracotta"], rib_mat=mats["roof_ridge"],
        trim_mat=mats["wood_cedar"], wall_mat=mats["wall_lime"],
        ridge_along_x=True, rib_spacing=0.62, detailed_ribs=detail_lod0,
    )
    add_pitched_roof_with_ribs(
        bm, Vector((tcx, tcy)), tw, td, tz1, 1.45, 0.44,
        roof_mat=mats["roof_terracotta"], rib_mat=mats["roof_ridge"],
        trim_mat=mats["wood_cedar"], wall_mat=mats["wall_stone"],
        ridge_along_x=False, rib_spacing=0.58, detailed_ribs=detail_lod0,
    )

    # Stepped stone & brick chimney stack on rear roof slope
    ch_x, ch_y = -3.4, 1.4
    bm_add_box(bm, (ch_x, ch_y, z2 + 1.45), (0.92, 0.72, 2.2), mats["roof_terracotta"])
    bm_add_box(bm, (ch_x, ch_y, z2 + 2.60), (1.06, 0.86, 0.16), mats["trim_ivory"])
    for dx in (-0.22, 0.22):
        bm_add_cylinder(bm, (ch_x + dx, ch_y, z2 + 2.86), 0.12, 0.10, 0.36, 8, mats["roof_ridge"])

    # Side garden stone wall ("tapia cacereña") framing the left courtyard gate edge
    gw_x = -hx - 1.5
    bm_add_box(bm, (gw_x, 0.6, 1.25), (3.0, 0.42, 2.5), mats["wall_stone"])
    bm_add_box(bm, (gw_x, 0.6, 2.56), (3.12, 0.52, 0.14), mats["roof_terracotta"])
    bm_add_box(bm, (-hx - 2.95, 0.6, 1.40), (0.58, 0.58, 2.8), mats["plinth"])
    add_potted_shrub(bm, (-hx + 0.75, -hy - 0.55, 0.0), mats["plinth"], mats["foliage"], scale=0.85)

    return create_mesh_object(
        f"CasaHistorica_LOD{lod}",
        bm,
        mat_list,
        col,
        bevel_width=0.02 if detail_lod0 else 0.0,
        location=location,
    )
