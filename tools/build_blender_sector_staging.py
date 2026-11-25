"""Build a non-destructive representative test sector (FASE D) using the System A 8-building Blender library.

Leaves `public/world/cc-monumental/` completely untouched!
Generates `public/world/cc-blender-sector/` reusing real MDT05 terrain, road geometry,
OSM props/species, and enriched Catastro INSPIRE buildings (courtyards, AD portal coordinates,
verified heights/uses, stepped BuildingParts) with `"buildingPipeline": "blender-library"`.
"""

from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_prototype_staging as proto  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PROD_DIR = ROOT / "public/world/cc-monumental"
SECTOR_PUBLIC_DIR = ROOT / "public/world/cc-blender-sector"
SECTOR_STAGING_DIR = ROOT / "data/staging/cc-blender-sector"
ENRICHMENT_PATH = ROOT / "data/staging/cc-monumental/building_enrichment.json"

# Contiguous & representative Cáceres sector covering:
#   - Historic Monumental Quarter & Plaza Mayor (-1_-1, 0_-1, -1_0, 0_0)
#   - Ensanche 4-story / 6-story modern & commercial blocks (-2_-1, -1_-2, -3_-2, -2_-2, -3_-3, -2_-3)
#   - Chalets, traditional rural homes & civic/commercial avenue (-9_0 .. -7_-3)
SECTOR_CHUNKS = list(proto.PROTOTYPE_CHUNKS)


def build_blender_sector() -> None:
    enrichment = json.loads(ENRICHMENT_PATH.read_text(encoding="utf-8"))
    prod_manifest = json.loads((PROD_DIR / "manifest.json").read_text(encoding="utf-8"))
    extra_props, tree_species_by_id, relation_buildings = proto.extract_extra_osm_data()

    SECTOR_PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    SECTOR_STAGING_DIR.mkdir(parents=True, exist_ok=True)

    chunk_entries: list[dict] = []
    stats = Counter()

    for cid in SECTOR_CHUNKS:
        src_bin = PROD_DIR / f"{cid}.bin"
        if not src_bin.exists():
            continue
        chunk = proto.unpack_cta2(src_bin)
        bounds = chunk["bounds"]
        existing_ids: set[str] = set()
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
                    floors = info.get("osmLevels") or info.get("catastroMaxFloors") or 3
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
                    for opt_key in ("parts", "portalPoints", "catastroUse", "catastroEra"):
                        if info.get(opt_key):
                            item[opt_key] = info[opt_key]
                    new_features.append(item)
                    stats["relation_courtyard_buildings_added"] += 1

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
        binary = proto.pack_cta2(chunk)
        file_name = f"{cid}.bin"
        (SECTOR_PUBLIC_DIR / file_name).write_bytes(binary)
        (SECTOR_STAGING_DIR / file_name).write_bytes(binary)

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

    sector_manifest = {
        "schemaVersion": 1,
        "region": "cc-blender-sector",
        "buildingPipeline": "blender-library",
        "crs": prod_manifest["crs"],
        "origin": prod_manifest["origin"],
        "extentMeters": prod_manifest["extentMeters"],
        "chunkMeters": prod_manifest["chunkMeters"],
        "sectorZones": {
            "casco_historico": ["-1_-1", "0_-1", "-1_0", "0_0"],
            "ensanche_bloques": ["-2_-1", "-1_-2", "-3_-2", "-2_-2", "-3_-3", "-2_-3"],
            "vistahermosa_chalets": ["-9_0", "-8_0", "-7_0", "-9_-1", "-8_-1", "-7_-1"],
            "comercial_equipamiento": ["-9_-2", "-8_-2", "-7_-2", "-8_-3", "-7_-3"],
        },
        "chunks": chunk_entries,
    }
    manifest_text = json.dumps(sector_manifest, indent=2, ensure_ascii=False) + "\n"
    (SECTOR_PUBLIC_DIR / "manifest.json").write_text(manifest_text, encoding="utf-8")
    (SECTOR_STAGING_DIR / "manifest.json").write_text(manifest_text, encoding="utf-8")
    (SECTOR_STAGING_DIR / "sector_stats.json").write_text(
        json.dumps(dict(stats), indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"[blender-sector] built {len(chunk_entries)} chunks in {SECTOR_PUBLIC_DIR}")
    print(json.dumps(dict(stats), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    build_blender_sector()
