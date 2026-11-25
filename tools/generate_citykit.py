"""Generate the Stylized Low Poly Cáceres architectural, vegetation, and street CityKit GLBs.

Run with Blender 5.x in background mode:

    blender.exe --background --factory-startup --python tools/generate_citykit.py

Everything is authored procedurally in pure Python/bmesh with one shared compact
256x192 swatch atlas (`8x6` grid) so every GLB renders in a single draw call per
chunk via InstancedMesh. Zero external downloads or third-party licences.
"""

from __future__ import annotations

import json
import math
import struct
import tempfile
import zlib
from pathlib import Path

import bpy
import bmesh
from mathutils import Euler, Matrix

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "models" / "citykit"

ATLAS_W = 256
ATLAS_H = 192
ATLAS_COLS = 8
ATLAS_ROWS = 6

# Swatch coordinates (col, row) with row 0 at bottom in UV space.
SW_GRANITE = (0, 0)         # Warm Cáceres honey granite ashlar
SW_DARK_STONE = (1, 0)      # Dark granite plinth / slate
SW_IRON = (2, 0)            # Forged wrought iron
SW_SHUTTER_GREEN = (3, 0)   # Historic olive/forest wooden shutter
SW_WOOD = (4, 0)            # Warm walnut / oak timber
SW_TILE = (5, 0)            # Terracotta barrel roof tile
SW_PLASTER_WHITE = (6, 0)   # Warm limewashed stucco
SW_OCHRE = (7, 0)           # Sunny sandstone / ochre render

SW_GLASS = (0, 1)           # Vibrant stylized cobalt-sky window glass
SW_GLASS_WARM = (1, 1)      # Warm amber interior shopfront glass
SW_CONCRETE = (2, 1)        # Crisp architectural concrete / stone sill
SW_STEEL = (3, 1)           # Brushed HVAC / galvanized steel
SW_BRASS = (4, 1)           # Bronze bell / knockers / hardware
SW_AWNING_RED = (5, 1)      # Burgundy-cream striped café awning
SW_AWNING_GREEN = (6, 1)    # Forest-cream striped shop awning
SW_PERSIANA = (7, 1)        # Slatted roller shutter

SW_BRICK = (0, 2)           # Spanish red exposed brick
SW_AWNING_MUSTARD = (1, 2)  # Mustard-cream striped awning
SW_ROLL_DOOR = (2, 2)       # Ribbed industrial shutter door
SW_LEAVES_DARK = (3, 2)     # Holm oak / Mediterranean deep olive foliage
SW_LEAVES_LIGHT = (4, 2)    # Sunlit olive/oak canopy foliage
SW_BARK = (5, 2)            # Grooved tree bark
SW_LAMP_GLOW = (6, 2)       # Warm glowing lantern glass
SW_SIGN_RED = (7, 2)        # Traffic sign red

SW_SIGN_WHITE = (0, 3)      # Traffic sign white
SW_SIGN_YELLOW = (1, 3)     # Signal amber
SW_SIGN_GREEN = (2, 3)      # Signal green
SW_TERRACOTTA = (3, 3)      # Warm sienna terracotta plaster
SW_CREAM_STONE = (4, 3)     # Light limestone trim / voussoirs
SW_COPPER = (5, 3)          # Patinated copper / dark bronze
SW_SAFETY_YELLOW = (6, 3)   # Industrial bumper yellow
SW_CHARCOAL = (7, 3)        # Deep anodized window frame

SW_AWNING_BLUE = (0, 4)     # Stylized cobalt-cream striped window awning
SW_LEAVES_PINE = (1, 4)     # Vibrant stylized emerald pine green
SW_LEAVES_FRESH = (2, 4)    # Sunlit fresh green deciduous canopy
SW_LEAVES_CYPRESS = (3, 4)  # Deep upright cypress conifer green
SW_LEAVES_PALM = (4, 4)     # Warm chartreuse palm frond green
SW_LEAVES_SHRUB = (5, 4)    # Bright meadow green shrub / hedge foliage
SW_SOLAR_PANEL = (6, 4)     # Photovoltaic cell dark navy grid
SW_WATER = (7, 4)           # Stylized azure fountain water

SW_BUS_BLUE = (0, 5)        # Transit blue shelter fascia
SW_BENCH_WOOD = (1, 5)      # Warm golden cedar bench slats
SW_SLATE_BLUE = (2, 5)      # Cool blue-grey window accent & metal coping
SW_ASH_DARK = (3, 5)        # Deep charcoal bin / street metal
SW_SOIL_MULCH = (4, 5)      # Earth bed / planter base
SW_FROSTED_GLASS = (5, 5)   # Pale sky-tinted frosted balcony glass
SW_TERRACOTTA_CAP = (6, 5)  # Deep roasted ridge / chimney pot clay
SW_LIGHT_CONCRETE = (7, 5)  # Bright concrete step / sidewalk border


