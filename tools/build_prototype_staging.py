"""Build a non-destructive 4-zone FASE 2 prototype world in staging + cc-prototype.

Leaves `public/world/cc-monumental/` completely untouched.
Reads existing MDT05 terrain + roads + surfaces from the selected chunks of
`public/world/cc-monumental/`, and enriches every building and street prop with
real Catastro INSPIRE BuildingParts, inner courtyards, AD portal coordinates,
tree species, bus stops, benches, bins, fountains, and shrubs from staging.

Prototype zones covered (with full surrounding chunk padding):
  1. Casco Histórico & Plaza Mayor (-1_-1, 0_-1, -1_0, 0_0)
  2. Bloque residencial moderno de varias plantas / Cánovas (-3_-3, -2_-3, -3_-2, -2_-2, -1_-2, -2_-1)
  3. Viviendas unifamiliares (Vistahermosa) (-9_0, -8_0, -7_0, -9_-1, -8_-1, -7_-1)
  4. Zona comercial (El Vivero + Eje Centro) (-9_-2, -8_-2, -7_-2, -8_-3, -7_-3)
"""

from __future__ import annotations

import hashlib
import json
import struct
import sys
import zlib
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import caceres_geo_processing as geo  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PROD_DIR = ROOT / "public/world/cc-monumental"
PROTO_PUBLIC_DIR = ROOT / "public/world/cc-prototype"
PROTO_STAGING_DIR = ROOT / "data/staging/cc-prototype"
ENRICHMENT_PATH = ROOT / "data/staging/cc-monumental/building_enrichment.json"
OSM_PATH = ROOT / "data/raw/osm/cc-monumental-expanded.json"

PROTOTYPE_CHUNKS = [
    # Casco Histórico + Centro
    "-1_-1", "0_-1", "-1_0", "0_0",
    "-2_-1", "-1_-2", "1_-1", "1_0",
    # Bloque residencial moderno de varias plantas (Cánovas / Av. España)
    "-3_-3", "-2_-3", "-3_-2", "-2_-2",
    # Viviendas unifamiliares (Vistahermosa) + Zona comercial (El Vivero)
    "-9_0", "-8_0", "-7_0",
    "-9_-1", "-8_-1", "-7_-1",
    "-9_-2", "-8_-2", "-7_-2",
    "-8_-3", "-7_-3",
]


def unpack_cta2(path: Path) -> dict:
    raw = path.read_bytes()
    assert raw[:4] == b"CTA2", f"Invalid header in {path}"
    uncompressed_len = struct.unpack_from("<I", raw, 8)[0]
    payload = zlib.decompress(raw[12:])
    assert len(payload) == uncompressed_len
    return json.loads(payload.decode("utf-8"))


