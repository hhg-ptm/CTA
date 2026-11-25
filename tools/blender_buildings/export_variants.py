"""Export the 4 architectural variant GLBs using the shared 2-material UV atlas and update manifest.json."""

from __future__ import annotations

import json
import math
import struct
import sys
from pathlib import Path

import bmesh
import bpy

THIS_DIR = Path(__file__).resolve().parent
REPO_ROOT = THIS_DIR.parent.parent
if str(THIS_DIR) not in sys.path:
    sys.path.insert(0, str(THIS_DIR))

from arch_helpers import (
    add_pitched_roof_with_ribs,
    add_subplinth_foundation,
    bm_add_box,
    create_collection,
    create_mesh_object,
    reset_scene,
)
from atlas import bake_object_to_shared_atlas, ensure_shared_atlas_materials
from hero_variants import (
    build_variant_lowrise_village,
    build_variant_midrise_attic,
    build_variant_midrise_gabled,
    build_variant_modern_setback,
)
from lod2_proxies import _add_window_bands
from materials import configure_stylized_world_and_lighting, ensure_palette_materials


def _build_variant_lod2(key: str, materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    from mathutils import Vector
    col = create_collection(f"LOD2_{key}")
    bm = bmesh.new()
    if key == "07b_midrise_gabled":
        mat_list = [
            materials["wall_shop_cream"],
            materials["wall_plinth_granite"],
            materials["roof_terracotta"],
            materials["roof_terracotta_ridge"],
            materials["trim_ivory"],
            materials["glass_sky"],
        ]
        add_subplinth_foundation(bm, (0.0, 0.0), 13.6, 10.2, 1)
        bm_add_box(bm, (0.0, 0.0, 1.8), (13.6, 10.2, 3.6), 1)
        bm_add_box(bm, (0.0, 0.0, 6.6), (13.6, 10.2, 6.0), 0)
        _add_window_bands(bm, 0.0, 0.0, 13.6, 10.2, [5.1, 8.0], 5)
        add_pitched_roof_with_ribs(
            bm, Vector((0.0, 0.0)), 13.6, 10.2, 9.6, 2.65, 0.45,
            roof_mat=2, rib_mat=3, trim_mat=4, wall_mat=0, ridge_along_x=True, detailed_ribs=False,
        )
    elif key == "07c_midrise_attic":
        mat_list = [
            materials["wall_casco_ochre"],
            materials["wall_modern_sand"],
            materials["trim_dark_concrete"],
            materials["trim_ivory"],
            materials["glass_sky"],
            materials["roof_gravel"],
        ]
        add_subplinth_foundation(bm, (0.0, 0.0), 14.2, 11.2, 2)
        bm_add_box(bm, (0.0, 0.0, 1.9), (14.2, 11.2, 3.8), 2)
        bm_add_box(bm, (0.0, 0.0, 8.4), (14.2, 11.2, 9.2), 0)
        bm_add_box(bm, (0.0, 0.4, 14.4), (10.2, 7.6, 2.9), 1)
        bm_add_box(bm, (0.0, 0.4, 15.9), (10.8, 8.2, 0.2), 3)
        _add_window_bands(bm, 0.0, 0.0, 14.2, 11.2, [5.3, 8.3, 11.3], 4)
    elif key == "02b_modern_setback":
        mat_list = [
            materials["wall_shop_cream"],
            materials["wall_shop_sage"],
            materials["trim_dark_concrete"],
            materials["trim_ivory"],
            materials["glass_sky"],
        ]
        add_subplinth_foundation(bm, (0.0, 0.0), 14.0, 11.4, 2)
        bm_add_box(bm, (0.0, 0.0, 1.9), (14.0, 11.4, 3.8), 2)
        bm_add_box(bm, (0.0, 0.0, 11.4), (14.0, 11.4, 15.2), 0)
        bm_add_box(bm, (2.2, 0.2, 20.5), (7.6, 8.8, 3.0), 1)
        _add_window_bands(bm, 0.0, 0.0, 14.0, 11.4, [5.3, 8.4, 11.4, 14.5, 17.5], 4)
    else:  # 05b_lowrise_village
        mat_list = [
            materials["wall_casco_ochre"],
            materials["wall_casco_lime"],
            materials["wall_plinth_granite"],
            materials["roof_terracotta"],
            materials["roof_terracotta_ridge"],
            materials["trim_ivory"],
            materials["glass_sky"],
        ]
        add_subplinth_foundation(bm, (0.0, 0.0), 10.6, 8.6, 2)
        bm_add_box(bm, (0.0, 0.0, 1.8), (10.6, 8.6, 3.4), 0)
        bm_add_box(bm, (0.0, 0.0, 4.6), (10.6, 8.6, 2.6), 1)
        _add_window_bands(bm, 0.0, 0.0, 10.6, 8.6, [1.8, 4.5], 6)
        add_pitched_roof_with_ribs(
            bm, Vector((0.0, 0.0)), 10.6, 8.6, 5.85, 1.75, 0.40,
            roof_mat=3, rib_mat=4, trim_mat=5, wall_mat=1, ridge_along_x=True, detailed_ribs=False,
        )
    return create_mesh_object(f"LOD2_{key}", bm, mat_list, col)


def _triangle_count(obj: bpy.types.Object) -> int:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(depsgraph)
    mesh = eval_obj.to_mesh()
    tris = sum(max(1, len(p.vertices) - 2) for p in mesh.polygons)
    eval_obj.to_mesh_clear()
    return tris


def _measure_bounds(obj: bpy.types.Object) -> dict[str, float]:
    verts = [v.co for v in obj.data.vertices if v.co.z >= -0.05] or [v.co for v in obj.data.vertices]
    xs = [v.x for v in verts]
    ys = [v.y for v in verts]
    zs = [v.z for v in verts]
    return {
        "nominalWidthMeters": round(max(xs) - min(xs), 3),
        "nominalDepthMeters": round(max(ys) - min(ys), 3),
        "nominalHeightMeters": round(max(zs), 3),
        "centerOffsetX": round((min(xs) + max(xs)) * 0.5, 3),
        "centerOffsetZ": round(-(min(ys) + max(ys)) * 0.5, 3),
    }


def _export_glb(obj: bpy.types.Object, out_path: Path) -> tuple[int, int]:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    out_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
    )
    data = out_path.read_bytes()
    jlen = struct.unpack_from("<I", data, 12)[0]
    mats = len(json.loads(data[20 : 20 + jlen].decode("utf-8")).get("materials", []))
    return out_path.stat().st_size, mats


