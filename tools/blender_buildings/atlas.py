"""Shared UV Palette & PBR Swatch Atlas generator + 2-material consolidator (FASE B).

Converts per-swatch materials used during authoring into a single 8x8 512x512 sRGB +
Metallic/Roughness + Emissive atlas pair so every exported building .glb uses at most
2 materials (CC_Atlas_Opaque and CC_Atlas_Glass) and all buildings share GPU textures.
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

import bpy

from materials import PALETTE_SPECS

ATLAS_COLS = 8
ATLAS_ROWS = 8
CELL_PX = 64
ATLAS_SIZE = ATLAS_COLS * CELL_PX  # 512x512

GLASS_SWATCHES = frozenset({"glass_sky", "glass_frosted", "glass_warm_shop", "lamp_glow"})


def _parse_hex(hex_str: str) -> tuple[int, int, int]:
    s = hex_str.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def _encode_png_rgba(width: int, height: int, rows_top_down: bytes) -> bytes:
    stride = width * 4
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        start = y * stride
        raw.extend(rows_top_down[start : start + stride])

    def chunk(tag: bytes, payload: bytes) -> bytes:
        body = tag + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), level=9)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def build_swatch_coords() -> dict[str, tuple[int, int]]:
    """Assign deterministic (col, row) coordinates (row 0 at bottom in UV space)."""
    coords: dict[str, tuple[int, int]] = {}
    for idx, name in enumerate(PALETTE_SPECS.keys()):
        if idx >= ATLAS_COLS * ATLAS_ROWS:
            raise ValueError(f"Atlas capacity ({ATLAS_COLS * ATLAS_ROWS}) exceeded by {name}")
        col = idx % ATLAS_COLS
        row = idx // ATLAS_COLS
        coords[name] = (col, row)
    return coords


def cell_uv_bounds(col: int, row: int, inset_frac: float = 0.22) -> tuple[float, float, float, float]:
    du = inset_frac / ATLAS_COLS
    dv = inset_frac / ATLAS_ROWS
    u0 = col / ATLAS_COLS + du
    u1 = (col + 1) / ATLAS_COLS - du
    v0 = row / ATLAS_ROWS + dv
    v1 = (row + 1) / ATLAS_ROWS - dv
    return u0, u1, v0, v1


def write_atlas_textures(out_dir: Path) -> tuple[Path, Path, Path, dict[str, tuple[int, int]]]:
    """Write BaseColor (sRGB), MetallicRoughness (Linear G=roughness, B=metallic), and Emissive PNGs."""
    out_dir.mkdir(parents=True, exist_ok=True)
    coords = build_swatch_coords()
    by_cell = {cell: (name, PALETTE_SPECS[name]) for name, cell in coords.items()}

    base_buf = bytearray(ATLAS_SIZE * ATLAS_SIZE * 4)
    mr_buf = bytearray(ATLAS_SIZE * ATLAS_SIZE * 4)
    em_buf = bytearray(ATLAS_SIZE * ATLAS_SIZE * 4)

    for png_y in range(ATLAS_SIZE):
        uv_y = ATLAS_SIZE - 1 - png_y
        row = uv_y // CELL_PX
        for px in range(ATLAS_SIZE):
            col = px // CELL_PX
            idx = (png_y * ATLAS_SIZE + px) * 4
            entry = by_cell.get((col, row))
            if entry is None:
                base_buf[idx : idx + 4] = bytes((210, 200, 185, 255))
                mr_buf[idx : idx + 4] = bytes((0, 204, 0, 255))
                em_buf[idx : idx + 4] = bytes((0, 0, 0, 255))
                continue

            _, spec = entry
            r, g, b = _parse_hex(str(spec["color"]))
            rough_byte = int(max(0.0, min(1.0, float(spec["roughness"]))) * 255.0 + 0.5)
            metal_byte = int(max(0.0, min(1.0, float(spec["metallic"]))) * 255.0 + 0.5)

            base_buf[idx] = r
            base_buf[idx + 1] = g
            base_buf[idx + 2] = b
            base_buf[idx + 3] = 255

            mr_buf[idx] = 0
            mr_buf[idx + 1] = rough_byte
            mr_buf[idx + 2] = metal_byte
            mr_buf[idx + 3] = 255

            if "emission" in spec:
                er, eg, eb = _parse_hex(str(spec["emission"]))
                strength = min(1.0, float(spec.get("emission_strength", 0.5)) / 2.4)
                em_buf[idx] = int(er * strength)
                em_buf[idx + 1] = int(eg * strength)
                em_buf[idx + 2] = int(eb * strength)
                em_buf[idx + 3] = 255
            else:
                em_buf[idx : idx + 4] = bytes((0, 0, 0, 255))

    base_path = out_dir / "caceres_buildings_atlas.png"
    mr_path = out_dir / "caceres_buildings_mr.png"
    em_path = out_dir / "caceres_buildings_emissive.png"
    base_path.write_bytes(_encode_png_rgba(ATLAS_SIZE, ATLAS_SIZE, bytes(base_buf)))
    mr_path.write_bytes(_encode_png_rgba(ATLAS_SIZE, ATLAS_SIZE, bytes(mr_buf)))
    em_path.write_bytes(_encode_png_rgba(ATLAS_SIZE, ATLAS_SIZE, bytes(em_buf)))
    return base_path, mr_path, em_path, coords


def _load_packed_image(path: Path, colorspace: str, name: str) -> bpy.types.Image:
    existing = bpy.data.images.get(name)
    if existing is not None:
        return existing
    img = bpy.data.images.load(str(path), check_existing=False)
    img.name = name
    img.colorspace_settings.name = colorspace
    img.pack()
    return img


def ensure_shared_atlas_materials(tex_dir: Path) -> tuple[bpy.types.Material, bpy.types.Material, dict[str, tuple[int, int]]]:
    """Create or retrieve the two shared atlas materials: CC_Atlas_Opaque and CC_Atlas_Glass."""
    base_path, mr_path, em_path, coords = write_atlas_textures(tex_dir)
    img_base = _load_packed_image(base_path, "sRGB", "caceres_buildings_atlas")
    img_mr = _load_packed_image(mr_path, "Non-Color", "caceres_buildings_mr")
    img_em = _load_packed_image(em_path, "sRGB", "caceres_buildings_emissive")

    def build_mat(mat_name: str, with_emission: bool) -> bpy.types.Material:
        mat = bpy.data.materials.get(mat_name)
        if mat is not None:
            return mat
        mat = bpy.data.materials.new(name=mat_name)
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        nodes.clear()

        out = nodes.new("ShaderNodeOutputMaterial")
        bsdf = nodes.new("ShaderNodeBsdfPrincipled")
        links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

        tex_base = nodes.new("ShaderNodeTexImage")
        tex_base.image = img_base
        tex_base.interpolation = "Closest"
        tex_base.extension = "EXTEND"
        links.new(tex_base.outputs["Color"], bsdf.inputs["Base Color"])

        tex_mr = nodes.new("ShaderNodeTexImage")
        tex_mr.image = img_mr
        tex_mr.interpolation = "Closest"
        tex_mr.extension = "EXTEND"
        sep = nodes.new("ShaderNodeSeparateColor")
        links.new(tex_mr.outputs["Color"], sep.inputs["Color"])
        links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])

        if with_emission and "Emission Color" in bsdf.inputs:
            tex_em = nodes.new("ShaderNodeTexImage")
            tex_em.image = img_em
            tex_em.interpolation = "Closest"
            tex_em.extension = "EXTEND"
            links.new(tex_em.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 1.6
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.42 if with_emission else 0.28
        return mat

    mat_opaque = build_mat("CC_Atlas_Opaque", with_emission=False)
    mat_glass = build_mat("CC_Atlas_Glass", with_emission=True)
    return mat_opaque, mat_glass, coords


def bake_object_to_shared_atlas(
    obj: bpy.types.Object,
    mat_opaque: bpy.types.Material,
    mat_glass: bpy.types.Material,
    coords: dict[str, tuple[int, int]],
    apply_bevel: bool = False,
) -> None:
    """Resolve modifiers (applying or dropping heavy bevels for crisp Stylized Low Poly budgets),
    encode swatch UVs per polygon loop, and consolidate all slots into 1-2 shared atlas materials.
    """
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        if mod.type == "BEVEL" and not apply_bevel:
            obj.modifiers.remove(mod)
        else:
            bpy.ops.object.modifier_apply(modifier=mod.name)

    mesh: bpy.types.Mesh = obj.data
    orig_names: list[str] = [m.name if m else "trim_ivory" for m in mesh.materials]
    uv_layer = mesh.uv_layers.active or mesh.uv_layers.new(name="UVMap")

    uses_glass = False
    target_indices: list[int] = [0] * len(mesh.polygons)

    for p_idx, poly in enumerate(mesh.polygons):
        mat_name = orig_names[poly.material_index] if poly.material_index < len(orig_names) else "trim_ivory"
        col, row = coords.get(mat_name, coords.get("trim_ivory", (0, 0)))
        u0, u1, v0, v1 = cell_uv_bounds(col, row)
        n = poly.loop_total
        for k in range(n):
            loop_idx = poly.loop_start + k
            if n == 4:
                uv = ((u0, v0), (u1, v0), (u1, v1), (u0, v1))[k]
            else:
                ang = 2.0 * math.pi * k / max(1, n)
                uv = (
                    u0 + (u1 - u0) * (0.5 + 0.40 * math.cos(ang)),
                    v0 + (v1 - v0) * (0.5 + 0.40 * math.sin(ang)),
                )
            uv_layer.data[loop_idx].uv = uv

        is_glass = mat_name in GLASS_SWATCHES
        if is_glass:
            uses_glass = True
            target_indices[p_idx] = 1
        else:
            target_indices[p_idx] = 0

    mesh.materials.clear()
    mesh.materials.append(mat_opaque)
    if uses_glass:
        mesh.materials.append(mat_glass)

    for p_idx, poly in enumerate(mesh.polygons):
        poly.material_index = target_indices[p_idx]
    mesh.update()
