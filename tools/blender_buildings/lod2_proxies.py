"""Ultra-lightweight Stylized Low Poly LOD2 architectural silhouette proxies (~80-220 tris each)."""

from __future__ import annotations

import math
import bmesh
import bpy
from mathutils import Vector

from arch_helpers import (
    add_pitched_roof_with_ribs,
    add_subplinth_foundation,
    bm_add_box,
    bm_add_cylinder,
    create_collection,
    create_mesh_object,
)


def _add_window_bands(
    bm: bmesh.types.BMesh,
    cx: float,
    cy: float,
    w: float,
    d: float,
    z_levels: list[float],
    glass_mat: int,
    warm_ground: bool = False,
    warm_mat: int = 0,
) -> None:
    """Add crisp flush-proud horizontal glass bands for long-distance horizon readability."""
    for idx, zc in enumerate(z_levels):
        gmat = warm_mat if (idx == 0 and warm_ground) else glass_mat
        bm_add_box(bm, (cx, cy, zc), (w + 0.04, d * 0.72, 1.35), gmat)
        bm_add_box(bm, (cx, cy, zc), (w * 0.74, d + 0.04, 1.35), gmat)


def build_hero_lod2(
    key: str,
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """Build ultra-light ~100-220-triangle stylized LOD2 silhouette keeping skyline identity."""
    col = create_collection(f"LOD2_{key}")
    bm = bmesh.new()

    if key == "01_casco_house":
        mat_list = [
            materials["wall_casco_stone"],
            materials["wall_casco_lime"],
            materials["wall_plinth_granite"],
            materials["roof_terracotta"],
            materials["roof_terracotta_ridge"],
            materials["trim_ivory"],
            materials["glass_sky"],
        ]
        add_subplinth_foundation(bm, (0.0, 0.0), 11.4, 8.2, 2)
        bm_add_box(bm, (0.0, 0.0, 2.0), (11.4, 8.2, 4.0), 0)
        bm_add_box(bm, (0.0, 0.0, 5.7), (11.4, 8.2, 3.4), 1)
        bm_add_box(bm, (3.2, 0.0, 8.5), (4.6, 5.2, 2.6), 0)
        _add_window_bands(bm, 0.0, 0.0, 11.4, 8.2, [2.1, 5.6], 6)
        add_pitched_roof_with_ribs(
            bm, Vector((-0.3, 0.0)), 10.8, 8.2, 7.4, 2.05, 0.42,
            roof_mat=3, rib_mat=4, trim_mat=5, wall_mat=1, ridge_along_x=True, detailed_ribs=False,
        )
        add_pitched_roof_with_ribs(
            bm, Vector((3.2, 0.0)), 4.6, 5.2, 9.8, 1.4, 0.40,
            roof_mat=3, rib_mat=4, trim_mat=5, wall_mat=0, ridge_along_x=False, detailed_ribs=False,
        )
    elif key == "02_modern_residential":
        mat_list = [
            materials["wall_modern_sand"],
            materials["wall_modern_coral"],
            materials["wall_modern_slate"],
            materials["trim_dark_concrete"],
            materials["trim_ivory"],
            materials["glass_sky"],
            materials["glass_warm_shop"],
        ]
        add_subplinth_foundation(bm, (-2.8, 0.0), 8.0, 10.6, 3)
        add_subplinth_foundation(bm, (3.9, 0.4), 5.8, 9.6, 3)
        bm_add_box(bm, (-2.8, 0.0, 9.65), (8.0, 10.6, 19.3), 0)
        bm_add_box(bm, (-2.8, 0.0, 11.5), (2.8, 10.7, 15.2), 1)
        bm_add_box(bm, (3.9, 0.4, 8.1), (5.8, 9.6, 16.2), 2)
        bm_add_box(bm, (-3.9, 1.4, 20.4), (3.4, 3.2, 2.3), 4)
        _add_window_bands(bm, -2.8, 0.0, 8.0, 10.6, [2.0, 5.4, 8.5, 11.6, 14.7, 17.8], 5, True, 6)
        _add_window_bands(bm, 3.9, 0.4, 5.8, 9.6, [2.0, 5.4, 8.5, 11.6, 14.7], 5, True, 6)
    elif key == "03_chalet":
        mat_list = [
            materials["wall_chalet_peach"],
            materials["wall_plinth_granite"],
            materials["roof_plum_slate"],
            materials["roof_plum_rib"],
            materials["trim_ivory"],
            materials["glass_sky"],
            materials["grass_lawn"],
        ]
        add_subplinth_foundation(bm, (-1.35, 0.65), 8.6, 7.0, 1)
        bm_add_box(bm, (0.25, -0.35, 0.04), (15.8, 12.6, 0.08), 6)
        bm_add_box(bm, (-1.35, 0.65, 3.05), (8.6, 7.0, 6.1), 0)
        bm_add_box(bm, (4.85, 1.85, 1.65), (3.8, 5.2, 3.3), 0)
        _add_window_bands(bm, -1.35, 0.65, 8.6, 7.0, [1.9, 4.7], 5)
        add_pitched_roof_with_ribs(
            bm, Vector((-1.35, 0.65)), 8.6, 7.0, 6.1, 2.4, 0.45,
            roof_mat=2, rib_mat=3, trim_mat=4, wall_mat=0, ridge_along_x=True, detailed_ribs=False,
        )
        add_pitched_roof_with_ribs(
            bm, Vector((4.85, 1.85)), 3.8, 5.2, 3.3, 1.45, 0.40,
            roof_mat=2, rib_mat=3, trim_mat=4, wall_mat=0, ridge_along_x=False, detailed_ribs=False,
        )
    elif key == "04_commercial":
        mat_list = [
            materials["trim_dark_concrete"],
            materials["wall_shop_sage"],
            materials["wall_shop_cream"],
            materials["awning_red"],
            materials["glass_sky"],
            materials["glass_warm_shop"],
        ]
        add_subplinth_foundation(bm, (0.0, 0.0), 12.8, 9.2, 0)
        bm_add_box(bm, (0.0, 0.0, 2.1), (12.8, 9.2, 4.2), 0)
        bm_add_box(bm, (0.0, 0.0, 5.8), (12.8, 9.2, 3.2), 1)
        bm_add_box(bm, (0.0, 0.0, 9.1), (12.8, 9.2, 3.4), 2)
        bm_add_box(bm, (0.0, -4.4, 11.4), (5.0, 0.5, 1.2), 1)
        bm_add_box(bm, (-3.6, -5.2, 3.2), (3.8, 1.3, 0.3), 3)
        _add_window_bands(bm, 0.0, 0.0, 12.8, 9.2, [2.1, 5.8, 8.9], 4, True, 5)
    elif key == "05_extremadura_traditional":
        mat_list = [
            materials["wall_casco_lime"],
            materials["wall_plinth_granite"],
            materials["accent_indigo"],
            materials["roof_terracotta"],
            materials["roof_terracotta_ridge"],
            materials["glass_sky"],
        ]
        add_subplinth_foundation(bm, (-1.55, 0.0), 7.8, 7.6, 1)
        bm_add_box(bm, (-1.55, 0.0, 2.95), (7.8, 7.6, 5.9), 0)
        bm_add_box(bm, (-1.55, 0.0, 0.65), (7.9, 7.7, 0.35), 2)
        bm_add_box(bm, (4.1, 0.4, 1.3), (3.55, 6.2, 2.6), 0)
        _add_window_bands(bm, -1.55, 0.0, 7.8, 7.6, [1.8, 4.6], 5)
        add_pitched_roof_with_ribs(
            bm, Vector((-1.55, 0.0)), 7.8, 7.6, 5.9, 2.25, 0.44,
            roof_mat=3, rib_mat=4, trim_mat=0, wall_mat=0, ridge_along_x=True, detailed_ribs=False,
        )
    elif key == "06_casco_palace":
        mat_list = [
            materials["wall_palace_granite"],
            materials["wall_plinth_granite"],
            materials["roof_moss_tile"],
            materials["roof_terracotta_ridge"],
            materials["trim_stone_warm"],
            materials["glass_sky"],
        ]
        add_subplinth_foundation(bm, (-1.9, 0.2), 10.6, 10.2, 1)
        add_subplinth_foundation(bm, (5.3, -2.5), 4.1, 4.4, 1)
        bm_add_box(bm, (-1.9, 0.2, 5.7), (10.6, 10.2, 11.4), 0)
        bm_add_box(bm, (5.3, -2.5, 7.6), (4.1, 4.4, 15.2), 0)
        bm_add_cylinder(bm, (5.3, -2.5, 15.8), 2.3, 0.22, 1.3, 4, 2, (0.0, 0.0, math.pi * 0.25))
        _add_window_bands(bm, -1.9, 0.2, 10.6, 10.2, [2.4, 6.2, 9.8], 5)
        add_pitched_roof_with_ribs(
            bm, Vector((-1.9, 0.2)), 10.6, 10.2, 11.4, 2.15, 0.42,
            roof_mat=2, rib_mat=3, trim_mat=4, wall_mat=0, ridge_along_x=True, detailed_ribs=False,
        )
    elif key == "07_midrise_residential":
        mat_list = [
            materials["wall_brick_terracotta"],
            materials["wall_modern_sand"],
            materials["trim_dark_concrete"],
            materials["trim_ivory"],
            materials["glass_sky"],
            materials["glass_warm_shop"],
        ]
        add_subplinth_foundation(bm, (0.0, 0.0), 13.8, 10.0, 2)
        bm_add_box(bm, (0.0, 0.0, 1.9), (13.8, 10.0, 3.8), 2)
        bm_add_box(bm, (0.0, 0.0, 8.4), (13.8, 10.0, 9.2), 0)
        bm_add_box(bm, (0.0, 0.0, 8.4), (4.2, 10.1, 9.1), 1)
        bm_add_box(bm, (3.2, 1.4, 14.1), (4.2, 3.6, 2.2), 3)
        _add_window_bands(bm, 0.0, 0.0, 13.8, 10.0, [2.0, 5.4, 8.4, 11.5], 4, True, 5)
    else:  # 08_civic_equipment
        mat_list = [
            materials["wall_civic_limestone"],
            materials["wall_plinth_granite"],
            materials["metal_copper"],
            materials["trim_ivory"],
            materials["glass_sky"],
            materials["glass_warm_shop"],
        ]
        add_subplinth_foundation(bm, (0.0, 0.0), 16.0, 10.6, 1)
        bm_add_box(bm, (0.0, 0.0, 4.6), (16.0, 10.6, 7.6), 0)
        bm_add_box(bm, (0.0, -0.3, 6.2), (7.2, 11.0, 10.8), 3)
        bm_add_box(bm, (0.0, 0.0, 8.5), (16.3, 10.9, 0.34), 2)
        bm_add_cylinder(bm, (0.0, 0.3, 12.2), 2.5, 0.18, 1.3, 4, 4, (0.0, 0.0, math.pi * 0.25))
        _add_window_bands(bm, 0.0, 0.0, 16.0, 10.6, [2.8, 6.4], 4)

    return create_mesh_object(f"{key}_LOD2", bm, mat_list, col, bevel_width=0.0)
