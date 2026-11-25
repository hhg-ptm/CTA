"""Generate the procedural Cáceres architectural and street city kit as GLB files.

Run with Blender 5.x in background mode:

    blender.exe --background --factory-startup --python tools/generate_citykit.py

Everything here is authored from scratch in pure Python/bmesh with one shared
embedded procedural swatch atlas so every GLB renders as a single draw call
per chunk via InstancedMesh. Zero external downloads or third-party licences.
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

ATLAS_SIZE = 256
ATLAS_COLS = 8
ATLAS_ROWS = 4

# Swatch coordinates (col, row) with row 0 at bottom in UV space.
SW_GRANITE = (0, 0)        # Warm Cáceres honey granite ashlar
SW_DARK_STONE = (1, 0)     # Dark granite plinth / slate
SW_IRON = (2, 0)           # Forged wrought iron
SW_SHUTTER_GREEN = (3, 0)  # Historic olive/forest wooden shutter
SW_WOOD = (4, 0)           # Aged walnut / oak timber
SW_TILE = (5, 0)           # Terracotta barrel roof tile
SW_PLASTER_WHITE = (6, 0)  # Warm limewashed stucco
SW_OCHRE = (7, 0)          # Sunny sandstone / ochre render

SW_GLASS = (0, 1)          # Sky-reflecting window glazing
SW_GLASS_WARM = (1, 1)     # Deep shopfront / amber interior glazing
SW_CONCRETE = (2, 1)       # Architectural concrete slab / sill
SW_STEEL = (3, 1)          # Brushed HVAC / galvanized steel
SW_BRASS = (4, 1)          # Bronze bell / knockers / hardware
SW_AWNING_RED = (5, 1)     # Burgundy-cream striped café awning
SW_AWNING_GREEN = (6, 1)   # Forest-cream striped shop awning
SW_PERSIANA = (7, 1)       # Slatted roller shutter

SW_BRICK = (0, 2)          # Spanish red exposed brick
SW_AWNING_MUSTARD = (1, 2) # Mustard-cream striped awning
SW_ROLL_DOOR = (2, 2)      # Ribbed industrial shutter door
SW_LEAVES_DARK = (3, 2)    # Mediterranean holm oak dark foliage
SW_LEAVES_LIGHT = (4, 2)   # Sunlit olive/oak canopy foliage
SW_BARK = (5, 2)           # Grooved tree bark
SW_LAMP_GLOW = (6, 2)      # Warm glowing lantern glass
SW_SIGN_RED = (7, 2)       # Traffic sign red

SW_SIGN_WHITE = (0, 3)     # Traffic sign white
SW_SIGN_YELLOW = (1, 3)    # Signal amber
SW_SIGN_GREEN = (2, 3)     # Signal green
SW_TERRACOTTA = (3, 3)     # Warm sienna terracotta plaster
SW_CREAM_STONE = (4, 3)    # Light limestone trim / voussoirs
SW_COPPER = (5, 3)         # Patinated copper / dark bronze
SW_SAFETY_YELLOW = (6, 3)  # Industrial bumper yellow
SW_CHARCOAL = (7, 3)       # Deep anodized window frame


def _cell_rgb(col: int, row: int, u: float, v: float, seed: int) -> tuple[float, float, float]:
    """Generate crisp subtle procedural pattern for each swatch in sRGB."""
    rng = ((seed * 1103515245 + 12345) >> 16) & 255
    grain = (rng / 255.0 - 0.5) * 0.055
    key = (col, row)

    if key == SW_GRANITE:
        mortar = (v < 0.08 or (abs(u - 0.5) < 0.03 and v < 0.5) or (u < 0.04 and v >= 0.5))
        base = (0.56, 0.50, 0.40) if mortar else (0.76, 0.69, 0.56)
        speck = ((seed % 11) - 5) * 0.014
        return (base[0] + grain + speck, base[1] + grain + speck, base[2] + grain)
    if key == SW_DARK_STONE:
        return (0.31 + grain, 0.30 + grain, 0.28 + grain)
    if key == SW_IRON:
        return (0.14 + grain * 0.4, 0.15 + grain * 0.4, 0.16 + grain * 0.4)
    if key == SW_SHUTTER_GREEN:
        slat = -0.05 if int(v * 14) % 2 == 0 else 0.03
        return (0.18 + slat + grain * 0.4, 0.34 + slat + grain * 0.5, 0.21 + slat * 0.5)
    if key == SW_WOOD:
        streak = -0.04 if int(u * 10) % 2 == 0 else 0.03
        return (0.40 + streak + grain * 0.6, 0.25 + streak * 0.7 + grain * 0.4, 0.14 + streak * 0.4)
    if key == SW_TILE:
        rib = math.sin(u * math.pi * 6.0) * 0.06
        band = -0.04 if int(v * 5) % 2 == 0 else 0.02
        return (0.68 + rib + band + grain, 0.32 + rib * 0.5 + band, 0.20 + band * 0.5)
    if key == SW_PLASTER_WHITE:
        return (0.93 + grain * 0.4, 0.90 + grain * 0.4, 0.85 + grain * 0.4)
    if key == SW_OCHRE:
        return (0.85 + grain * 0.5, 0.70 + grain * 0.5, 0.46 + grain * 0.4)
    if key == SW_GLASS:
        sheen = 0.24 if (0.18 < (u + v) * 0.5 < 0.34 or 0.52 < (u + v) * 0.5 < 0.60) else 0.0
        grad = (1.0 - v) * 0.08
        return (0.18 + sheen + grad, 0.32 + sheen + grad, 0.40 + sheen + grad * 1.1)
    if key == SW_GLASS_WARM:
        sheen = 0.20 if 0.25 < (u + v) * 0.5 < 0.38 else 0.0
        warm = 0.20 * (1.0 - v)
        return (0.24 + warm + sheen, 0.26 + warm * 0.8 + sheen, 0.26 + sheen * 0.9)
    if key == SW_CONCRETE:
        return (0.79 + grain * 0.5, 0.77 + grain * 0.5, 0.73 + grain * 0.5)
    if key == SW_STEEL:
        rib = 0.04 if int(v * 10) % 2 == 0 else -0.03
        return (0.62 + rib + grain * 0.4, 0.65 + rib + grain * 0.4, 0.68 + rib + grain * 0.4)
    if key == SW_BRASS:
        sheen = 0.08 * math.sin(v * math.pi)
        return (0.80 + sheen, 0.61 + sheen * 0.8, 0.26 + sheen * 0.4)
    if key in (SW_AWNING_RED, SW_AWNING_GREEN, SW_AWNING_MUSTARD):
        stripe = int(u * 8) % 2 == 0
        if stripe:
            return (0.94 + grain * 0.3, 0.91 + grain * 0.3, 0.84 + grain * 0.3)
        if key == SW_AWNING_RED:
            return (0.62 + grain * 0.4, 0.16, 0.17)
        if key == SW_AWNING_GREEN:
            return (0.15, 0.40 + grain * 0.4, 0.22)
        return (0.82 + grain * 0.4, 0.60 + grain * 0.3, 0.16)
    if key == SW_PERSIANA:
        slat = -0.08 if int(v * 18) % 2 == 0 else 0.05
        return (0.58 + slat, 0.56 + slat, 0.52 + slat)
    if key == SW_BRICK:
        mortar = (v * 8) % 1.0 < 0.16 or ((u * 4 + (0.5 if int(v * 8) % 2 else 0.0)) % 1.0) < 0.08
        if mortar:
            return (0.76, 0.70, 0.62)
        return (0.64 + grain, 0.28 + grain * 0.5, 0.19 + grain * 0.4)
    if key == SW_ROLL_DOOR:
        rib = -0.07 if int(v * 20) % 2 == 0 else 0.05
        return (0.56 + rib + grain * 0.3, 0.60 + rib + grain * 0.3, 0.64 + rib + grain * 0.3)
    if key == SW_LEAVES_DARK:
        return (0.20 + grain, 0.37 + grain, 0.15 + grain * 0.6)
    if key == SW_LEAVES_LIGHT:
        return (0.31 + grain, 0.48 + grain, 0.19 + grain * 0.6)
    if key == SW_BARK:
        streak = -0.04 if int(u * 9) % 2 == 0 else 0.03
        return (0.30 + streak + grain * 0.5, 0.21 + streak * 0.7, 0.13 + streak * 0.4)
    if key == SW_LAMP_GLOW:
        return (1.00, 0.89, 0.55)
    if key == SW_SIGN_RED:
        return (0.74, 0.15, 0.13)
    if key == SW_SIGN_WHITE:
        return (0.95, 0.94, 0.88)
    if key == SW_SIGN_YELLOW:
        return (0.92, 0.70, 0.15)
    if key == SW_SIGN_GREEN:
        return (0.20, 0.58, 0.26)
    if key == SW_TERRACOTTA:
        return (0.76 + grain * 0.6, 0.41 + grain * 0.4, 0.27 + grain * 0.4)
    if key == SW_CREAM_STONE:
        return (0.87 + grain * 0.4, 0.81 + grain * 0.4, 0.69 + grain * 0.4)
    if key == SW_COPPER:
        return (0.34 + grain * 0.4, 0.48 + grain * 0.4, 0.39 + grain * 0.4)
    if key == SW_SAFETY_YELLOW:
        return (0.90, 0.70, 0.12)
    return (0.21 + grain * 0.3, 0.23 + grain * 0.3, 0.25 + grain * 0.3)


def _encode_png_rgba(width: int, height: int, rgba_rows_top_down: bytes) -> bytes:
    """Encode an 8-bit RGBA PNG purely in stdlib so Blender loads real bytes cleanly."""
    stride = width * 4
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # Filter type None
        start = y * stride
        raw.extend(rgba_rows_top_down[start : start + stride])

    def chunk(tag: bytes, payload: bytes) -> bytes:
        body = tag + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), level=9)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def _build_atlas_png_bytes() -> bytes:
    cell_w = ATLAS_SIZE // ATLAS_COLS
    cell_h = ATLAS_SIZE // ATLAS_ROWS
    buf = bytearray(ATLAS_SIZE * ATLAS_SIZE * 4)
    # PNG is top-down (png_y = 0 at top -> UV row = ATLAS_ROWS - 1)
    for png_y in range(ATLAS_SIZE):
        uv_y = ATLAS_SIZE - 1 - png_y
        row = uv_y // cell_h
        v = (uv_y % cell_h) / max(1, cell_h - 1)
        for px in range(ATLAS_SIZE):
            col = px // cell_w
            u = (px % cell_w) / max(1, cell_w - 1)
            r, g, b = _cell_rgb(col, row, u, v, uv_y * 313 + px * 97 + col * 17)
            idx = (png_y * ATLAS_SIZE + px) * 4
            buf[idx] = int(max(0.0, min(1.0, r)) * 255.0 + 0.5)
            buf[idx + 1] = int(max(0.0, min(1.0, g)) * 255.0 + 0.5)
            buf[idx + 2] = int(max(0.0, min(1.0, b)) * 255.0 + 0.5)
            buf[idx + 3] = 255
    return _encode_png_rgba(ATLAS_SIZE, ATLAS_SIZE, bytes(buf))


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
        bsdf.inputs["Roughness"].default_value = 0.68
        bsdf.inputs["Metallic"].default_value = 0.08
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
    pad_v = 0.018
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
                    u0 + (u1 - u0) * (0.5 + 0.45 * math.cos(2.0 * math.pi * i / n)),
                    v0 + (v1 - v0) * (0.5 + 0.45 * math.sin(2.0 * math.pi * i / n)),
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
            cell: tuple[int, int]) -> None:
    mat = Matrix.Translation(center)
    res = bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius, matrix=mat)
    verts = set(res["verts"])
    faces = [f for f in bm.faces if all(v in verts for v in f.verts)]
    _assign_cell_uvs(bm, faces, uv_layer, cell)


def export_bmesh(name: str, bm: bmesh.types.BMesh, atlas_path: Path,
                 manifest: dict[str, dict[str, object]]) -> None:
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    sharp_edges = [e for e in bm.edges if e.calc_face_angle(0.0) > math.radians(38.0)]
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
# Street Furniture & Vegetation
# ---------------------------------------------------------------------------

def build_street_lamp(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    sides = 8 if lod == 0 else 5
    add_cylinder(bm, uv, (0, 0, 0.22), 0.24, 0.18, 0.44, sides, SW_IRON)
    add_cylinder(bm, uv, (0, 0, 2.0), 0.075, 0.05, 3.2, sides, SW_IRON)
    add_cylinder(bm, uv, (0, 0, 3.64), 0.08, 0.14, 0.14, sides, SW_IRON)
    add_cylinder(bm, uv, (0, 0, 3.94), 0.15, 0.22, 0.46, 4, SW_LAMP_GLOW, (0, 0, math.pi / 4))
    add_cylinder(bm, uv, (0, 0, 4.28), 0.26, 0.02, 0.24, 4, SW_IRON, (0, 0, math.pi / 4))


def build_tree(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    sides = 7 if lod == 0 else 5
    add_cylinder(bm, uv, (0, 0, 0.95), 0.22, 0.14, 1.9, sides, SW_BARK)
    add_cylinder(bm, uv, (0.24, 0, 1.9), 0.08, 0.04, 0.85, 5, SW_BARK, (0, 0.65, 0))
    add_cylinder(bm, uv, (-0.22, 0.05, 1.85), 0.08, 0.04, 0.8, 5, SW_BARK, (0, -0.65, 0))
    detail = 2 if lod == 0 else 1
    add_ico(bm, uv, (0, 0, 2.85), 1.12, detail, SW_LEAVES_DARK)
    add_ico(bm, uv, (0.52, 0.12, 2.55), 0.74, detail, SW_LEAVES_LIGHT)
    add_ico(bm, uv, (-0.46, -0.22, 2.62), 0.70, detail, SW_LEAVES_DARK)
    if lod == 0:
        add_ico(bm, uv, (0.05, 0.06, 3.55), 0.62, detail, SW_LEAVES_LIGHT)


def build_traffic_signals(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    sides = 6 if lod == 0 else 4
    add_cylinder(bm, uv, (0, 0, 1.1), 0.05, 0.045, 2.2, sides, SW_STEEL)
    add_box(bm, uv, (0, 0, 2.38), (0.26, 0.18, 0.78), SW_CHARCOAL)
    for idx, cell in enumerate((SW_SIGN_RED, SW_SIGN_YELLOW, SW_SIGN_GREEN)):
        add_cylinder(bm, uv, (0, -0.10, 2.62 - idx * 0.23), 0.055, 0.055, 0.04, sides, cell, (math.pi / 2, 0, 0))


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
# Architectural Building Modules (lean low-poly for crisp 60 FPS CityKit)
# ---------------------------------------------------------------------------

def build_chimney(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, 0, 0.50), (0.50, 0.50, 1.36), SW_BRICK)
    add_box(bm, uv, (0, 0, 1.22), (0.66, 0.66, 0.12), SW_CREAM_STONE)
    if lod == 0:
        add_cylinder(bm, uv, (-0.11, 0, 1.38), 0.10, 0.08, 0.24, 5, SW_TILE)
        add_cylinder(bm, uv, (0.11, 0, 1.38), 0.10, 0.08, 0.24, 5, SW_TILE)


def build_balcony_historic(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (-0.50, -0.18, -0.09), (0.14, 0.34, 0.18), SW_GRANITE)
    add_box(bm, uv, (0.50, -0.18, -0.09), (0.14, 0.34, 0.18), SW_GRANITE)
    add_box(bm, uv, (0, -0.22, 0.05), (1.42, 0.52, 0.10), SW_CREAM_STONE)
    add_box(bm, uv, (0, -0.45, 0.88), (1.38, 0.06, 0.05), SW_IRON)
    bars = 4 if lod == 0 else 2
    for i in range(bars):
        x = -0.56 + (1.12 * i) / (bars - 1)
        add_box(bm, uv, (x, -0.45, 0.49), (0.04, 0.04, 0.74), SW_IRON)
    if lod == 0:
        add_box(bm, uv, (0, -0.01, 1.04), (1.02, 0.06, 1.92), SW_GLASS)
        add_box(bm, uv, (-0.62, -0.05, 1.04), (0.24, 0.05, 1.84), SW_WOOD, (0, 0, 0.18))
        add_box(bm, uv, (0.62, -0.05, 1.04), (0.24, 0.05, 1.84), SW_WOOD, (0, 0, -0.18))


def build_balcony_modern(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, -0.28, 0.07), (2.25, 0.68, 0.14), SW_CONCRETE)
    add_box(bm, uv, (0, -0.59, 0.48), (2.22, 0.05, 0.68), SW_PLASTER_WHITE)
    add_box(bm, uv, (-1.10, -0.30, 0.48), (0.05, 0.60, 0.68), SW_PLASTER_WHITE)
    add_box(bm, uv, (1.10, -0.30, 0.48), (0.05, 0.60, 0.68), SW_PLASTER_WHITE)
    add_box(bm, uv, (0, -0.59, 0.94), (2.26, 0.06, 0.05), SW_CHARCOAL)
    if lod == 0:
        add_box(bm, uv, (0, -0.01, 1.05), (1.76, 0.05, 1.90), SW_GLASS)
        add_box(bm, uv, (0, -0.04, 2.02), (1.84, 0.10, 0.18), SW_PERSIANA)


def build_window_casco(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, -0.06, 0.04), (1.36, 0.18, 0.09), SW_CREAM_STONE)
    add_box(bm, uv, (0, -0.05, 1.46), (1.34, 0.16, 0.13), SW_GRANITE)
    add_box(bm, uv, (0, -0.02, 0.74), (1.04, 0.07, 1.32), SW_GLASS)
    if lod == 0:
        add_box(bm, uv, (-0.64, -0.07, 0.74), (0.28, 0.04, 1.26), SW_SHUTTER_GREEN, (0, 0, 0.24))
        add_box(bm, uv, (0.64, -0.07, 0.74), (0.28, 0.04, 1.26), SW_SHUTTER_GREEN, (0, 0, -0.24))


def build_window_ensanche(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, -0.05, 0.03), (1.62, 0.15, 0.07), SW_CONCRETE)
    add_box(bm, uv, (0, -0.05, 1.36), (1.58, 0.14, 0.22), SW_PERSIANA)
    add_box(bm, uv, (0, -0.02, 0.68), (1.46, 0.06, 1.18), SW_GLASS)
    if lod == 0:
        add_box(bm, uv, (0, -0.04, 1.06), (1.46, 0.04, 0.34), SW_PERSIANA)


def build_window_modern(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, -0.08, 1.28), (2.05, 0.24, 0.09), SW_CONCRETE)
    add_box(bm, uv, (0, -0.05, 0.03), (2.02, 0.14, 0.06), SW_CONCRETE)
    add_box(bm, uv, (0, -0.02, 0.65), (1.90, 0.06, 1.18), SW_GLASS)
    if lod == 0:
        add_box(bm, uv, (0, -0.04, 0.65), (0.06, 0.06, 1.18), SW_CHARCOAL)


def build_portal_casco(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, -0.22, -0.06), (2.35, 0.50, 0.28), SW_DARK_STONE)
    add_box(bm, uv, (-0.98, -0.08, 1.32), (0.34, 0.24, 2.52), SW_GRANITE)
    add_box(bm, uv, (0.98, -0.08, 1.32), (0.34, 0.24, 2.52), SW_GRANITE)
    add_box(bm, uv, (0, -0.05, 1.36), (1.64, 0.14, 2.54), SW_WOOD)
    arch_segs = 5 if lod == 0 else 3
    r_mid = 0.96
    for i in range(arch_segs):
        angle = math.pi * (i + 0.5) / arch_segs
        cx = -math.cos(angle) * r_mid
        cz = 2.38 + math.sin(angle) * r_mid * 0.72
        rot_y = -(angle - math.pi / 2)
        h_stone = 0.42 if i == arch_segs // 2 else 0.34
        add_box(bm, uv, (cx, -0.10, cz), (0.38, 0.26, h_stone), SW_CREAM_STONE, (0, rot_y, 0))


def build_portal_modern(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, -0.18, -0.06), (2.50, 0.42, 0.24), SW_DARK_STONE)
    add_box(bm, uv, (-1.12, -0.06, 1.28), (0.24, 0.20, 2.50), SW_DARK_STONE)
    add_box(bm, uv, (1.12, -0.06, 1.28), (0.24, 0.20, 2.50), SW_DARK_STONE)
    add_box(bm, uv, (0, -0.04, 1.24), (2.00, 0.10, 2.38), SW_GLASS_WARM)
    add_box(bm, uv, (0, -0.45, 2.58), (2.68, 0.96, 0.14), SW_CONCRETE)
    if lod == 0:
        add_box(bm, uv, (0, -0.07, 1.24), (0.07, 0.08, 2.38), SW_CHARCOAL)


def build_shopfront_awning(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int,
                           swatch_awning: tuple[int, int] = SW_AWNING_RED) -> None:
    add_box(bm, uv, (0, -0.08, 0.20), (3.10, 0.22, 0.75), SW_DARK_STONE)
    add_box(bm, uv, (0, -0.04, 1.56), (2.94, 0.12, 2.02), SW_GLASS_WARM)
    add_box(bm, uv, (0, -0.06, 2.72), (3.12, 0.18, 0.24), SW_CHARCOAL)
    add_box(bm, uv, (0, -0.58, 2.52), (3.08, 1.16, 0.07), swatch_awning, (0.32, 0, 0))
    add_box(bm, uv, (0, -1.12, 2.26), (3.08, 0.04, 0.18), swatch_awning)
    if lod == 0:
        add_box(bm, uv, (-1.48, -0.06, 1.48), (0.14, 0.16, 2.75), SW_CHARCOAL)
        add_box(bm, uv, (1.48, -0.06, 1.48), (0.14, 0.16, 2.75), SW_CHARCOAL)


def build_industrial_door(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (-1.66, -0.06, 1.65), (0.18, 0.18, 3.30), SW_STEEL)
    add_box(bm, uv, (1.66, -0.06, 1.65), (0.18, 0.18, 3.30), SW_STEEL)
    add_box(bm, uv, (0, -0.10, 3.35), (3.52, 0.28, 0.34), SW_CHARCOAL)
    add_box(bm, uv, (0, -0.04, 1.58), (3.16, 0.08, 3.20), SW_ROLL_DOOR)
    if lod == 0:
        add_cylinder(bm, uv, (-1.78, -0.26, 0.40), 0.08, 0.08, 0.90, 5, SW_SAFETY_YELLOW)
        add_cylinder(bm, uv, (1.78, -0.26, 0.40), 0.08, 0.08, 0.90, 5, SW_SAFETY_YELLOW)


def build_pilaster_corner(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    courses = 4 if lod == 0 else 2
    h = 3.0 / courses
    for i in range(courses):
        z = (i + 0.5) * h
        long_x = (i % 2) == 0
        w_x = 0.50 if long_x else 0.34
        w_y = 0.34 if long_x else 0.50
        add_box(bm, uv, (0, 0, z), (w_x, w_y, h * 0.92), SW_GRANITE if i % 2 == 0 else SW_CREAM_STONE)


def build_rooftop_penthouse(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, 0, 1.10), (2.7, 2.3, 2.50), SW_PLASTER_WHITE)
    add_box(bm, uv, (0, 0, 2.40), (2.92, 2.52, 0.16), SW_CONCRETE)
    add_box(bm, uv, (0, -1.16, 0.95), (0.88, 0.06, 1.95), SW_STEEL)
    if lod == 0:
        add_cylinder(bm, uv, (0.9, 0.6, 3.35), 0.03, 0.02, 1.9, 4, SW_STEEL)
        add_box(bm, uv, (0.9, 0.6, 4.05), (0.75, 0.04, 0.04), SW_STEEL)


def build_rooftop_hvac(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, lod: int) -> None:
    add_box(bm, uv, (0, 0, 0.44), (1.65, 0.92, 0.88), SW_STEEL)
    if lod == 0:
        add_cylinder(bm, uv, (-0.38, -0.47, 0.48), 0.28, 0.28, 0.06, 6, SW_CHARCOAL, (math.pi / 2, 0, 0))
        add_cylinder(bm, uv, (0.38, -0.47, 0.48), 0.28, 0.28, 0.06, 6, SW_CHARCOAL, (math.pi / 2, 0, 0))
        add_cylinder(bm, uv, (0.52, 0.1, 1.04), 0.22, 0.26, 0.34, 6, SW_STEEL)


def build_dormer_roof(bm: bmesh.types.BMesh, uv: bmesh.types.BMLayerItem, _lod: int) -> None:
    add_box(bm, uv, (0, 0.08, 0.30), (1.28, 1.35, 1.05), SW_PLASTER_WHITE)
    add_box(bm, uv, (0, -0.60, 0.36), (0.86, 0.06, 0.72), SW_GLASS)
    add_box(bm, uv, (-0.34, -0.10, 0.86), (0.78, 1.62, 0.12), SW_TILE, (0, -0.48, 0))
    add_box(bm, uv, (0.34, -0.10, 0.86), (0.78, 1.62, 0.12), SW_TILE, (0, 0.48, 0))


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
            "tree": build_tree,
            "traffic-signals": build_traffic_signals,
            "stop-sign": lambda bm, uv, lod: build_sign("stop", bm, uv, lod),
            "give-way-sign": lambda bm, uv, lod: build_sign("give_way", bm, uv, lod),
            "chimney": build_chimney,
            "balcony": build_balcony_historic,
            "balcony-modern": build_balcony_modern,
            "window-casco": build_window_casco,
            "window-ensanche": build_window_ensanche,
            "window-modern": build_window_modern,
            "portal-casco": build_portal_casco,
            "portal-modern": build_portal_modern,
            "shopfront-awning": lambda bm, uv, lod: build_shopfront_awning(bm, uv, lod, SW_AWNING_RED),
            "industrial-door": build_industrial_door,
            "pilaster-corner": build_pilaster_corner,
            "rooftop-penthouse": build_rooftop_penthouse,
            "rooftop-hvac": build_rooftop_hvac,
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
        "schemaVersion": 2,
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
