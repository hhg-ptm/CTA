"""Render and export all 8 System A Stylized Low Poly buildings in Blender 5.2 (Cycles OPTIX + 2-Material Atlas GLBs)."""

from __future__ import annotations

import json
import struct
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
from atlas import bake_object_to_shared_atlas, ensure_shared_atlas_materials
from hero_casco_house import build_hero_casco_house
from hero_casco_palace import build_hero_casco_palace
from hero_chalet import build_hero_chalet
from hero_civic_equipment import build_hero_civic_equipment
from hero_commercial import build_hero_commercial
from hero_extremadura_traditional import build_hero_extremadura_traditional
from hero_midrise_residential import build_hero_midrise_residential
from hero_modern_residential import build_hero_modern_residential
from lod2_proxies import build_hero_lod2
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

    bm_add_box(bm, (0.0, 12.0, -0.33), (320.0, 320.0, 0.30), 4)
    curb_y = street_y
    sidewalk_d = max(16.0, depth * 0.58)
    sidewalk_cy = curb_y + sidewalk_d * 0.5
    bm_add_box(bm, (0.0, sidewalk_cy, -0.09), (width, sidewalk_d, 0.18), 0)
    bm_add_box(bm, (0.0, curb_y - 0.12, -0.08), (width, 0.30, 0.20), 1)

    road_w = 7.6
    road_cy = curb_y - road_w * 0.5 - 0.26
    bm_add_box(bm, (0.0, road_cy, -0.14), (width + 64.0, road_w, 0.08), 2)
    opp_curb_y = road_cy - road_w * 0.5 - 0.14
    bm_add_box(bm, (0.0, opp_curb_y, -0.08), (width + 64.0, 0.30, 0.20), 1)
    bm_add_box(bm, (0.0, opp_curb_y - 4.5, -0.09), (width + 64.0, 9.0, 0.18), 0)

    n_dashes = int((width + 28.0) / 4.2)
    for k in range(n_dashes):
        dx = -(width + 24.0) * 0.5 + k * 4.2 + 1.0
        bm_add_box(bm, (dx, road_cy, -0.095), (1.85, 0.18, 0.015), 3)
    for cz_k in range(-3, 4):
        bm_add_box(bm, (-width * 0.24, road_cy + cz_k * 0.85, -0.095), (2.2, 0.42, 0.015), 3)

    if add_props:
        for lx in (-width * 0.34, width * 0.34):
            ly = curb_y + 0.55
            bm_add_cylinder(bm, (lx, ly, 1.85), 0.10, 0.06, 3.7, 8, 5)
            bm_add_box(bm, (lx, ly - 0.42, 3.62), (0.10, 0.85, 0.10), 5)
            bm_add_box(bm, (lx, ly - 0.78, 3.46), (0.28, 0.28, 0.28), 6)
            bm_add_box(bm, (lx, ly - 0.78, 3.63), (0.34, 0.34, 0.08), 5)
        bx = width * 0.37
        by = curb_y + 0.52
        bm_add_box(bm, (bx, by, 0.44), (1.55, 0.50, 0.07), 10)
        bm_add_box(bm, (bx, by + 0.22, 0.72), (1.55, 0.07, 0.42), 10)
        for sx in (-0.65, 0.65):
            bm_add_box(bm, (bx + sx, by, 0.22), (0.08, 0.48, 0.44), 5)

        add_stylized_tree(bm, (-width * 0.36, curb_y + 1.35, 0.0), 7, 8, kind="round", scale=1.05)
        add_stylized_tree(bm, (width * 0.42, curb_y + 1.35, 0.0), 7, 9, kind="cypress", scale=1.0)

    return create_mesh_object("StreetStage", bm, mat_list, col)


def _triangle_count(obj: bpy.types.Object) -> int:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(depsgraph)
    mesh = eval_obj.to_mesh()
    tris = sum(max(1, len(p.vertices) - 2) for p in mesh.polygons)
    eval_obj.to_mesh_clear()
    return tris


def _measure_above_ground_bounds(obj: bpy.types.Object) -> dict[str, float]:
    """Measure X width, Y depth (->Three.js Z), Z max height, and ground-plane center offset in meters."""
    verts = [v.co for v in obj.data.vertices if v.co.z >= -0.05]
    if not verts:
        verts = [v.co for v in obj.data.vertices]
    xs = [v.x for v in verts]
    ys = [v.y for v in verts]
    zs = [v.z for v in verts]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    max_z = max(zs)
    # In glTF Y-up export: X stays X, Three.js Z = -Blender Y
    return {
        "nominalWidthMeters": round(max_x - min_x, 3),
        "nominalDepthMeters": round(max_y - min_y, 3),
        "nominalHeightMeters": round(max_z, 3),
        "centerOffsetX": round((min_x + max_x) * 0.5, 3),
        "centerOffsetZ": round(-(min_y + max_y) * 0.5, 3),
    }