def main() -> None:
    glb_dir = REPO_ROOT / "public" / "models" / "buildings"
    manifest_path = glb_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    scene = bpy.context.scene

    specs = [
        {
            "key": "07b_midrise_gabled",
            "label": "Bloque Residencial 3 Plantas Tejado Inclinado",
            "category": "midrise_residential_variant",
            "floors": 3,
            "builder": build_variant_midrise_gabled,
        },
        {
            "key": "07c_midrise_attic",
            "label": "Bloque Residencial 4 Plantas Ático Retranqueado",
            "category": "midrise_residential_variant",
            "floors": 4,
            "builder": build_variant_midrise_attic,
        },
        {
            "key": "02b_modern_setback",
            "label": "Torre Residencial Moderna Escalonada Verde/Gris",
            "category": "modern_residential_variant",
            "floors": 6,
            "builder": build_variant_modern_setback,
        },
        {
            "key": "05b_lowrise_village",
            "label": "Casa Baja Tradicional Ocre 1-2 Plantas",
            "category": "extremadura_traditional_variant",
            "floors": 2,
            "builder": build_variant_lowrise_village,
        },
    ]

    variant_entries = []
    for spec in specs:
        tris = {}
        bytes_map = {}
        mats_map = {}
        bounds = {}
        for lod in (2, 1, 0):
            reset_scene()
            configure_stylized_world_and_lighting(scene, gpu_optix=False)
            materials = ensure_palette_materials()
            mat_opaque, mat_glass, atlas_coords = ensure_shared_atlas_materials(glb_dir)
            if lod == 2:
                obj = _build_variant_lod2(spec["key"], materials)
            else:
                obj = spec["builder"](materials, lod=lod)
            bake_object_to_shared_atlas(obj, mat_opaque, mat_glass, atlas_coords, apply_bevel=False)
            if lod == 0:
                bounds = _measure_bounds(obj)
            tris[lod] = _triangle_count(obj)
            b, mc = _export_glb(obj, glb_dir / f"{spec['key']}-lod{lod}.glb")
            bytes_map[lod] = b
            mats_map[lod] = mc
            if mc > 2:
                raise RuntimeError(f"Expected <= 2 materials for {spec['key']} lod {lod}, got {mc}")

        variant_entries.append(
            {
                "key": spec["key"],
                "label": spec["label"],
                "category": spec["category"],
                "floors": spec["floors"],
                **bounds,
                "lod0Tris": tris[0],
                "lod1Tris": tris[1],
                "lod2Tris": tris[2],
                "lod0GlbBytes": bytes_map[0],
                "lod1GlbBytes": bytes_map[1],
                "lod2GlbBytes": bytes_map[2],
                "materialsCount": mats_map[0],
                "lod1MaterialsCount": mats_map[1],
                "lod2MaterialsCount": mats_map[2],
            }
        )

    manifest["variants"] = variant_entries
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("EXPORTED_VARIANTS:", json.dumps(variant_entries, indent=2))


if __name__ == "__main__":
    main()
