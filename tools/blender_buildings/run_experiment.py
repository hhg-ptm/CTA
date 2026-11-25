"""Render and export experiment for the 4 hero buildings in Blender 5.2 (Cycles OPTIX + GLB)."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

THIS_DIR = Path(__file__).resolve().parent
REPO_ROOT = THIS_DIR.parent.parent
if str(THIS_DIR) not in sys.path:
    sys.path.insert(0, str(THIS_DIR))

from arch_helpers import (
    add_stylized_tree,
    bm_add_box,
    bm_add_cylinder,
    create_collection,
    create_mesh_object,
    reset_scene,
)
from hero_casco_house import build_hero_casco_house
from hero_chalet import build_hero_chalet
from hero_commercial import build_hero_commercial
from hero_modern_residential import build_hero_modern_residential
from materials import configure_stylized_world_and_lighting, ensure_palette_materials


def _point_camera_at(cam_obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - cam_obj.location
    rot_quat = direction.to_track_quat("-Z", "Y")
    cam_obj.rotation_euler = rot_quat.to_euler()


def _build_street_stage(
    materials: dict[str, bpy.types.Material],
    width: float = 42.0,
    depth: float = 34.0,
    street_y: float = -7.6,
    add_props: bool = True,
) -> bpy.types.Object:
    """Create stylized sidewalk + granite curb + asphalt street + crosswalk + streetlamps ground context."""
    col = create_collection("Stage_Context")
    mat_list = [
        materials["sidewalk_stone"],  # 0
        materials["curb_granite"],    # 1
        materials["road_asphalt"],    # 2
        materials["road_marking"],    # 3
        materials["grass_lawn"],      # 4
        materials["metal_iron"],      # 5
        materials["lamp_glow"],       # 6
        materials["bark"],            # 7
        materials["foliage_bright"],  # 8
        materials["foliage_deep"],    # 9
        materials["wood_cedar"],      # 10
    ]
    bm = bmesh.new()

    # Extended horizon ground plane cleanly BELOW road level (top at z = -0.18)
    bm_add_box(bm, (0.0, 12.0, -0.33), (280.0, 280.0, 0.30), 4)
    # Raised urban sidewalk block (top at z = 0.0, bottom z = -0.18)
    curb_y = street_y
    sidewalk_d = max(14.0, depth * 0.55)
    sidewalk_cy = curb_y + sidewalk_d * 0.5
    bm_add_box(bm, (0.0, sidewalk_cy, -0.09), (width, sidewalk_d, 0.18), 0)
    # Granite Curb strip along curb_y (top at z = +0.02)
    bm_add_box(bm, (0.0, curb_y - 0.12, -0.08), (width, 0.30, 0.20), 1)

    # Asphalt roadway strip (top at z = -0.10 -> cleanly above horizon grass -0.18!)
    road_w = 7.4
    road_cy = curb_y - road_w * 0.5 - 0.26
    bm_add_box(bm, (0.0, road_cy, -0.14), (width + 48.0, road_w, 0.08), 2)
    # Opposite sidewalk & curb framing street corridor cleanly
    opp_curb_y = road_cy - road_w * 0.5 - 0.14
    bm_add_box(bm, (0.0, opp_curb_y, -0.08), (width + 48.0, 0.30, 0.20), 1)
    bm_add_box(bm, (0.0, opp_curb_y - 4.5, -0.09), (width + 48.0, 9.0, 0.18), 0)

    # Crisp dashed centerline road markings + zebra pedestrian crossing (top z = -0.088)
    n_dashes = int((width + 24.0) / 4.2)
    for k in range(n_dashes):
        dx = -(width + 20.0) * 0.5 + k * 4.2 + 1.0
        bm_add_box(bm, (dx, road_cy, -0.095), (1.85, 0.18, 0.015), 3)
    for cz_k in range(-3, 4):
        bm_add_box(bm, (-width * 0.24, road_cy + cz_k * 0.85, -0.095), (2.2, 0.42, 0.015), 3)

    if add_props:
        # Stylish iron streetlights along curb + bench + lush flanking street trees
        for lx in (-width * 0.32, width * 0.32):
            ly = curb_y + 0.55
            bm_add_cylinder(bm, (lx, ly, 1.85), 0.10, 0.06, 3.7, 8, 5)
            bm_add_box(bm, (lx, ly - 0.42, 3.62), (0.10, 0.85, 0.10), 5)
            bm_add_box(bm, (lx, ly - 0.78, 3.46), (0.28, 0.28, 0.28), 6)
            bm_add_box(bm, (lx, ly - 0.78, 3.63), (0.34, 0.34, 0.08), 5)
        # Park bench cleanly clear of building lots along sidewalk curb
        bx = width * 0.35
        by = curb_y + 0.52
        bm_add_box(bm, (bx, by, 0.44), (1.55, 0.50, 0.07), 10)
        bm_add_box(bm, (bx, by + 0.22, 0.72), (1.55, 0.07, 0.42), 10)
        for sx in (-0.65, 0.65):
            bm_add_box(bm, (bx + sx, by, 0.22), (0.08, 0.48, 0.44), 5)

        add_stylized_tree(bm, (-width * 0.34, curb_y + 1.35, 0.0), 7, 8, kind="round", scale=1.05)
        add_stylized_tree(bm, (width * 0.40, curb_y + 1.35, 0.0), 7, 9, kind="cypress", scale=1.0)

    return create_mesh_object("StreetStage", bm, mat_list, col)


def _triangle_count(obj: bpy.types.Object) -> int:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(depsgraph)
    mesh = eval_obj.to_mesh()
    tris = sum(max(1, len(p.vertices) - 2) for p in mesh.polygons)
    eval_obj.to_mesh_clear()
    return tris


def _export_building_glb(obj: bpy.types.Object, out_path: Path) -> int:
    """Export single building object cleanly with glTF 2.0 Y-up transform + applied modifiers."""
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
    return out_path.stat().st_size


def main() -> None:
    out_dir = REPO_ROOT / "reports" / "blender_experiment"
    glb_dir = REPO_ROOT / "public" / "models" / "buildings"
    out_dir.mkdir(parents=True, exist_ok=True)
    glb_dir.mkdir(parents=True, exist_ok=True)

    materials = ensure_palette_materials()
    scene = bpy.context.scene
    configure_stylized_world_and_lighting(scene, gpu_optix=True)
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 900
    scene.render.image_settings.file_format = "PNG"

    specs = [
        {
            "key": "01_casco_house",
            "label": "Casa Histórica de Cáceres",
            "builder": build_hero_casco_house,
            "persp_cam": (14.5, -19.5, 10.5),
            "persp_target": (0.0, -1.5, 4.2),
            "street_cam": (8.5, -12.6, 1.9),
            "street_target": (-0.6, -1.5, 3.8),
            "stage_w": 36.0,
            "street_y": -6.2,
        },
        {
            "key": "02_modern_residential",
            "label": "Edificio Residencial Moderno",
            "builder": build_hero_modern_residential,
            "persp_cam": (26.5, -31.5, 20.8),
            "persp_target": (0.2, -0.5, 10.2),
            "street_cam": (11.8, -16.8, 2.0),
            "street_target": (-0.2, -2.0, 9.2),
            "stage_w": 44.0,
            "street_y": -7.8,
        },
        {
            "key": "03_chalet",
            "label": "Chalet Unifamiliar con Jardín",
            "builder": build_hero_chalet,
            "persp_cam": (18.5, -21.5, 10.2),
            "persp_target": (0.2, -1.5, 3.5),
            "street_cam": (9.8, -14.2, 1.9),
            "street_target": (-0.6, -1.8, 3.0),
            "stage_w": 40.0,
            "street_y": -7.8,
        },
        {
            "key": "04_commercial",
            "label": "Edificio Comercial con Escaparates",
            "builder": build_hero_commercial,
            "persp_cam": (19.0, -23.0, 12.2),
            "persp_target": (-0.2, -1.2, 5.3),
            "street_cam": (8.6, -13.4, 1.9),
            "street_target": (-0.8, -2.0, 3.8),
            "stage_w": 38.0,
            "street_y": -6.8,
        },
    ]

    telemetry: list[dict[str, object]] = []

    # 1. Individual Hero Renders + LOD0/LOD1 GLB Exports
    for spec in specs:
        reset_scene()
        configure_stylized_world_and_lighting(scene, gpu_optix=True)

        # Build & export LOD1 first cleanly, then replace with LOD0 for renders + GLB export
        obj_lod1 = spec["builder"](materials, lod=1)
        lod1_tris = _triangle_count(obj_lod1)
        lod1_bytes = _export_building_glb(obj_lod1, glb_dir / f"{spec['key']}-lod1.glb")

        reset_scene()
        configure_stylized_world_and_lighting(scene, gpu_optix=True)
        obj_lod0 = spec["builder"](materials, lod=0)
        lod0_tris = _triangle_count(obj_lod0)
        lod0_bytes = _export_building_glb(obj_lod0, glb_dir / f"{spec['key']}-lod0.glb")

        # Add clean stylized street & sidewalk diorama for evaluation renders
        _build_street_stage(materials, width=spec["stage_w"], street_y=spec["street_y"], add_props=True)

        cam_data = bpy.data.cameras.new("EvalCam")
        cam_data.lens = 38.0
        cam_obj = bpy.data.objects.new("EvalCam", cam_data)
        scene.collection.objects.link(cam_obj)
        scene.camera = cam_obj

        # Perspective view
        cam_obj.location = spec["persp_cam"]
        cam_data.lens = 38.0
        _point_camera_at(cam_obj, spec["persp_target"])
        persp_file = out_dir / f"{spec['key']}_perspectiva.png"
        scene.render.filepath = str(persp_file)
        bpy.ops.render.render(write_still=True)

        # Street level view
        cam_obj.location = spec["street_cam"]
        cam_data.lens = 34.0
        _point_camera_at(cam_obj, spec["street_target"])
        street_file = out_dir / f"{spec['key']}_calle.png"
        scene.render.filepath = str(street_file)
        bpy.ops.render.render(write_still=True)

        telemetry.append({
            "key": spec["key"],
            "label": spec["label"],
            "lod0Tris": lod0_tris,
            "lod1Tris": lod1_tris,
            "lod0GlbBytes": lod0_bytes,
            "lod1GlbBytes": lod1_bytes,
            "materialsCount": len(obj_lod0.data.materials),
            "perspectiveRender": persp_file.name,
            "streetRender": street_file.name,
        })

    # 2. Combined 4-Building Street Ensemble Showcase
    reset_scene()
    configure_stylized_world_and_lighting(scene, gpu_optix=True)
    build_hero_casco_house(materials, location=(-21.0, 0.5, 0.0), lod=0)
    build_hero_commercial(materials, location=(-6.5, 0.0, 0.0), lod=0)
    build_hero_modern_residential(materials, location=(8.5, -0.5, 0.0), lod=0)
    build_hero_chalet(materials, location=(26.0, 1.5, 0.0), lod=0, include_garden=True)
    _build_street_stage(materials, width=78.0, depth=38.0, street_y=-8.2, add_props=True)

    cam_data = bpy.data.cameras.new("EnsembleCam")
    cam_obj = bpy.data.objects.new("EnsembleCam", cam_data)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    cam_obj.location = (47.5, -42.5, 21.5)
    cam_data.lens = 35.0
    _point_camera_at(cam_obj, (2.5, -1.0, 5.5))
    scene.render.filepath = str(out_dir / "05_street_ensemble_perspectiva.png")
    bpy.ops.render.render(write_still=True)

    cam_obj.location = (-28.0, -11.5, 2.2)
    cam_data.lens = 32.0
    _point_camera_at(cam_obj, (8.0, -1.5, 5.0))
    scene.render.filepath = str(out_dir / "05_street_ensemble_calle.png")
    bpy.ops.render.render(write_still=True)

    # Save master ensemble .blend file cleanly
    bpy.ops.wm.save_as_mainfile(filepath=str(out_dir / "caceres_hero_ensemble.blend"))

    manifest = {"models": telemetry}
    (glb_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (out_dir / "telemetry.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("BLENDER_EXPERIMENT_COMPLETE:", json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