def _glb_material_count(glb_path: Path) -> int:
    data = glb_path.read_bytes()
    json_len = struct.unpack_from("<I", data, 12)[0]
    gltf_json = json.loads(data[20 : 20 + json_len].decode("utf-8"))
    return len(gltf_json.get("materials", []))


def _export_building_glb(obj: bpy.types.Object, out_path: Path) -> tuple[int, int]:
    """Export single atlas-consolidated building object cleanly to glTF 2.0 binary."""
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
    return out_path.stat().st_size, _glb_material_count(out_path)


def _setup_camera(scene: bpy.types.Scene, name: str = "EvalCam") -> tuple[bpy.types.Object, bpy.types.Camera]:
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = 38.0
    cam_obj = bpy.data.objects.new(name, cam_data)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj
    return cam_obj, cam_data


def main() -> None:
    out_dir = REPO_ROOT / "reports" / "blender_experiment"
    glb_dir = REPO_ROOT / "public" / "models" / "buildings"
    out_dir.mkdir(parents=True, exist_ok=True)
    glb_dir.mkdir(parents=True, exist_ok=True)

    materials = ensure_palette_materials()
    mat_opaque, mat_glass, atlas_coords = ensure_shared_atlas_materials(glb_dir)
    scene = bpy.context.scene
    configure_stylized_world_and_lighting(scene, gpu_optix=True)
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 900
    scene.render.image_settings.file_format = "PNG"

    specs = [
        {
            "key": "01_casco_house",
            "label": "Casa Histórica de Cáceres",
            "category": "casco_house",
            "floors": 2,
            "zoneAffinity": ["casco"],
            "builder": build_hero_casco_house,
            "export_kwargs": {"include_side_wall": False},
            "render_new": False,
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
            "category": "modern_residential",
            "floors": 6,
            "zoneAffinity": ["ensanche", "periferia"],
            "builder": build_hero_modern_residential,
            "export_kwargs": {},
            "render_new": False,
            "persp_cam": (27.5, -32.5, 21.5),
            "persp_target": (0.2, -0.5, 10.5),
            "street_cam": (11.8, -16.8, 2.0),
            "street_target": (-0.2, -2.0, 9.2),
            "stage_w": 44.0,
            "street_y": -7.8,
            "render_refresh": True,
        },
        {
            "key": "03_chalet",
            "label": "Chalet Unifamiliar con Jardín",
            "category": "chalet",
            "floors": 2,
            "zoneAffinity": ["periferia"],
            "builder": build_hero_chalet,
            "export_kwargs": {"include_garden": True},
            "render_new": False,
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
            "category": "commercial",
            "floors": 3,
            "zoneAffinity": ["ensanche", "casco", "periferia"],
            "builder": build_hero_commercial,
            "export_kwargs": {},
            "render_new": False,
            "persp_cam": (19.0, -23.0, 12.2),
            "persp_target": (-0.2, -1.2, 5.3),
            "street_cam": (8.6, -13.4, 1.9),
            "street_target": (-0.8, -2.0, 3.8),
            "stage_w": 38.0,
            "street_y": -6.8,
        },
        {
            "key": "05_extremadura_traditional",
            "label": "Casa Tradicional Extremeña",
            "category": "extremadura_traditional",
            "floors": 2,
            "zoneAffinity": ["casco", "periferia"],
            "builder": build_hero_extremadura_traditional,
            "export_kwargs": {"include_corral": True},
            "render_new": True,
            "persp_cam": (14.8, -19.2, 9.8),
            "persp_target": (0.0, -1.2, 3.4),
            "street_cam": (8.2, -12.8, 1.9),
            "street_target": (-0.6, -1.2, 2.8),
            "stage_w": 36.0,
            "street_y": -7.2,
        },
        {
            "key": "06_casco_palace",
            "label": "Palacio Histórico de Piedra del Casco Antiguo",
            "category": "casco_palace",
            "floors": 3,
            "zoneAffinity": ["casco"],
            "builder": build_hero_casco_palace,
            "export_kwargs": {},
            "render_new": True,
            "persp_cam": (23.0, -28.5, 15.8),
            "persp_target": (0.3, -0.6, 6.8),
            "street_cam": (10.6, -16.2, 2.0),
            "street_target": (-0.4, -1.2, 6.0),
            "stage_w": 42.0,
            "street_y": -7.6,
        },
        {
            "key": "07_midrise_residential",
            "label": "Bloque Residencial de Cuatro Plantas",
            "category": "midrise_residential",
            "floors": 4,
            "zoneAffinity": ["ensanche", "periferia"],
            "builder": build_hero_midrise_residential,
            "export_kwargs": {},
            "render_new": True,
            "persp_cam": (20.5, -25.0, 14.2),
            "persp_target": (0.0, -1.0, 6.4),
            "street_cam": (10.0, -15.2, 1.9),
            "street_target": (-0.2, -1.4, 5.4),
            "stage_w": 40.0,
            "street_y": -7.6,
        },
        {
            "key": "08_civic_equipment",
            "label": "Edificio Público / Equipamiento Singular",
            "category": "civic_equipment",
            "floors": 3,
            "zoneAffinity": ["casco", "ensanche", "periferia"],
            "builder": build_hero_civic_equipment,
            "export_kwargs": {},
            "render_new": True,
            "persp_cam": (22.0, -27.5, 14.0),
            "persp_target": (0.0, -1.6, 5.6),
            "street_cam": (11.2, -16.8, 2.0),
            "street_target": (0.0, -2.0, 4.8),
            "stage_w": 44.0,
            "street_y": -9.6,
        },
    ]

    telemetry: list[dict[str, object]] = []

    for spec in specs:
        # 1) LOD2 ultra-light skyline proxy baked to shared UV atlas & exported
        reset_scene()
        configure_stylized_world_and_lighting(scene, gpu_optix=True)
        materials = ensure_palette_materials()
        mat_opaque, mat_glass, atlas_coords = ensure_shared_atlas_materials(glb_dir)

        obj_lod2 = build_hero_lod2(spec["key"], materials)
        bake_object_to_shared_atlas(obj_lod2, mat_opaque, mat_glass, atlas_coords, apply_bevel=False)
        lod2_tris = _triangle_count(obj_lod2)
        lod2_bytes, lod2_mats = _export_building_glb(obj_lod2, glb_dir / f"{spec['key']}-lod2.glb")

        # 2) LOD1 mid-distance asset baked to shared UV atlas & exported
        reset_scene()
        configure_stylized_world_and_lighting(scene, gpu_optix=True)
        materials = ensure_palette_materials()
        mat_opaque, mat_glass, atlas_coords = ensure_shared_atlas_materials(glb_dir)

        obj_lod1 = spec["builder"](materials, lod=1, **spec["export_kwargs"])
        bake_object_to_shared_atlas(obj_lod1, mat_opaque, mat_glass, atlas_coords, apply_bevel=False)
        lod1_tris = _triangle_count(obj_lod1)
        lod1_bytes, lod1_mats = _export_building_glb(obj_lod1, glb_dir / f"{spec['key']}-lod1.glb")

        # 3) LOD0 crisp Stylized Low Poly hero exported without redundant micro-bevel bloat
        reset_scene()
        configure_stylized_world_and_lighting(scene, gpu_optix=True)
        materials = ensure_palette_materials()
        mat_opaque, mat_glass, atlas_coords = ensure_shared_atlas_materials(glb_dir)

        obj_lod0 = spec["builder"](materials, lod=0, **spec["export_kwargs"])
        bake_object_to_shared_atlas(obj_lod0, mat_opaque, mat_glass, atlas_coords, apply_bevel=False)
        bounds = _measure_above_ground_bounds(obj_lod0)
        lod0_tris = _triangle_count(obj_lod0)
        lod0_bytes, lod0_mats = _export_building_glb(obj_lod0, glb_dir / f"{spec['key']}-lod0.glb")

        if lod0_mats > 2 or lod1_mats > 2 or lod2_mats > 2:
            raise RuntimeError(f"Expected <= 2 atlas materials for {spec['key']}, got {lod0_mats}/{lod1_mats}/{lod2_mats}")

        persp_name = f"{spec['key']}_perspectiva.png"
        street_name = f"{spec['key']}_calle.png"

        # Render atlas-verified shots for all new models + refreshed palette checks
        if spec["render_new"] or spec.get("render_refresh") or spec["key"] == "01_casco_house":
            _build_street_stage(materials, width=spec["stage_w"], street_y=spec["street_y"], add_props=True)
            cam_obj, cam_data = _setup_camera(scene)

            cam_obj.location = spec["persp_cam"]
            cam_data.lens = 38.0
            _point_camera_at(cam_obj, spec["persp_target"])
            scene.render.filepath = str(out_dir / persp_name)
            scene.cycles.samples = 64
            bpy.ops.render.render(write_still=True)

            cam_obj.location = spec["street_cam"]
            cam_data.lens = 34.0
            _point_camera_at(cam_obj, spec["street_target"])
            scene.render.filepath = str(out_dir / street_name)
            bpy.ops.render.render(write_still=True)

        telemetry.append({
            "key": spec["key"],
            "label": spec["label"],
            "category": spec["category"],
            "floors": spec["floors"],
            "zoneAffinity": spec["zoneAffinity"],
            **bounds,
            "lod0Tris": lod0_tris,
            "lod1Tris": lod1_tris,
            "lod2Tris": lod2_tris,
            "lod0GlbBytes": lod0_bytes,
            "lod1GlbBytes": lod1_bytes,
            "lod2GlbBytes": lod2_bytes,
            "materialsCount": lod0_mats,
            "lod1MaterialsCount": lod1_mats,
            "lod2MaterialsCount": lod2_mats,
            "perspectiveRender": persp_name,
            "streetRender": street_name,
        })

    # 3) LOD1 Silhouette Audit Render (new 4 buildings + historic houses in LOD1 with baked UV atlas)
    reset_scene()
    configure_stylized_world_and_lighting(scene, gpu_optix=True)
    materials = ensure_palette_materials()
    mat_opaque, mat_glass, atlas_coords = ensure_shared_atlas_materials(glb_dir)
    for builder_fn, lx, kw in (
        (build_hero_extremadura_traditional, -26.0, {"include_corral": True}),
        (build_hero_casco_palace, -9.0, {}),
        (build_hero_midrise_residential, 9.0, {}),
        (build_hero_civic_equipment, 27.5, {}),
    ):
        o = builder_fn(materials, location=(lx, 0.0, 0.0), lod=1, **kw)
        bake_object_to_shared_atlas(o, mat_opaque, mat_glass, atlas_coords)
    _build_street_stage(materials, width=80.0, depth=38.0, street_y=-9.8, add_props=True)
    cam_obj, cam_data = _setup_camera(scene, "Lod1CompareCam")
    cam_obj.location = (44.0, -45.0, 22.0)
    cam_data.lens = 36.0
    _point_camera_at(cam_obj, (1.0, -1.0, 5.2))
    scene.cycles.samples = 64
    scene.render.filepath = str(out_dir / "09_lod1_silhouettes_4new.png")
    bpy.ops.render.render(write_still=True)

    # 4) Full 8-Building Stylized Low Poly Cáceres Avenue Showcase (Historic Quarter -> Ensanche)
    reset_scene()
    configure_stylized_world_and_lighting(scene, gpu_optix=True)
    materials = ensure_palette_materials()
    mat_opaque, mat_glass, atlas_coords = ensure_shared_atlas_materials(glb_dir)
    avenue = [
        (build_hero_extremadura_traditional, -50.0, 0.2, {"include_corral": True}),
        (build_hero_casco_house, -35.5, 0.4, {"include_side_wall": False}),
        (build_hero_casco_palace, -19.5, 0.0, {}),
        (build_hero_civic_equipment, 0.0, -0.2, {}),
        (build_hero_commercial, 18.0, 0.2, {}),
        (build_hero_midrise_residential, 34.0, 0.0, {}),
        (build_hero_modern_residential, 49.5, -0.4, {}),
        (build_hero_chalet, 68.0, 1.2, {"include_garden": True}),
    ]
    for builder_fn, ax, ay, kw in avenue:
        o = builder_fn(materials, location=(ax, ay, 0.0), lod=0, **kw)
        bake_object_to_shared_atlas(o, mat_opaque, mat_glass, atlas_coords)
    _build_street_stage(materials, width=146.0, depth=42.0, street_y=-10.2, add_props=True)
    cam_obj, cam_data = _setup_camera(scene, "LibraryAvenueCam")
    cam_obj.location = (64.0, -68.0, 28.0)
    cam_data.lens = 32.0
    _point_camera_at(cam_obj, (6.0, -1.0, 5.5))
    scene.cycles.samples = 72
    scene.render.filepath = str(out_dir / "10_all8_library_perspectiva.png")
    bpy.ops.render.render(write_still=True)

    cam_obj.location = (-32.0, -14.2, 2.2)
    cam_data.lens = 30.0
    _point_camera_at(cam_obj, (14.0, -1.5, 5.8))
    scene.render.filepath = str(out_dir / "10_all8_library_calle.png")
    bpy.ops.render.render(write_still=True)

    bpy.ops.wm.save_as_mainfile(filepath=str(out_dir / "caceres_8_library.blend"))

    manifest = {
        "schemaVersion": 2,
        "sharedAtlas": {
            "baseColorPng": "caceres_buildings_atlas.png",
            "metallicRoughnessPng": "caceres_buildings_mr.png",
            "emissivePng": "caceres_buildings_emissive.png",
            "opaqueMaterialName": "CC_Atlas_Opaque",
            "glassMaterialName": "CC_Atlas_Glass",
        },
        "models": telemetry,
    }
    (glb_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (out_dir / "telemetry.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("BLENDER_8LIB_COMPLETE:", json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