def pack_cta2(chunk_obj: dict) -> bytes:
    payload = json.dumps(chunk_obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    compressed = zlib.compress(payload, level=9)
    header = b"CTA2" + struct.pack("<HHI", 1, 0, len(payload))
    return header + compressed


def extract_extra_osm_data() -> tuple[list[dict], list[dict]]:
    """Extract extra street props (bus stops, benches, bins, fountains, shrubs, tree species)
    and OSM relation buildings not covered in legacy way-only chunks.
    """
    osm = json.loads(OSM_PATH.read_text(encoding="utf-8"))
    elements = osm.get("elements", [])
    extra_props: list[dict] = []
    tree_species_by_id: dict[str, str] = {}
    relation_buildings: list[dict] = []

    for el in elements:
        tags = el.get("tags") or {}
        etype = el.get("type")
        if etype == "node" and "lon" in el and "lat" in el:
            x, z = geo.project_etrs89_utm29(el["lon"], el["lat"])
            if not geo.in_world_box(x, z, 0.0):
                continue
            eid = f"n{el['id']}"
            if tags.get("natural") == "tree":
                sp = geo.infer_tree_species(tags)
                if sp:
                    tree_species_by_id[eid] = sp
                continue
            kind = None
            if tags.get("highway") == "bus_stop" or tags.get("public_transport") == "platform":
                kind = "bus_stop"
            elif tags.get("amenity") in ("fountain", "bench", "waste_basket", "shelter"):
                kind = tags["amenity"]
            elif tags.get("natural") == "shrub" or tags.get("barrier") == "hedge":
                kind = "shrub"
            if kind:
                extra_props.append(
                    {
                        "id": eid,
                        "featureType": "prop",
                        "kind": kind,
                        "position": [round(x, 3), round(z, 3)],
                        "directionDegrees": None,
                        "trafficSign": "",
                    }
                )
        elif etype == "way" and "geometry" in el:
            if tags.get("barrier") == "hedge" or tags.get("natural") == "scrub":
                pts = [geo.project_etrs89_utm29(p["lon"], p["lat"]) for p in el["geometry"]]
                if pts:
                    cx, cz = geo.polygon_centroid(pts)
                    extra_props.append(
                        {
                            "id": f"w{el['id']}:hedge",
                            "featureType": "prop",
                            "kind": "hedge" if tags.get("barrier") == "hedge" else "shrub",
                            "position": [round(cx, 3), round(cz, 3)],
                            "directionDegrees": 0,
                            "trafficSign": "",
                        }
                    )
        elif etype == "relation" and tags.get("building"):
            outer_pts = []
            inner_rings = []
            for m in el.get("members", []):
                if m.get("type") == "way" and "geometry" in m:
                    pts = [geo.project_etrs89_utm29(p["lon"], p["lat"]) for p in m["geometry"]]
                    if m.get("role") == "inner" and len(pts) >= 3:
                        inner_rings.append([[round(p[0], 2), round(p[1], 2)] for p in pts])
                    elif not outer_pts and len(pts) >= 3:
                        outer_pts = [[round(p[0], 2), round(p[1], 2)] for p in pts]
            if len(outer_pts) >= 3:
                xs = [p[0] for p in outer_pts]
                zs = [p[1] for p in outer_pts]
                relation_buildings.append(
                    {
                        "id": f"r{el['id']}",
                        "featureType": "building",
                        "name": tags.get("name", ""),
                        "buildingType": tags.get("building", "yes"),
                        "historic": tags.get("historic", ""),
                        "roofShape": tags.get("roof:shape", "unknown"),
                        "zone": "casco" if abs(sum(xs) / len(xs)) <= 240 and abs(sum(zs) / len(zs)) <= 240 else "ensanche",
                        "points": outer_pts,
                        "innerRings": inner_rings,
                        "bounds": {"minX": min(xs), "maxX": max(xs), "minZ": min(zs), "maxZ": max(zs)},
                    }
                )

    return extra_props, tree_species_by_id, relation_buildings


def enrich_prototype() -> None:
    enrichment = json.loads(ENRICHMENT_PATH.read_text(encoding="utf-8"))
    prod_manifest = json.loads((PROD_DIR / "manifest.json").read_text(encoding="utf-8"))
    extra_props, tree_species_by_id, relation_buildings = extract_extra_osm_data()

    PROTO_PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    PROTO_STAGING_DIR.mkdir(parents=True, exist_ok=True)

    chunk_entries: list[dict] = []
    stats = Counter()

    for cid in PROTOTYPE_CHUNKS:
        src_bin = PROD_DIR / f"{cid}.bin"
        if not src_bin.exists():
            continue
        chunk = unpack_cta2(src_bin)
        bounds = chunk["bounds"]
        existing_ids = set()

        new_features: list[dict] = []
        for feat in chunk["features"]:
            fid = feat.get("id")
            if fid:
                existing_ids.add(fid)
            if feat.get("featureType") == "building" and fid in enrichment:
                info = enrichment[fid]
                updated = dict(feat)
                updated["heightOrigin"] = info["heightOrigin"]
                if info.get("catastroUse"):
                    updated["catastroUse"] = info["catastroUse"]
                if info.get("catastroEra"):
                    updated["catastroEra"] = info["catastroEra"]
                if info.get("innerRings"):
                    updated["innerRings"] = info["innerRings"]
                    stats["buildings_with_courtyards"] += 1
                if info.get("parts"):
                    updated["parts"] = info["parts"]
                    stats["buildings_with_stepped_parts"] += 1
                if info.get("portalPoints"):
                    updated["portalPoints"] = info["portalPoints"]
                    stats["buildings_with_portals"] += 1

                # Apply real Catastro floor count when OSM lacked explicit height/levels
                if info["heightOrigin"] == "catastro_floors" and info.get("catastroMaxFloors"):
                    cfl = max(1, min(40, int(info["catastroMaxFloors"])))
                    updated["floors"] = cfl
                    updated["visualFloors"] = cfl
                    updated["visualHeightMeters"] = max(2.8, min(80.0, cfl * 3.1))
                    stats["buildings_height_from_catastro"] += 1
                elif info["heightOrigin"] == "osm_explicit":
                    stats["buildings_height_from_osm"] += 1
                elif info["heightOrigin"] == "estimated":
                    stats["buildings_height_estimated"] += 1
                else:
                    stats["buildings_height_unknown"] += 1

                stats["buildings_total"] += 1
                new_features.append(updated)
            elif feat.get("featureType") == "prop":
                updated = dict(feat)
                if feat.get("kind") == "tree" and fid in tree_species_by_id:
                    updated["treeSpecies"] = tree_species_by_id[fid]
                    stats["trees_osm_tagged"] += 1
                new_features.append(updated)
            else:
                new_features.append(feat)

        # Inject OSM relation courtyard buildings intersecting this chunk
        for rb in relation_buildings:
            rb_b = rb["bounds"]
            if (
                rb_b["maxX"] >= bounds["minX"]
                and rb_b["minX"] <= bounds["maxX"]
                and rb_b["maxZ"] >= bounds["minZ"]
                and rb_b["minZ"] <= bounds["maxZ"]
            ):
                rid = rb["id"]
                if rid not in existing_ids:
                    info = enrichment.get(rid, {})
                    floors = (
                        info.get("osmLevels")
                        or info.get("catastroMaxFloors")
                        or 3
                    )
                    item = {
                        "id": rid,
                        "featureType": "building",
                        "name": rb["name"],
                        "buildingType": rb["buildingType"],
                        "historic": rb["historic"],
                        "roofShape": rb["roofShape"],
                        "roofMaterial": "tile" if rb["zone"] == "casco" else "modern",
                        "zone": rb["zone"],
                        "visualFloors": floors,
                        "visualHeightMeters": max(3.0, floors * 3.2),
                        "heightOrigin": info.get("heightOrigin", "estimated"),
                        "points": rb["points"],
                        "innerRings": rb["innerRings"],
                    }
                    if info.get("parts"):
                        item["parts"] = info["parts"]
                    if info.get("portalPoints"):
                        item["portalPoints"] = info["portalPoints"]
                    if info.get("catastroUse"):
                        item["catastroUse"] = info["catastroUse"]
                    if info.get("catastroEra"):
                        item["catastroEra"] = info["catastroEra"]
                    new_features.append(item)
                    stats["relation_courtyard_buildings_added"] += 1

        # Inject extra real OSM furniture (bus_stop, fountain, bench, waste_basket, shrub, hedge)
        for ep in extra_props:
            px, pz = ep["position"]
            if (
                ep["id"] not in existing_ids
                and bounds["minX"] <= px <= bounds["maxX"]
                and bounds["minZ"] <= pz <= bounds["maxZ"]
            ):
                new_features.append(ep)
                stats[f"extra_prop_{ep['kind']}"] += 1

        chunk["features"] = new_features
        binary = pack_cta2(chunk)
        file_name = f"{cid}.bin"
        (PROTO_PUBLIC_DIR / file_name).write_bytes(binary)
        (PROTO_STAGING_DIR / file_name).write_bytes(binary)

        chunk_entries.append(
            {
                "id": cid,
                "path": file_name,
                "bounds": bounds,
                "bytes": len(binary),
                "sha256": hashlib.sha256(binary).hexdigest(),
                "featureCount": len(new_features),
            }
        )

    proto_manifest = {
        "schemaVersion": 1,
        "region": "cc-prototype",
        "crs": prod_manifest["crs"],
        "origin": prod_manifest["origin"],
        "extentMeters": prod_manifest["extentMeters"],
        "chunkMeters": prod_manifest["chunkMeters"],
        "prototypeZones": {
            "casco_historico": ["-1_-1", "0_-1", "-1_0", "0_0"],
            "residencial_alta": ["-3_-3", "-2_-3", "-3_-2", "-2_-2"],
            "unifamiliares_vistahermosa": ["-9_0", "-8_0", "-7_0", "-9_-1", "-8_-1", "-7_-1"],
            "comercial_el_vivero": ["-9_-2", "-8_-2", "-7_-2", "-8_-3", "-7_-3"],
        },
        "chunks": chunk_entries,
    }
    manifest_text = json.dumps(proto_manifest, indent=2, ensure_ascii=False) + "\n"
    (PROTO_PUBLIC_DIR / "manifest.json").write_text(manifest_text, encoding="utf-8")
    (PROTO_STAGING_DIR / "manifest.json").write_text(manifest_text, encoding="utf-8")
    (PROTO_STAGING_DIR / "prototype_stats.json").write_text(
        json.dumps(dict(stats), indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"[prototype] built {len(chunk_entries)} enriched chunks in {PROTO_PUBLIC_DIR}")
    print(json.dumps(dict(stats), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    enrich_prototype()