def _cell_rgb(col: int, row: int, u: float, v: float, seed: int) -> tuple[float, float, float]:
    rng = ((seed * 1103515245 + 12345) >> 16) & 255
    grain = (rng / 255.0 - 0.5) * 0.04
    key = (col, row)

    if key == SW_GRANITE:
        # Clean Stylized granite ashlar wash without harsh dark grid noise
        band = -0.025 if int(v * 3) % 2 == 0 else 0.025
        base = (0.83 + band, 0.75 + band, 0.60 + band)
        return (base[0] + grain * 0.4, base[1] + grain * 0.4, base[2] + grain * 0.4)
    if key == SW_DARK_STONE:
        return (0.34 + grain * 0.4, 0.33 + grain * 0.4, 0.31 + grain * 0.4)
    if key == SW_IRON:
        return (0.15 + grain * 0.2, 0.16 + grain * 0.2, 0.19 + grain * 0.2)
    if key == SW_SHUTTER_GREEN:
        slat = -0.03 if int(v * 10) % 2 == 0 else 0.03
        return (0.21 + slat, 0.44 + slat, 0.28 + slat * 0.5)
    if key == SW_WOOD:
        streak = -0.025 if int(u * 6) % 2 == 0 else 0.025
        return (0.48 + streak, 0.30 + streak * 0.7, 0.17 + streak * 0.4)
    if key == SW_TILE:
        rib = math.sin(u * math.pi * 6.0) * 0.04
        return (0.82 + rib + grain * 0.5, 0.41 + rib * 0.5, 0.24)
    if key == SW_PLASTER_WHITE:
        return (0.96 + grain * 0.2, 0.93 + grain * 0.2, 0.87 + grain * 0.2)
    if key == SW_OCHRE:
        return (0.90 + grain * 0.3, 0.74 + grain * 0.3, 0.49 + grain * 0.2)
    if key == SW_GLASS:
        sheen = 0.24 if (0.18 < (u + v) * 0.5 < 0.36 or 0.54 < (u + v) * 0.5 < 0.64) else 0.0
        grad = (1.0 - v) * 0.12
        return (0.19 + sheen + grad * 0.6, 0.49 + sheen + grad, 0.74 + sheen + grad * 1.1)
    if key == SW_GLASS_WARM:
        sheen = 0.22 if 0.22 < (u + v) * 0.5 < 0.38 else 0.0
        warm = 0.34 * (1.0 - v)
        return (0.58 + warm + sheen, 0.49 + warm * 0.75 + sheen, 0.36 + sheen * 0.8)
    if key == SW_CONCRETE:
        return (0.86 + grain * 0.2, 0.83 + grain * 0.2, 0.78 + grain * 0.2)
    if key == SW_STEEL:
        rib = 0.03 if int(v * 8) % 2 == 0 else -0.02
        return (0.68 + rib, 0.71 + rib, 0.75 + rib)
    if key == SW_BRASS:
        return (0.88, 0.68, 0.28)
    if key in (SW_AWNING_RED, SW_AWNING_GREEN, SW_AWNING_MUSTARD, SW_AWNING_BLUE):
        stripe = int(u * 8) % 2 == 0
        if stripe:
            return (0.97, 0.94, 0.88)
        if key == SW_AWNING_RED:
            return (0.76, 0.20, 0.20)
        if key == SW_AWNING_GREEN:
            return (0.18, 0.50, 0.28)
        if key == SW_AWNING_BLUE:
            return (0.20, 0.44, 0.78)
        return (0.88, 0.65, 0.18)
    if key == SW_PERSIANA:
        slat = -0.05 if int(v * 12) % 2 == 0 else 0.04
        return (0.66 + slat, 0.63 + slat, 0.58 + slat)
    if key == SW_BRICK:
        return (0.74 + grain * 0.3, 0.35 + grain * 0.2, 0.23 + grain * 0.2)
    if key == SW_ROLL_DOOR:
        rib = -0.06 if int(v * 14) % 2 == 0 else 0.05
        return (0.58 + rib, 0.62 + rib, 0.66 + rib)
    if key == SW_LEAVES_DARK:
        return (0.20 + grain * 0.7, 0.38 + grain * 0.7, 0.16 + grain * 0.5)
    if key == SW_LEAVES_LIGHT:
        return (0.34 + grain * 0.7, 0.52 + grain * 0.7, 0.22 + grain * 0.5)
    if key == SW_BARK:
        streak = -0.04 if int(u * 8) % 2 == 0 else 0.03
        return (0.34 + streak, 0.24 + streak * 0.7, 0.15 + streak * 0.4)
    if key == SW_LAMP_GLOW:
        return (1.00, 0.90, 0.58)
    if key == SW_SIGN_RED:
        return (0.78, 0.16, 0.14)
    if key == SW_SIGN_WHITE:
        return (0.96, 0.95, 0.90)
    if key == SW_SIGN_YELLOW:
        return (0.94, 0.72, 0.16)
    if key == SW_SIGN_GREEN:
        return (0.20, 0.62, 0.28)
    if key == SW_TERRACOTTA:
        return (0.79 + grain * 0.4, 0.43 + grain * 0.3, 0.28 + grain * 0.3)
    if key == SW_CREAM_STONE:
        return (0.89 + grain * 0.3, 0.83 + grain * 0.3, 0.70 + grain * 0.3)
    if key == SW_COPPER:
        return (0.36, 0.50, 0.42)
    if key == SW_SAFETY_YELLOW:
        return (0.92, 0.72, 0.12)
    if key == SW_CHARCOAL:
        return (0.22, 0.25, 0.28)
    if key == SW_LEAVES_PINE:
        return (0.18 + grain * 0.5, 0.52 + grain * 0.6, 0.22 + grain * 0.4)
    if key == SW_LEAVES_FRESH:
        return (0.34 + grain * 0.5, 0.66 + grain * 0.6, 0.24 + grain * 0.4)
    if key == SW_LEAVES_CYPRESS:
        return (0.14 + grain * 0.4, 0.34 + grain * 0.5, 0.17 + grain * 0.4)
    if key == SW_LEAVES_PALM:
        return (0.38 + grain * 0.5, 0.60 + grain * 0.5, 0.20 + grain * 0.4)
    if key == SW_LEAVES_SHRUB:
        return (0.28 + grain * 0.5, 0.58 + grain * 0.5, 0.22 + grain * 0.4)
    if key == SW_SOLAR_PANEL:
        grid = (u * 4) % 1.0 < 0.08 or (v * 6) % 1.0 < 0.08
        return (0.62, 0.68, 0.74) if grid else (0.12, 0.21, 0.42)
    if key == SW_WATER:
        wave = math.sin((u + v) * math.pi * 4.0) * 0.05
        return (0.24 + wave, 0.62 + wave, 0.84 + wave * 0.5)
    if key == SW_BUS_BLUE:
        return (0.18, 0.39, 0.68)
    if key == SW_BENCH_WOOD:
        slat = -0.05 if int(v * 6) % 2 == 0 else 0.03
        return (0.64 + slat, 0.40 + slat * 0.7, 0.20 + slat * 0.4)
    if key == SW_SLATE_BLUE:
        return (0.34, 0.42, 0.50)
    if key == SW_ASH_DARK:
        return (0.19, 0.21, 0.23)
    if key == SW_SOIL_MULCH:
        return (0.32 + grain, 0.23 + grain, 0.16 + grain)
    if key == SW_FROSTED_GLASS:
        return (0.66, 0.79, 0.87)
    if key == SW_TERRACOTTA_CAP:
        return (0.58, 0.27, 0.17)
    return (0.87, 0.85, 0.80)


def _encode_png_rgba(width: int, height: int, rgba_rows_top_down: bytes) -> bytes:
    stride = width * 4
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        start = y * stride
        raw.extend(rgba_rows_top_down[start : start + stride])

    def chunk(tag: bytes, payload: bytes) -> bytes:
        body = tag + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), level=9)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def _build_atlas_png_bytes() -> bytes:
    cell_w = ATLAS_W // ATLAS_COLS
    cell_h = ATLAS_H // ATLAS_ROWS
    buf = bytearray(ATLAS_W * ATLAS_H * 4)
    for png_y in range(ATLAS_H):
        uv_y = ATLAS_H - 1 - png_y
        row = uv_y // cell_h
        v = (uv_y % cell_h) / max(1, cell_h - 1)
        for px in range(ATLAS_W):
            col = px // cell_w
            u = (px % cell_w) / max(1, cell_w - 1)
            r, g, b = _cell_rgb(col, row, u, v, uv_y * 313 + px * 97 + col * 17)
            idx = (png_y * ATLAS_W + px) * 4
            buf[idx] = int(max(0.0, min(1.0, r)) * 255.0 + 0.5)
            buf[idx + 1] = int(max(0.0, min(1.0, g)) * 255.0 + 0.5)
            buf[idx + 2] = int(max(0.0, min(1.0, b)) * 255.0 + 0.5)
            buf[idx + 3] = 255
    return _encode_png_rgba(ATLAS_W, ATLAS_H, bytes(buf))


