"""Shared Stylized Low Poly PBR materials, sky lighting, and studio street staging."""

from __future__ import annotations

import math
import bpy
from mathutils import Euler


def hex_to_rgba(hex_str: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    """Convert #RRGGBB hex string into linear RGBA floats for Blender Principled BSDF."""
    s = hex_str.lstrip("#")
    r, g, b = (int(s[i : i + 2], 16) / 255.0 for i in (0, 2, 4))

    def to_linear(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (to_linear(r), to_linear(g), to_linear(b), alpha)


PALETTE_SPECS: dict[str, dict[str, object]] = {
    # Walls — vibrant sun-warmed Stylized Low Poly tones (zero muddy grey)
    "wall_casco_stone": {"color": "#E6CFA6", "roughness": 0.84, "metallic": 0.0},
    "wall_casco_lime": {"color": "#F5EFE3", "roughness": 0.86, "metallic": 0.0},
    "wall_casco_ochre": {"color": "#EAB97E", "roughness": 0.84, "metallic": 0.0},
    "wall_plinth_granite": {"color": "#9B8E7E", "roughness": 0.80, "metallic": 0.0},
    "wall_modern_sand": {"color": "#F0E4CE", "roughness": 0.78, "metallic": 0.0},
    "wall_modern_coral": {"color": "#E28364", "roughness": 0.78, "metallic": 0.0},
    "wall_modern_slate": {"color": "#7E94AB", "roughness": 0.74, "metallic": 0.0},
    "wall_chalet_peach": {"color": "#EEA989", "roughness": 0.84, "metallic": 0.0},
    "wall_shop_sage": {"color": "#8EB0A1", "roughness": 0.80, "metallic": 0.0},
    "wall_shop_cream": {"color": "#F6EDDA", "roughness": 0.80, "metallic": 0.0},
    "wall_palace_granite": {"color": "#DFCCA9", "roughness": 0.82, "metallic": 0.0},
    "wall_brick_terracotta": {"color": "#C96950", "roughness": 0.80, "metallic": 0.0},
    "wall_civic_limestone": {"color": "#F1E8D7", "roughness": 0.76, "metallic": 0.0},
    "accent_indigo": {"color": "#386BA3", "roughness": 0.76, "metallic": 0.0},
    "metal_bronze": {"color": "#735334", "roughness": 0.44, "metallic": 0.68},
    "nest_twig": {"color": "#6A4B2E", "roughness": 0.90, "metallic": 0.0},
    "roof_moss_tile": {"color": "#BA583B", "roughness": 0.79, "metallic": 0.0},
    # Trims, wood, iron, copper
    "trim_ivory": {"color": "#FAF4E8", "roughness": 0.72, "metallic": 0.0},
    "trim_stone_warm": {"color": "#D7CAB5", "roughness": 0.76, "metallic": 0.0},
    "trim_dark_concrete": {"color": "#626B78", "roughness": 0.72, "metallic": 0.04},
    "wood_cedar": {"color": "#633F2A", "roughness": 0.72, "metallic": 0.0},
    "wood_olive": {"color": "#355E44", "roughness": 0.68, "metallic": 0.0},
    "wood_cream": {"color": "#ECE4D6", "roughness": 0.70, "metallic": 0.0},
    "metal_iron": {"color": "#232830", "roughness": 0.42, "metallic": 0.72},
    "metal_steel": {"color": "#949EA8", "roughness": 0.36, "metallic": 0.80},
    "metal_gold_sign": {"color": "#D9A441", "roughness": 0.35, "metallic": 0.75},
    "metal_copper": {"color": "#5E7B71", "roughness": 0.55, "metallic": 0.45},
    # Roofs
    "roof_terracotta": {"color": "#CA6040", "roughness": 0.78, "metallic": 0.0},
    "roof_terracotta_ridge": {"color": "#DE7852", "roughness": 0.72, "metallic": 0.0},
    "roof_plum_slate": {"color": "#76565B", "roughness": 0.74, "metallic": 0.0},
    "roof_plum_rib": {"color": "#5E4347", "roughness": 0.68, "metallic": 0.05},
    "roof_gravel": {"color": "#CFCBC2", "roughness": 0.90, "metallic": 0.0},
    # Glass & awnings
    "glass_sky": {"color": "#2B78B8", "roughness": 0.08, "metallic": 0.22},
    "glass_frosted": {"color": "#6FB1DB", "roughness": 0.24, "metallic": 0.10},
    "glass_warm_shop": {
        "color": "#FFD07B",
        "roughness": 0.14,
        "metallic": 0.12,
        "emission": "#FFB54D",
        "emission_strength": 0.55,
    },
    "lamp_glow": {
        "color": "#FFF0BE",
        "roughness": 0.20,
        "metallic": 0.0,
        "emission": "#FFD479",
        "emission_strength": 2.4,
    },
    "awning_blue": {"color": "#2F6DB5", "roughness": 0.76, "metallic": 0.0},
    "awning_red": {"color": "#C94B38", "roughness": 0.76, "metallic": 0.0},
    "awning_cream": {"color": "#F7F3EA", "roughness": 0.78, "metallic": 0.0},
    # Foliage & terrain context
    "foliage_bright": {"color": "#54A842", "roughness": 0.80, "metallic": 0.0},
    "foliage_deep": {"color": "#2E7339", "roughness": 0.82, "metallic": 0.0},
    "flower_pink": {"color": "#E35D7A", "roughness": 0.75, "metallic": 0.0},
    "flower_gold": {"color": "#F0B93C", "roughness": 0.75, "metallic": 0.0},
    "bark": {"color": "#5B4030", "roughness": 0.88, "metallic": 0.0},
    "road_asphalt": {"color": "#2E333B", "roughness": 0.88, "metallic": 0.0},
    "road_marking": {"color": "#F2EDE0", "roughness": 0.78, "metallic": 0.0},
    "sidewalk_stone": {"color": "#D4CCB9", "roughness": 0.86, "metallic": 0.0},
    "curb_granite": {"color": "#9E978B", "roughness": 0.82, "metallic": 0.0},
    "grass_lawn": {"color": "#589D48", "roughness": 0.88, "metallic": 0.0},
}


def ensure_palette_materials() -> dict[str, bpy.types.Material]:
    """Create or fetch the shared Stylized Low Poly PBR materials."""
    mats: dict[str, bpy.types.Material] = {}
    for name, spec in PALETTE_SPECS.items():
        mat = bpy.data.materials.get(name) or bpy.data.materials.new(name=name)
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        bsdf = nodes.get("Principled BSDF")
        if bsdf is None:
            nodes.clear()
            bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
            out = nodes.new(type="ShaderNodeOutputMaterial")
            mat.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

        rgba = hex_to_rgba(str(spec["color"]))
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = float(spec["roughness"])
        bsdf.inputs["Metallic"].default_value = float(spec["metallic"])
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.45 if float(spec["roughness"]) < 0.3 else 0.28
        if "Emission Color" in bsdf.inputs and "emission" in spec:
            bsdf.inputs["Emission Color"].default_value = hex_to_rgba(str(spec["emission"]))
            bsdf.inputs["Emission Strength"].default_value = float(spec["emission_strength"])
        mats[name] = mat
    return mats


def configure_stylized_world_and_lighting(scene: bpy.types.Scene, gpu_optix: bool = True) -> None:
    """Set up golden-hour Spanish Stylized sunlight, bright sky dome, and AgX color grading."""
    scene.render.engine = "CYCLES"
    if gpu_optix:
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            prefs.compute_device_type = "OPTIX"
            prefs.get_devices()
            has_optix = False
            for d in prefs.devices:
                d.use = d.type == "OPTIX"
                if d.use:
                    has_optix = True
            scene.cycles.device = "GPU" if has_optix else "CPU"
        except Exception:
            scene.cycles.device = "CPU"
    else:
        scene.cycles.device = "CPU"

    scene.cycles.samples = 96
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 3

    scene.view_settings.view_transform = "AgX" if "AgX" in scene.view_settings.bl_rna.properties["view_transform"].enum_items else "Filmic"
    scene.view_settings.look = "AgX - Medium High Contrast" if scene.view_settings.view_transform == "AgX" else "None"
    scene.view_settings.exposure = -0.55

    # Warm blue Stylized sky gradient
    world = scene.world or bpy.data.worlds.new("StylizedSkyWorld")
    scene.world = world
    world.use_nodes = True
    wnodes = world.node_tree.nodes
    wlinks = world.node_tree.links
    wnodes.clear()

    w_out = wnodes.new("ShaderNodeOutputWorld")
    w_bg = wnodes.new("ShaderNodeBackground")
    w_bg.inputs["Strength"].default_value = 0.62
    sky = wnodes.new("ShaderNodeTexSky")
    enum_ids = {item.identifier for item in sky.bl_rna.properties["sky_type"].enum_items}
    sky.sky_type = "MULTIPLE_SCATTERING" if "MULTIPLE_SCATTERING" in enum_ids else "HOSEK_WILKIE"
    sky.sun_disc = False
    sky.sun_elevation = math.radians(34)
    sky.sun_rotation = math.radians(38)
    if hasattr(sky, "air_density"):
        sky.air_density = 1.15
    if hasattr(sky, "dust_density"):
        sky.dust_density = 1.0
    wlinks.new(sky.outputs["Color"], w_bg.inputs["Color"])
    wlinks.new(w_bg.outputs["Background"], w_out.inputs["Surface"])

    # Remove old lights
    for obj in list(bpy.data.objects):
        if obj.type == "LIGHT":
            bpy.data.objects.remove(obj, do_unlink=True)

    # Warm key Sun light at flattering 3/4 golden-afternoon angle hitting -Y (front) & +X (right)
    sun_data = bpy.data.lights.new(name="SunKey", type="SUN")
    sun_data.energy = 3.0
    sun_data.color = (1.0, 0.90, 0.76)
    sun_data.angle = math.radians(2.4)
    sun_obj = bpy.data.objects.new(name="SunKey", object_data=sun_data)
    sun_obj.rotation_euler = Euler((math.radians(52), math.radians(10), math.radians(-38)), "XYZ")
    scene.collection.objects.link(sun_obj)

    # Cool blue-violet sky bounce fill from opposite flank so shadow sides keep rich readability
    fill_data = bpy.data.lights.new(name="CoolRimFill", type="AREA")
    fill_data.energy = 520.0
    fill_data.color = (0.64, 0.80, 1.0)
    fill_data.size = 24.0
    fill_obj = bpy.data.objects.new(name="CoolRimFill", object_data=fill_data)
    fill_obj.location = (-22.0, -18.0, 14.0)
    fill_obj.rotation_euler = Euler((math.radians(65), 0.0, math.radians(-130)), "XYZ")
    scene.collection.objects.link(fill_obj)