def create_atlas_material(atlas_png_path: Path) -> bpy.types.Material:
    mat = bpy.data.materials.get("kit_atlas")
    if mat is not None:
        return mat
    img = bpy.data.images.load(str(atlas_png_path), check_existing=True)
    img.name = "kit_atlas"
    img.colorspace_settings.name = "sRGB"
    img.pack()

    mat = bpy.data.materials.new(name="kit_atlas")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    if bsdf is not None:
        bsdf.inputs["Roughness"].default_value = 0.65
        bsdf.inputs["Metallic"].default_value = 0.06
        tex_node = nodes.new("ShaderNodeTexImage")
        tex_node.image = img
        tex_node.interpolation = "Closest"
        links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for item in list(bpy.data.meshes):
        if item.users == 0:
            bpy.data.meshes.remove(item)


def cell_uv_bounds(cell: tuple[int, int]) -> tuple[float, float, float, float]:
    col, row = cell
    pad_u = 0.012
    pad_v = 0.015
    u0 = col / ATLAS_COLS + pad_u
    u1 = (col + 1) / ATLAS_COLS - pad_u
    v0 = row / ATLAS_ROWS + pad_v
    v1 = (row + 1) / ATLAS_ROWS - pad_v
    return u0, u1, v0, v1


def _assign_cell_uvs(bm: bmesh.types.BMesh, faces: list[bmesh.types.BMFace],
                     uv_layer: bmesh.types.BMLayerItem, cell: tuple[int, int]) -> None:
    u0, u1, v0, v1 = cell_uv_bounds(cell)
    for face in faces:
        n = len(face.loops)
        if n == 4:
            coords = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        else:
            coords = [
                (
                    u0 + (u1 - u0) * (0.5 + 0.44 * math.cos(2.0 * math.pi * i / n)),
                    v0 + (v1 - v0) * (0.5 + 0.44 * math.sin(2.0 * math.pi * i / n)),
                )
                for i in range(n)
            ]
        for loop, uv in zip(face.loops, coords):
            loop[uv_layer].uv = uv


def add_box(bm: bmesh.types.BMesh, uv_layer: bmesh.types.BMLayerItem,
            center: tuple[float, float, float], size: tuple[float, float, float],
            cell: tuple[int, int], rot: tuple[float, float, float] = (0.0, 0.0, 0.0)) -> None:
    mat = (
        Matrix.Translation(center)
        @ Euler(rot, "XYZ").to_matrix().to_4x4()
        @ Matrix.Diagonal((*size, 1.0))
    )
    res = bmesh.ops.create_cube(bm, size=1.0, matrix=mat)
    verts = set(res["verts"])
    faces = [f for f in bm.faces if all(v in verts for v in f.verts)]
    _assign_cell_uvs(bm, faces, uv_layer, cell)


def add_cylinder(bm: bmesh.types.BMesh, uv_layer: bmesh.types.BMLayerItem,
                 center: tuple[float, float, float], radius1: float, radius2: float,
                 depth: float, segments: int, cell: tuple[int, int],
                 rot: tuple[float, float, float] = (0.0, 0.0, 0.0)) -> None:
    mat = Matrix.Translation(center) @ Euler(rot, "XYZ").to_matrix().to_4x4()
    res = bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments,
        radius1=radius1, radius2=radius2, depth=depth, matrix=mat,
    )
    verts = set(res["verts"])
    faces = [f for f in bm.faces if all(v in verts for v in f.verts)]
    _assign_cell_uvs(bm, faces, uv_layer, cell)


def add_ico(bm: bmesh.types.BMesh, uv_layer: bmesh.types.BMLayerItem,
            center: tuple[float, float, float], radius: float, subdivisions: int,
            cell: tuple[int, int], scale: tuple[float, float, float] = (1.0, 1.0, 1.0)) -> None:
    mat = Matrix.Translation(center) @ Matrix.Diagonal((*scale, 1.0))
    res = bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius, matrix=mat)
    verts = set(res["verts"])
    faces = [f for f in bm.faces if all(v in verts for v in f.verts)]
    _assign_cell_uvs(bm, faces, uv_layer, cell)


def export_bmesh(name: str, bm: bmesh.types.BMesh, atlas_path: Path,
                 manifest: dict[str, dict[str, object]]) -> None:
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    sharp_edges = [e for e in bm.edges if e.calc_face_angle(0.0) > math.radians(36.0)]
    if sharp_edges:
        bmesh.ops.split_edges(bm, edges=sharp_edges)
    bmesh.ops.triangulate(bm, faces=bm.faces)

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(create_atlas_material(atlas_path))

    triangles = len(mesh.polygons)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    path = OUT_DIR / f"{name}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_image_format="AUTO",
    )
    manifest[name] = {
        "path": f"models/citykit/{name}.glb",
        "triangles": triangles,
        "bytes": path.stat().st_size,
    }
    print(f"[citykit] {name}: {triangles} tris, {path.stat().st_size} bytes")


# ---------------------------------------------------------------------------
# Street Furniture & Vegetation Variants (Stylized Low Poly Cáceres)
# ---------------------------------------------------------------------------

def build_street_lamp(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    sides = 8 if lod == 0 else 5
    add_cylinder(bm, uv, (0, 0, 0.24), 0.24, 0.17, 0.48, sides, SW_IRON)
    add_cylinder(bm, uv, (0, 0, 2.05), 0.075, 0.05, 3.2, sides, SW_IRON)
    add_cylinder(bm, uv, (0, 0, 3.68), 0.08, 0.15, 0.14, sides, SW_IRON)
    add_cylinder(bm, uv, (0, 0, 3.98), 0.15, 0.23, 0.48, 4, SW_LAMP_GLOW, (0, 0, math.pi / 4))
    add_cylinder(bm, uv, (0, 0, 4.33), 0.28, 0.02, 0.25, 4, SW_IRON, (0, 0, math.pi / 4))


def build_street_lamp_modern(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    sides = 6 if lod == 0 else 4
    add_cylinder(bm, uv, (0, 0, 0.25), 0.16, 0.13, 0.5, sides, SW_CHARCOAL)
    add_cylinder(bm, uv, (0, 0, 2.55), 0.085, 0.06, 4.2, sides, SW_CHARCOAL)
    add_box(bm, uv, (0, -0.52, 4.72), (0.12, 1.15, 0.11), SW_CHARCOAL, (0.12, 0, 0))
    add_box(bm, uv, (0, -1.04, 4.76), (0.30, 0.48, 0.10), SW_SLATE_BLUE)
    add_box(bm, uv, (0, -1.04, 4.70), (0.24, 0.40, 0.04), SW_LAMP_GLOW)


def build_tree_deciduous(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    sides = 7 if lod == 0 else 5
    add_cylinder(bm, uv, (0, 0, 1.55), 0.32, 0.19, 3.10, sides, SW_BARK)
    add_cylinder(bm, uv, (0.40, 0, 2.95), 0.11, 0.06, 1.35, 5, SW_BARK, (0, 0.62, 0))
    add_cylinder(bm, uv, (-0.36, 0.10, 2.88), 0.11, 0.06, 1.25, 5, SW_BARK, (0, -0.62, 0))
    detail = 2 if lod == 0 else 1
    add_ico(bm, uv, (0, 0, 4.55), 1.85, detail, SW_LEAVES_FRESH, (1.06, 1.02, 0.92))
    add_ico(bm, uv, (0.92, 0.24, 4.02), 1.24, detail, SW_LEAVES_LIGHT)
    add_ico(bm, uv, (-0.82, -0.34, 4.12), 1.18, detail, SW_LEAVES_FRESH)
    if lod == 0:
        add_ico(bm, uv, (0.08, 0.14, 5.70), 1.08, detail, SW_LEAVES_SHRUB)


def build_tree_oak(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    # Broad umbrella Mediterranean holm oak ("encina extremeña")
    sides = 7 if lod == 0 else 5
    add_cylinder(bm, uv, (0, 0, 1.35), 0.38, 0.24, 2.70, sides, SW_BARK)
    add_cylinder(bm, uv, (0.64, 0.14, 2.55), 0.14, 0.07, 1.55, 5, SW_BARK, (-0.2, 0.75, 0))
    add_cylinder(bm, uv, (-0.60, -0.22, 2.50), 0.14, 0.07, 1.48, 5, SW_BARK, (0.2, -0.75, 0))
    detail = 2 if lod == 0 else 1
    add_ico(bm, uv, (0, 0, 4.05), 2.15, detail, SW_LEAVES_DARK, (1.28, 1.18, 0.68))
    add_ico(bm, uv, (1.12, 0.28, 3.65), 1.42, detail, SW_LEAVES_LIGHT, (1.15, 1.10, 0.75))
    add_ico(bm, uv, (-1.05, -0.34, 3.72), 1.36, detail, SW_LEAVES_DARK, (1.15, 1.10, 0.75))
    if lod == 0:
        add_ico(bm, uv, (0.0, 0.18, 4.82), 1.30, 1, SW_LEAVES_LIGHT, (1.2, 1.05, 0.65))


def build_tree_pine(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    # Tall tiered Stylized Low Poly cone silhouette (matches foreground pines in Reference)
    sides = 7 if lod == 0 else 5
    add_cylinder(bm, uv, (0, 0, 1.15), 0.28, 0.17, 2.30, sides, SW_BARK)
    add_cylinder(bm, uv, (0, 0, 2.75), 1.85, 0.24, 2.25, sides, SW_LEAVES_PINE)
    add_cylinder(bm, uv, (0, 0, 4.20), 1.46, 0.18, 2.05, sides, SW_LEAVES_SHRUB)
    add_cylinder(bm, uv, (0, 0, 5.52), 1.02, 0.04, 1.85, sides, SW_LEAVES_PINE)


def build_tree_palm(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    # Tall curved Cáceres boulevard palm (~8.5m crown matching Cánovas scales)
    segs = 7 if lod == 0 else 4
    sides = 6 if lod == 0 else 5
    for i in range(segs):
        t = i / segs
        lean = math.sin(t * math.pi * 0.65) * 0.42
        r1 = 0.26 * (1.0 - t * 0.35)
        r2 = 0.26 * (1.0 - (t + 1 / segs) * 0.35)
        add_cylinder(bm, uv, (lean, 0, 0.55 + i * 1.10), r1, r2, 1.16, sides, SW_BARK, (0, 0.08 * i, 0))
    crown_x = math.sin(math.pi * 0.65) * 0.42
    crown_z = 0.55 + (segs - 0.5) * 1.10
    add_ico(bm, uv, (crown_x, 0, crown_z), 0.40, 1, SW_BARK)
    fronds = 8 if lod == 0 else 5
    for i in range(fronds):
        ang = (2.0 * math.pi * i) / fronds
        tilt = 0.42 if i % 2 == 0 else 0.72
        fx = crown_x + math.cos(ang) * 1.42
        fy = math.sin(ang) * 1.42
        fz = crown_z + 0.26 - tilt * 0.52
        add_box(bm, uv, (fx, fy, fz), (2.55, 0.54, 0.10), SW_LEAVES_PALM, (0, tilt, ang))
        if lod == 0:
            tx = crown_x + math.cos(ang) * 2.82
            ty = math.sin(ang) * 2.82
            tz = fz - 0.62
            add_box(bm, uv, (tx, ty, tz), (1.24, 0.38, 0.08), SW_LEAVES_SHRUB, (0, tilt + 0.45, ang))


def build_tree_cypress(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    sides = 7 if lod == 0 else 5
    add_cylinder(bm, uv, (0, 0, 0.72), 0.20, 0.14, 1.44, 5, SW_BARK)
    add_cylinder(bm, uv, (0, 0, 2.75), 0.66, 0.54, 2.80, sides, SW_LEAVES_CYPRESS)
    add_cylinder(bm, uv, (0, 0, 5.10), 0.54, 0.30, 2.25, sides, SW_LEAVES_CYPRESS)
    add_cylinder(bm, uv, (0, 0, 6.80), 0.30, 0.03, 1.35, sides, SW_LEAVES_DARK)


def build_shrub(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    detail = 2 if lod == 0 else 1
    add_cylinder(bm, uv, (0, 0, 0.08), 0.56, 0.54, 0.16, 6, SW_SOIL_MULCH)
    add_ico(bm, uv, (0, 0, 0.48), 0.52, detail, SW_LEAVES_SHRUB, (1.15, 1.15, 0.85))
    add_ico(bm, uv, (0.34, 0.14, 0.40), 0.34, 1, SW_LEAVES_FRESH)
    if lod == 0:
        add_ico(bm, uv, (-0.30, -0.18, 0.42), 0.32, 1, SW_LEAVES_DARK)


def build_hedge(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, 0, 0.08), (1.88, 0.64, 0.16), SW_SOIL_MULCH)
    add_box(bm, uv, (0, 0, 0.46), (1.76, 0.54, 0.66), SW_LEAVES_CYPRESS)
    if lod == 0:
        add_box(bm, uv, (0, 0, 0.82), (1.68, 0.46, 0.10), SW_LEAVES_SHRUB)


def build_bus_shelter(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    # Modern Cáceres bus shelter ("marquesina")
    add_box(bm, uv, (0, 0, 0.04), (3.10, 1.38, 0.08), SW_CONCRETE)
    add_box(bm, uv, (-1.34, 0.52, 1.25), (0.10, 0.10, 2.40), SW_CHARCOAL)
    add_box(bm, uv, (1.34, 0.52, 1.25), (0.10, 0.10, 2.40), SW_CHARCOAL)
    add_box(bm, uv, (0, 0.54, 1.30), (2.54, 0.05, 1.95), SW_FROSTED_GLASS)
    # Canted Stylized roof canopy & transit blue valance
    add_box(bm, uv, (0, -0.02, 2.52), (3.32, 1.56, 0.12), SW_CHARCOAL, (0.07, 0, 0))
    add_box(bm, uv, (0, -0.75, 2.44), (3.32, 0.10, 0.18), SW_BUS_BLUE)
    # Red timetable display case & warm timber bench
    add_box(bm, uv, (1.36, -0.06, 1.28), (0.14, 0.96, 1.78), SW_BUS_BLUE)
    add_box(bm, uv, (1.36, -0.06, 1.32), (0.16, 0.78, 1.38), SW_SIGN_WHITE)
    add_box(bm, uv, (-0.15, 0.20, 0.46), (1.85, 0.42, 0.07), SW_BENCH_WOOD)
    if lod == 0:
        add_box(bm, uv, (-0.82, 0.22, 0.24), (0.08, 0.34, 0.40), SW_ASH_DARK)
        add_box(bm, uv, (0.52, 0.22, 0.24), (0.08, 0.34, 0.40), SW_ASH_DARK)


def build_park_bench(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (-0.72, 0, 0.26), (0.08, 0.54, 0.48), SW_IRON)
    add_box(bm, uv, (0.72, 0, 0.26), (0.08, 0.54, 0.48), SW_IRON)
    add_box(bm, uv, (0, -0.04, 0.46), (1.66, 0.46, 0.07), SW_BENCH_WOOD)
    add_box(bm, uv, (0, 0.22, 0.74), (1.66, 0.07, 0.42), SW_BENCH_WOOD, (-0.22, 0, 0))
    if lod == 0:
        add_box(bm, uv, (-0.72, -0.02, 0.60), (0.07, 0.50, 0.06), SW_IRON)
        add_box(bm, uv, (0.72, -0.02, 0.60), (0.07, 0.50, 0.06), SW_IRON)


def build_waste_bin(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    sides = 8 if lod == 0 else 5
    add_cylinder(bm, uv, (0, 0, 0.42), 0.05, 0.05, 0.84, 6, SW_CHARCOAL)
    add_cylinder(bm, uv, (0, -0.14, 0.66), 0.20, 0.22, 0.56, sides, SW_ASH_DARK)
    add_cylinder(bm, uv, (0, -0.14, 0.98), 0.23, 0.14, 0.14, sides, SW_SIGN_GREEN)


def build_fountain(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    sides = 8 if lod == 0 else 6
    add_cylinder(bm, uv, (0, 0, 0.24), 1.48, 1.38, 0.48, sides, SW_GRANITE)
    add_cylinder(bm, uv, (0, 0, 0.42), 1.18, 1.18, 0.14, sides, SW_WATER)
    add_cylinder(bm, uv, (0, 0, 0.78), 0.28, 0.20, 0.90, sides, SW_CREAM_STONE)
    add_cylinder(bm, uv, (0, 0, 1.18), 0.68, 0.56, 0.20, sides, SW_GRANITE)
    if lod == 0:
        add_cylinder(bm, uv, (0, 0, 1.48), 0.14, 0.06, 0.46, 6, SW_CREAM_STONE)


def build_traffic_signals(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    sides = 6 if lod == 0 else 4
    add_cylinder(bm, uv, (0, 0, 1.15), 0.055, 0.045, 2.3, sides, SW_STEEL)
    add_box(bm, uv, (0, 0, 2.45), (0.28, 0.20, 0.82), SW_CHARCOAL)
    for idx, cell in enumerate((SW_SIGN_RED, SW_SIGN_YELLOW, SW_SIGN_GREEN)):
        add_cylinder(bm, uv, (0, -0.11, 2.69 - idx * 0.23), 0.06, 0.06, 0.04, sides, cell, (math.pi / 2, 0, 0))


def build_sign(kind: str, bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    sides = 6 if lod == 0 else 4
    add_cylinder(bm, uv, (0, 0, 1.05), 0.045, 0.04, 2.1, sides, SW_STEEL)
    if kind == "stop":
        add_cylinder(bm, uv, (0, -0.04, 1.92), 0.36, 0.36, 0.04, 8 if lod == 0 else 6, SW_SIGN_RED, (math.pi / 2, 0, 0))
        add_cylinder(bm, uv, (0, -0.065, 1.92), 0.40, 0.40, 0.02, 8 if lod == 0 else 6, SW_SIGN_WHITE, (math.pi / 2, 0, 0))
    else:
        add_box(bm, uv, (0, -0.04, 1.86), (0.68, 0.03, 0.68), SW_SIGN_WHITE, (0, 0, math.pi / 4))
        add_box(bm, uv, (0, -0.06, 1.86), (0.78, 0.02, 0.78), SW_SIGN_RED, (0, 0, math.pi / 4))


# ---------------------------------------------------------------------------
# Architectural Building Modules (Deep Stylized Low Poly 3D relief)
# ---------------------------------------------------------------------------

def build_chimney(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, 0, 0.76), (0.68, 0.64, 1.96), SW_BRICK)
    add_box(bm, uv, (0, 0, 1.78), (0.88, 0.84, 0.18), SW_CREAM_STONE)
    add_box(bm, uv, (0, 0, 0.06), (0.76, 0.72, 0.20), SW_DARK_STONE)
    if lod == 0:
        add_box(bm, uv, (0, 0, 1.66), (0.78, 0.74, 0.10), SW_CREAM_STONE)
        add_cylinder(bm, uv, (-0.16, 0, 2.02), 0.13, 0.10, 0.34, 6, SW_TERRACOTTA_CAP)
        add_cylinder(bm, uv, (0.16, 0, 2.02), 0.13, 0.10, 0.34, 6, SW_TERRACOTTA_CAP)


def build_balcony_historic(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    # Stepped granite corbels + thick sculpted stone cantilevered slab + tall wrought-iron balcony & framed French doors
    add_box(bm, uv, (-0.64, -0.32, -0.14), (0.20, 0.64, 0.26), SW_GRANITE)
    add_box(bm, uv, (0.64, -0.32, -0.14), (0.20, 0.64, 0.26), SW_GRANITE)
    add_box(bm, uv, (-0.64, -0.22, -0.32), (0.16, 0.44, 0.18), SW_CREAM_STONE)
    add_box(bm, uv, (0.64, -0.22, -0.32), (0.16, 0.44, 0.18), SW_CREAM_STONE)
    add_box(bm, uv, (0, -0.44, 0.06), (1.92, 0.92, 0.16), SW_CREAM_STONE)
    # Iron top rail, mid band, bottom rail & dense spindles + planters
    add_box(bm, uv, (0, -0.84, 1.04), (1.88, 0.08, 0.07), SW_IRON)
    add_box(bm, uv, (-0.90, -0.46, 1.04), (0.07, 0.82, 0.06), SW_IRON)
    add_box(bm, uv, (0.90, -0.46, 1.04), (0.07, 0.82, 0.06), SW_IRON)
    add_box(bm, uv, (0, -0.84, 0.20), (1.86, 0.05, 0.05), SW_IRON)
    bars = 7 if lod == 0 else 3
    for i in range(bars):
        x = -0.80 + (1.60 * i) / (bars - 1)
        add_box(bm, uv, (x, -0.84, 0.60), (0.048, 0.048, 0.88), SW_IRON)
    # Molded French balconera doorway behind railing with shutters & entablature hood
    add_box(bm, uv, (-0.66, -0.07, 1.14), (0.18, 0.18, 2.20), SW_CREAM_STONE)
    add_box(bm, uv, (0.66, -0.07, 1.14), (0.18, 0.18, 2.20), SW_CREAM_STONE)
    add_box(bm, uv, (0, -0.10, 2.28), (1.56, 0.24, 0.18), SW_GRANITE)
    add_box(bm, uv, (0, -0.02, 1.14), (1.14, 0.07, 2.10), SW_GLASS)
    if lod == 0:
        add_box(bm, uv, (0, -0.06, 1.14), (0.05, 0.08, 2.10), SW_WOOD)
        add_box(bm, uv, (-0.82, -0.10, 1.14), (0.28, 0.06, 2.04), SW_SHUTTER_GREEN, (0, 0, 0.20))
        add_box(bm, uv, (0.82, -0.10, 1.14), (0.28, 0.06, 2.04), SW_SHUTTER_GREEN, (0, 0, -0.20))


def build_balcony_modern(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    # Wide architectural concrete cantilevered deck with chamfered lip, frosted glass balustrade & AC unit
    add_box(bm, uv, (0, -0.48, 0.08), (2.92, 1.04, 0.18), SW_CONCRETE)
    add_box(bm, uv, (0, -0.94, 0.56), (2.86, 0.07, 0.80), SW_FROSTED_GLASS)
    add_box(bm, uv, (-1.40, -0.48, 0.56), (0.09, 0.96, 0.82), SW_PLASTER_WHITE)
    add_box(bm, uv, (1.40, -0.48, 0.56), (0.09, 0.96, 0.82), SW_PLASTER_WHITE)
    add_box(bm, uv, (0, -0.94, 1.02), (2.90, 0.10, 0.07), SW_CHARCOAL)
    add_box(bm, uv, (0, -0.02, 1.12), (2.28, 0.07, 2.04), SW_GLASS)
    add_box(bm, uv, (-1.18, -0.07, 1.12), (0.12, 0.14, 2.06), SW_CHARCOAL)
    add_box(bm, uv, (1.18, -0.07, 1.12), (0.12, 0.14, 2.06), SW_CHARCOAL)
    add_box(bm, uv, (0, -0.08, 2.18), (2.42, 0.18, 0.24), SW_PERSIANA)
    if lod == 0:
        # Stylish AC condenser tucked cleanly on right wall return
        add_box(bm, uv, (1.62, -0.20, 1.55), (0.56, 0.34, 0.42), SW_STEEL)
        add_cylinder(bm, uv, (1.62, -0.38, 1.55), 0.14, 0.14, 0.04, 6, SW_CHARCOAL, (math.pi / 2, 0, 0))


def build_window_casco(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    # Thick protruding granite sill & stone jambs around recessed sky glass + louvered green shutters
    add_box(bm, uv, (0, -0.11, 0.04), (1.48, 0.28, 0.12), SW_CREAM_STONE)
    add_box(bm, uv, (0, -0.09, 1.48), (1.46, 0.24, 0.16), SW_GRANITE)
    add_box(bm, uv, (-0.58, -0.07, 0.76), (0.15, 0.18, 1.34), SW_GRANITE)
    add_box(bm, uv, (0.58, -0.07, 0.76), (0.15, 0.18, 1.34), SW_GRANITE)
    add_box(bm, uv, (0, -0.02, 0.76), (1.02, 0.06, 1.30), SW_GLASS)
    if lod == 0:
        add_box(bm, uv, (0, -0.05, 0.76), (0.05, 0.06, 1.30), SW_WOOD)
        add_box(bm, uv, (-0.70, -0.10, 0.76), (0.30, 0.05, 1.28), SW_SHUTTER_GREEN, (0, 0, 0.24))
        add_box(bm, uv, (0.70, -0.10, 0.76), (0.30, 0.05, 1.28), SW_SHUTTER_GREEN, (0, 0, -0.24))


def build_window_ensanche(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, -0.09, 0.03), (1.68, 0.22, 0.10), SW_CONCRETE)
    add_box(bm, uv, (0, -0.08, 1.40), (1.64, 0.20, 0.24), SW_PERSIANA)
    add_box(bm, uv, (-0.75, -0.06, 0.72), (0.12, 0.14, 1.28), SW_CONCRETE)
    add_box(bm, uv, (0.75, -0.06, 0.72), (0.12, 0.14, 1.28), SW_CONCRETE)
    add_box(bm, uv, (0, -0.02, 0.70), (1.42, 0.06, 1.20), SW_GLASS)
    if lod == 0:
        add_box(bm, uv, (0, -0.05, 1.08), (1.42, 0.05, 0.34), SW_PERSIANA)
        add_box(bm, uv, (0, -0.05, 0.56), (0.06, 0.06, 0.90), SW_CHARCOAL)


def build_window_modern(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, -0.11, 1.32), (2.10, 0.28, 0.11), SW_CONCRETE)
    add_box(bm, uv, (0, -0.09, 0.03), (2.08, 0.22, 0.09), SW_CONCRETE)
    add_box(bm, uv, (-0.98, -0.07, 0.68), (0.12, 0.16, 1.22), SW_CHARCOAL)
    add_box(bm, uv, (0.98, -0.07, 0.68), (0.12, 0.16, 1.22), SW_CHARCOAL)
    add_box(bm, uv, (0, -0.02, 0.68), (1.88, 0.06, 1.18), SW_GLASS)
    if lod == 0:
        add_box(bm, uv, (0, -0.06, 0.68), (0.07, 0.08, 1.18), SW_CHARCOAL)
        add_box(bm, uv, (0, -0.06, 0.68), (1.88, 0.08, 0.06), SW_CHARCOAL)


def build_window_awning(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    # Stylized Low Poly window with scalloped striped canopy hood (Signature look from Reference!)
    add_box(bm, uv, (0, -0.10, 0.03), (1.68, 0.24, 0.10), SW_CONCRETE)
    add_box(bm, uv, (-0.75, -0.07, 0.68), (0.12, 0.16, 1.22), SW_CHARCOAL)
    add_box(bm, uv, (0.75, -0.07, 0.68), (0.12, 0.16, 1.22), SW_CHARCOAL)
    add_box(bm, uv, (0, -0.02, 0.68), (1.42, 0.06, 1.18), SW_GLASS)
    add_box(bm, uv, (0, -0.34, 1.28), (1.64, 0.68, 0.09), SW_AWNING_BLUE, (0.40, 0, 0))
    add_box(bm, uv, (0, -0.66, 1.12), (1.64, 0.05, 0.14), SW_AWNING_BLUE)
    if lod == 0:
        add_box(bm, uv, (0, -0.05, 0.68), (0.06, 0.06, 1.18), SW_PLASTER_WHITE)
        add_box(bm, uv, (0, -0.05, 0.70), (1.42, 0.06, 0.06), SW_PLASTER_WHITE)


def build_portal_casco(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    # Deep ground-anchored stone threshold extending -0.35m for slope safety + arched voussoir portal & lantern
    add_box(bm, uv, (0, -0.34, -0.08), (2.72, 0.72, 0.42), SW_DARK_STONE)
    add_box(bm, uv, (-1.08, -0.13, 1.44), (0.42, 0.34, 2.74), SW_GRANITE)
    add_box(bm, uv, (1.08, -0.13, 1.44), (0.42, 0.34, 2.74), SW_GRANITE)
    add_box(bm, uv, (0, -0.05, 1.46), (1.78, 0.14, 2.72), SW_WOOD)
    arch_segs = 7 if lod == 0 else 3
    r_mid = 1.08
    for i in range(arch_segs):
        angle = math.pi * (i + 0.5) / arch_segs
        cx = -math.cos(angle) * r_mid
        cz = 2.52 + math.sin(angle) * r_mid * 0.78
        rot_y = -(angle - math.pi / 2)
        h_stone = 0.52 if i == arch_segs // 2 else 0.40
        add_box(bm, uv, (cx, -0.16, cz), (0.42, 0.34, h_stone), SW_CREAM_STONE, (0, rot_y, 0))
    if lod == 0:
        add_box(bm, uv, (1.44, -0.20, 2.38), (0.14, 0.26, 0.10), SW_IRON)
        add_cylinder(bm, uv, (1.44, -0.30, 2.22), 0.10, 0.15, 0.28, 4, SW_LAMP_GLOW, (0, 0, math.pi / 4))


def build_portal_modern(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, -0.34, -0.08), (2.96, 0.72, 0.40), SW_DARK_STONE)
    add_box(bm, uv, (-1.26, -0.11, 1.40), (0.30, 0.30, 2.72), SW_DARK_STONE)
    add_box(bm, uv, (1.26, -0.11, 1.40), (0.30, 0.30, 2.72), SW_DARK_STONE)
    add_box(bm, uv, (0, -0.04, 1.36), (2.22, 0.10, 2.60), SW_GLASS_WARM)
    add_box(bm, uv, (0, -0.68, 2.82), (3.14, 1.44, 0.20), SW_CONCRETE)
    if lod == 0:
        add_box(bm, uv, (0, -0.09, 1.36), (0.09, 0.12, 2.60), SW_CHARCOAL)
        add_box(bm, uv, (0, -0.68, 2.94), (3.18, 1.48, 0.08), SW_CHARCOAL)
        # Flanking entrance stone planters
        for sx in (-1.62, 1.62):
            add_box(bm, uv, (sx, -0.32, 0.22), (0.44, 0.44, 0.44), SW_TERRACOTTA)
            add_ico(bm, uv, (sx, -0.32, 0.56), 0.28, 1, SW_LEAVES_SHRUB)


def build_shopfront_awning(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int,
                           swatch_awning: tuple[int, int] = SW_AWNING_RED) -> None:
    # Tall sidewalk-safe stone skirt + warm glowing cafe display + deeply ribbed striped awning & signboard
    add_box(bm, uv, (0, -0.14, 0.18), (3.62, 0.34, 0.96), SW_DARK_STONE)
    add_box(bm, uv, (0, -0.04, 1.68), (3.34, 0.12, 2.16), SW_GLASS_WARM)
    add_box(bm, uv, (0, -0.10, 2.94), (3.62, 0.26, 0.32), SW_CHARCOAL)
    add_box(bm, uv, (0, -0.72, 2.70), (3.56, 1.42, 0.10), swatch_awning, (0.36, 0, 0))
    add_box(bm, uv, (0, -1.38, 2.40), (3.56, 0.06, 0.24), swatch_awning)
    if lod == 0:
        add_box(bm, uv, (-1.70, -0.10, 1.56), (0.18, 0.26, 2.98), SW_CHARCOAL)
        add_box(bm, uv, (1.70, -0.10, 1.56), (0.18, 0.26, 2.98), SW_CHARCOAL)
        add_box(bm, uv, (-0.36, -0.08, 1.66), (0.07, 0.12, 2.16), SW_CHARCOAL)
        # Decorative sidewalk awning ribs
        for rx in (-1.3, 0.0, 1.3):
            add_box(bm, uv, (rx, -0.68, 2.66), (0.08, 1.32, 0.07), SW_CHARCOAL, (0.36, 0, 0))


def build_industrial_door(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (-1.70, -0.08, 1.66), (0.20, 0.22, 3.32), SW_STEEL)
    add_box(bm, uv, (1.70, -0.08, 1.66), (0.20, 0.22, 3.32), SW_STEEL)
    add_box(bm, uv, (0, -0.14, 3.38), (3.62, 0.34, 0.36), SW_CHARCOAL)
    add_box(bm, uv, (0, -0.04, 1.60), (3.22, 0.08, 3.22), SW_ROLL_DOOR)
    if lod == 0:
        add_cylinder(bm, uv, (-1.84, -0.28, 0.42), 0.09, 0.09, 0.92, 6, SW_SAFETY_YELLOW)
        add_cylinder(bm, uv, (1.84, -0.28, 0.42), 0.09, 0.09, 0.92, 6, SW_SAFETY_YELLOW)


def build_pilaster_corner(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    courses = 4 if lod == 0 else 2
    h = 3.0 / courses
    for i in range(courses):
        z = (i + 0.5) * h
        long_x = (i % 2) == 0
        w_x = 0.52 if long_x else 0.36
        w_y = 0.36 if long_x else 0.52
        add_box(bm, uv, (0, 0, z), (w_x, w_y, h * 0.92), SW_GRANITE if i % 2 == 0 else SW_CREAM_STONE)


def build_rooftop_penthouse(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, 0, 1.15), (2.85, 2.45, 2.55), SW_PLASTER_WHITE)
    add_box(bm, uv, (0, 0, 2.48), (3.08, 2.68, 0.18), SW_CONCRETE)
    add_box(bm, uv, (0, -1.24, 0.98), (0.92, 0.08, 1.98), SW_STEEL)
    if lod == 0:
        add_box(bm, uv, (0, 0, 2.60), (3.12, 2.72, 0.06), SW_SLATE_BLUE)
        add_cylinder(bm, uv, (0.95, 0.65, 3.45), 0.03, 0.02, 1.95, 4, SW_STEEL)
        add_box(bm, uv, (0.95, 0.65, 4.18), (0.82, 0.04, 0.04), SW_STEEL)


def build_rooftop_hvac(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, 0, 0.45), (1.70, 0.96, 0.90), SW_STEEL)
    if lod == 0:
        add_cylinder(bm, uv, (-0.40, -0.49, 0.48), 0.29, 0.29, 0.07, 6, SW_CHARCOAL, (math.pi / 2, 0, 0))
        add_cylinder(bm, uv, (0.40, -0.49, 0.48), 0.29, 0.29, 0.07, 6, SW_CHARCOAL, (math.pi / 2, 0, 0))
        add_cylinder(bm, uv, (0.55, 0.12, 1.06), 0.22, 0.26, 0.34, 6, SW_STEEL)


def build_rooftop_solar(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (-0.52, 0, 0.22), (0.08, 0.90, 0.44), SW_CHARCOAL)
    add_box(bm, uv, (0.52, 0, 0.22), (0.08, 0.90, 0.44), SW_CHARCOAL)
    add_box(bm, uv, (0, 0, 0.42), (1.76, 1.05, 0.07), SW_SOLAR_PANEL, (0.42, 0, 0))
    if lod == 0:
        add_cylinder(bm, uv, (0, 0.38, 0.72), 0.19, 0.19, 1.25, 7, SW_STEEL, (0, math.pi / 2, 0))


def build_dormer_roof(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, 0.08, 0.34), (1.36, 1.40, 1.12), SW_PLASTER_WHITE)
    add_box(bm, uv, (0, -0.63, 0.38), (0.90, 0.07, 0.74), SW_GLASS)
    add_box(bm, uv, (-0.38, -0.10, 0.92), (0.86, 1.68, 0.14), SW_TILE, (0, -0.50, 0))
    add_box(bm, uv, (0.38, -0.10, 0.92), (0.86, 1.68, 0.14), SW_TILE, (0, 0.50, 0))
    if lod == 0:
        add_box(bm, uv, (0, -0.66, 0.02), (1.06, 0.14, 0.08), SW_CREAM_STONE)


def build_bell_gable(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, 0, 0.15), (2.75, 0.62, 0.80), SW_GRANITE)
    add_box(bm, uv, (-0.96, 0, 1.40), (0.70, 0.56, 1.90), SW_GRANITE)
    add_box(bm, uv, (0.96, 0, 1.40), (0.70, 0.56, 1.90), SW_GRANITE)
    add_box(bm, uv, (0, 0, 2.38), (2.68, 0.60, 0.38), SW_CREAM_STONE)
    add_box(bm, uv, (0, 0, 2.75), (1.80, 0.54, 0.42), SW_GRANITE)
    add_cylinder(bm, uv, (0, 0, 1.38), 0.34, 0.18, 0.58, 7 if lod == 0 else 5, SW_BRASS)
    add_box(bm, uv, (0, 0, 1.72), (1.15, 0.14, 0.14), SW_WOOD)
    if lod == 0:
        add_box(bm, uv, (0, 0, 3.55), (0.07, 0.07, 0.78), SW_IRON)
        add_box(bm, uv, (0, 0, 3.72), (0.50, 0.07, 0.07), SW_IRON)


def build_corner_turret(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    sides = 7 if lod == 0 else 5
    add_cylinder(bm, uv, (0, -0.35, -0.35), 0.25, 0.62, 0.65, sides, SW_GRANITE)
    add_cylinder(bm, uv, (0, -0.35, 0.72), 0.62, 0.62, 1.50, sides, SW_CREAM_STONE)
    add_cylinder(bm, uv, (0, -0.35, 1.54), 0.70, 0.70, 0.16, sides, SW_DARK_STONE)
    add_cylinder(bm, uv, (0, -0.35, 1.98), 0.74, 0.03, 0.76, sides, SW_TILE)


def build_heraldic_crest(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, -0.06, 0.45), (0.86, 0.16, 0.94), SW_CREAM_STONE)
    add_box(bm, uv, (0, -0.14, 0.42), (0.58, 0.10, 0.68), SW_TERRACOTTA)
    if lod == 0:
        add_box(bm, uv, (0, -0.18, 0.42), (0.10, 0.08, 0.56), SW_BRASS)
        add_box(bm, uv, (0, -0.18, 0.46), (0.46, 0.08, 0.10), SW_BRASS)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict[str, object]] = {}

    with tempfile.TemporaryDirectory() as tmpdir:
        atlas_path = Path(tmpdir) / "kit_atlas.png"
        atlas_path.write_bytes(_build_atlas_png_bytes())

        builders = {
            "street-lamp": build_street_lamp,
            "street-lamp-modern": build_street_lamp_modern,
            "tree": build_tree_deciduous,
            "tree-deciduous": build_tree_deciduous,
            "tree-oak": build_tree_oak,
            "tree-pine": build_tree_pine,
            "tree-palm": build_tree_palm,
            "tree-cypress": build_tree_cypress,
            "shrub": build_shrub,
            "hedge": build_hedge,
            "bus-shelter": build_bus_shelter,
            "park-bench": build_park_bench,
            "waste-bin": build_waste_bin,
            "fountain": build_fountain,
            "traffic-signals": build_traffic_signals,
            "stop-sign": lambda bm, uv, lod: build_sign("stop", bm, uv, lod),
            "give-way-sign": lambda bm, uv, lod: build_sign("give_way", bm, uv, lod),
            "chimney": build_chimney,
            "balcony": build_balcony_historic,
            "balcony-modern": build_balcony_modern,
            "window-casco": build_window_casco,
            "window-ensanche": build_window_ensanche,
            "window-modern": build_window_modern,
            "window-awning": build_window_awning,
            "portal-casco": build_portal_casco,
            "portal-modern": build_portal_modern,
            "shopfront-awning": lambda bm, uv, lod: build_shopfront_awning(bm, uv, lod, SW_AWNING_RED),
            "industrial-door": build_industrial_door,
            "pilaster-corner": build_pilaster_corner,
            "rooftop-penthouse": build_rooftop_penthouse,
            "rooftop-hvac": build_rooftop_hvac,
            "rooftop-solar": build_rooftop_solar,
            "dormer-roof": build_dormer_roof,
            "bell-gable": build_bell_gable,
            "corner-turret": build_corner_turret,
            "heraldic-crest": build_heraldic_crest,
        }

        for name, builder in builders.items():
            for lod in (0, 1):
                clear_scene()
                bm = bmesh.new()
                uv_layer = bm.loops.layers.uv.new("UVMap")
                builder(bm, uv_layer, lod)
                export_bmesh(f"{name}-lod{lod}", bm, atlas_path, manifest)

    payload = {
        "schemaVersion": 3,
        "generator": "tools/generate_citykit.py",
        "licence": "CC0-1.0 (original procedural geometry)",
        "models": manifest,
    }
    (OUT_DIR / "manifest.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"[citykit] wrote {len(manifest)} GLB files to {OUT_DIR}")


if __name__ == "__main__":
    main()
