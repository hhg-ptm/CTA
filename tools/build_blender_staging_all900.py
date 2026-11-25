"""Build the complete 900-chunk Cáceres reconstruction into non-destructive staging.

NEVER touches `public/world/cc-monumental/`.
Reads all 900 real MDT05 terrain + street + building chunks from `public/world/cc-monumental/`,
enriches every building with real Catastro INSPIRE heights/uses/courtyards/portals/parts,
tags all 8+ real Cáceres neighborhoods & land-use districts (`casco`, `canovas_centro`,
`nuevo_caceres`, `mejostilla`, `aldea_moret`, `industrial`, `campus`, `chalets`,
`comercial`, `residencial`, `periferia`), injects OSM relation courtyards and extra street
props/species, and copies road-network / walk-route / source-fidelity cleanly to:
  - `public/world/cc-blender-staging/` (live playable staging world via `?world=cc-blender-staging`)
  - `data/staging/cc-blender-staging/` (full coverage manifest & staging statistics)
"""

from __future__ import annotations

import hashlib
import json
import math
import shutil
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_prototype_staging as proto  # noqa: E402
import caceres_geo_processing as geo  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PROD_DIR = ROOT / "public/world/cc-monumental"
STAGING_PUBLIC_DIR = ROOT / "public/world/cc-blender-staging"
STAGING_DATA_DIR = ROOT / "data/staging/cc-blender-staging"
ENRICHMENT_PATH = ROOT / "data/staging/cc-monumental/building_enrichment.json"
OSM_PATH = ROOT / "data/raw/osm/cc-monumental-expanded.json"

INDUSTRIAL_BTYPES = {
    "industrial",
    "warehouse",
    "manufacture",
    "garages",
    "shed",
    "farm_auxiliary",
    "service",
    "storage_tank",
}
CIVIC_BTYPES = {
    "public",
    "civic",
    "townhall",
    "school",
    "university",
    "college",
    "hospital",
    "museum",
    "police",
    "fire_station",
    "train_station",
    "bus_station",
    "sports_centre",
    "church",
    "chapel",
    "cathedral",
    "monastery",
}
COMMERCIAL_BTYPES = {
    "commercial",
    "retail",
    "supermarket",
    "shop",
    "cafe",
    "restaurant",
    "kiosk",
    "marketplace",
}
CHALET_BTYPES = {"detached", "house", "semidetached_house", "bungalow", "terrace", "farm"}


def polygon_centroid(points: list[list[float]]) -> tuple[float, float]:
    if not points:
        return 0.0, 0.0
    xs = [p[0] for p in points]
    zs = [p[1] for p in points]
    return sum(xs) / len(xs), sum(zs) / len(zs)


def point_in_poly(x: float, z: float, poly: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(poly)
    for i in range(n):
        x1, z1 = poly[i]
        x2, z2 = poly[(i + 1) % n]
        if (z1 > z) != (z2 > z):
            x_int = (x2 - x1) * (z - z1) / ((z2 - z1) or 1e-9) + x1
            if x < x_int:
                inside = not inside
    return inside


def extract_landuse_zones() -> list[tuple[str, tuple[float, float, float, float], list[tuple[float, float]]]]:
    osm = json.loads(OSM_PATH.read_text(encoding="utf-8"))
    zones = []
    for el in osm.get("elements", []):
        tags = el.get("tags") or {}
        lu = tags.get("landuse", "")
        am = tags.get("amenity", "")
        label = ""
        if lu == "industrial":
            label = "industrial"
        elif am in ("university", "hospital"):
            label = "campus"
        elif lu in ("commercial", "retail"):
            label = "comercial"
        if not label:
            continue
        geom = el.get("geometry") or []
        if len(geom) < 3:
            continue
        pts = [geo.project_etrs89_utm29(p["lon"], p["lat"]) for p in geom]
        xs = [p[0] for p in pts]
        zs = [p[1] for p in pts]
        zones.append((label, (min(xs), max(xs), min(zs), max(zs)), pts))
    return zones


def classify_district(
    feat: dict,
    cx: float,
    cz: float,
    landuse_zones: list[tuple[str, tuple[float, float, float, float], list[tuple[float, float]]]],
) -> str:
    zone = feat.get("zone", "ensanche")
    btype = (feat.get("buildingType") or "").lower()
    use = feat.get("catastroUse") or ""

    if zone == "casco":
        return "casco"
    if use == "3_industrial" or btype in INDUSTRIAL_BTYPES:
        return "industrial"
    if btype in ("university", "college", "hospital") or (1800 <= cx <= 3850 and -250 <= cz <= 1300):
        return "campus"
    if (
        feat.get("commercial")
        or btype in COMMERCIAL_BTYPES
        or use in ("4_2_retail", "4_1_office")
    ):
        return "comercial"

    for label, (x0, x1, z0, z1), poly in landuse_zones:
        if x0 <= cx <= x1 and z0 <= cz <= z1 and point_in_poly(cx, cz, poly):
            return label

    if zone == "ensanche" and -900 <= cx <= 700 and -850 <= cz <= 700:
        return "canovas_centro"
    if cz >= 850 and -950 <= cx <= 1500:
        return "mejostilla"
    if -1650 <= cx <= 250 and -3200 <= cz <= -1800:
        return "aldea_moret"
    if -2300 <= cx <= -900 and -1600 <= cz <= -100:
        return "nuevo_caceres"
    if btype in CHALET_BTYPES or (cx <= -1500 and -300 <= cz <= 450):
        return "chalets"
    if zone == "ensanche":
        return "residencial"
    return "periferia"


def ensure_closed_ring(pts: list[list[float]]) -> list[list[float]]:
    if len(pts) >= 3 and (pts[0][0] != pts[-1][0] or pts[0][1] != pts[-1][1]):
        return [*pts, [pts[0][0], pts[0][1]]]
    return pts


def build_all900_staging() -> None:
    enrichment = json.loads(ENRICHMENT_PATH.read_text(encoding="utf-8"))
    prod_manifest = json.loads((PROD_DIR / "manifest.json").read_text(encoding="utf-8"))
    extra_props, tree_species_by_id, relation_buildings = proto.extract_extra_osm_data()
    landuse_zones = extract_landuse_zones()

    # Spatial index extra props & relation buildings by chunk coordinates for fast O(N) assignment
    props_by_chunk: dict[str, list[dict]] = {}
    for ep in extra_props:
        px, pz = ep["position"]
        cid = f"{math.floor(px / 256.0)}_{math.floor(pz / 256.0)}"
        props_by_chunk.setdefault(cid, []).append(ep)

    relations_by_chunk: dict[str, list[dict]] = {}
    for rb in relation_buildings:
        rb_b = rb["bounds"]
        cmin_x = math.floor(rb_b["minX"] / 256.0)
        cmax_x = math.floor(rb_b["maxX"] / 256.0)
        cmin_z = math.floor(rb_b["minZ"] / 256.0)
        cmax_z = math.floor(rb_b["maxZ"] / 256.0)
        for cz_i in range(cmin_z, cmax_z + 1):
            for cx_i in range(cmin_x, cmax_x + 1):
                relations_by_chunk.setdefault(f"{cx_i}_{cz_i}", []).append(rb)

    STAGING_PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    STAGING_DATA_DIR.mkdir(parents=True, exist_ok=True)

    chunk_entries: list[dict] = []
    stats = Counter()
    district_counts = Counter()
    zone_counts = Counter()
    unique_buildings: dict[str, dict] = {}
    sectors_meta = {
        "sector_1_casco_centro": ["-1_-1", "0_-1", "-1_0", "0_0"],
        "sector_2_canovas_residencial": ["-3_-2", "-2_-2", "-2_-1", "-3_-3"],
        "sector_3_nuevo_caceres_comercial": ["-7_-2", "-8_-2", "-5_-5", "-6_-5"],
        "sector_4_mejostilla_periferia": ["1_5", "2_6", "0_5", "-8_0"],
        "sector_5_aldea_moret_industrial": ["1_-10", "2_-10", "1_-11", "-5_-10"],
        "sector_6_campus_hospital": ["9_2", "10_2", "10_1", "13_0"],
    }

    for entry in prod_manifest["chunks"]:
        cid = entry["id"]
        src_bin = PROD_DIR / entry["path"]
        chunk = proto.unpack_cta2(src_bin)
        bounds = chunk["bounds"]
        existing_ids: set[str] = set()
        new_features: list[dict] = []

        for feat in chunk["features"]:
            fid = feat.get("id")
            if fid:
                existing_ids.add(fid)
            if feat.get("featureType") == "building":
                updated = dict(feat)
                if fid in enrichment:
                    info = enrichment[fid]
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
                else:
                    stats["buildings_without_enrichment"] += 1

                pts = updated.get("points") or []
                cx, cz = polygon_centroid(pts)
                district = classify_district(updated, cx, cz, landuse_zones)
                updated["district"] = district
                stats["building_features_total"] += 1
                if fid and fid not in unique_buildings:
                    unique_buildings[fid] = {
                        "zone": updated.get("zone", "ensanche"),
                        "district": district,
                    }
                    zone_counts[updated.get("zone", "ensanche")] += 1
                    district_counts[district] += 1
                new_features.append(updated)
            elif feat.get("featureType") == "prop":
                updated = dict(feat)
                if feat.get("kind") == "tree" and fid in tree_species_by_id:
                    updated["treeSpecies"] = tree_species_by_id[fid]
                    stats["trees_osm_tagged"] += 1
                new_features.append(updated)
            else:
                new_features.append(feat)

        for rb in relations_by_chunk.get(cid, []):
            rid = rb["id"]
            if rid in existing_ids:
                continue
            info = enrichment.get(rid, {})
            floors = max(1, min(40, int(info.get("osmLevels") or info.get("catastroMaxFloors") or 3)))
            pts = ensure_closed_ring(rb["points"])
            if len(pts) < 4:
                continue
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
                "visualHeightMeters": max(3.0, min(80.0, floors * 3.2)),
                "heightOrigin": info.get("heightOrigin", "estimated"),
                "points": pts,
                "innerRings": rb["innerRings"],
            }
            for opt_key in ("parts", "portalPoints", "catastroUse", "catastroEra"):
                if info.get(opt_key):
                    item[opt_key] = info[opt_key]
            cx, cz = polygon_centroid(pts)
            district = classify_district(item, cx, cz, landuse_zones)
            item["district"] = district
            existing_ids.add(rid)
            if rid not in unique_buildings:
                unique_buildings[rid] = {"zone": item["zone"], "district": district}
                zone_counts[item["zone"]] += 1
                district_counts[district] += 1
            stats["relation_courtyard_buildings_added"] += 1
            new_features.append(item)

        for ep in props_by_chunk.get(cid, []):
            if ep["id"] not in existing_ids:
                new_features.append(ep)
                existing_ids.add(ep["id"])
                stats[f"extra_prop_{ep['kind']}"] += 1

        chunk["features"] = new_features
        binary = proto.pack_cta2(chunk)
        file_name = entry["path"]
        (STAGING_PUBLIC_DIR / file_name).write_bytes(binary)

        chunk_entries.append(
            {
                "id": cid,
                "path": file_name,
                "bounds": bounds,
                "bytes": len(binary),
                "sha256": hashlib.sha256(binary).hexdigest(),
                "featureCount": len(new_features),
                "missingTerrainSamples": entry.get("missingTerrainSamples", 0),
            }
        )

    # Copy road-network.json & walk-route.json verbatim, and rewrite source-fidelity region tag cleanly
    for fname in ("road-network.json", "walk-route.json"):
        src = PROD_DIR / fname
        if src.exists():
            shutil.copy2(src, STAGING_PUBLIC_DIR / fname)

    fidelity_src = PROD_DIR / "source-fidelity.json"
    source_geometry_meta = dict(prod_manifest.get("sourceGeometry", {}))
    if fidelity_src.exists():
        fid_data = json.loads(fidelity_src.read_text(encoding="utf-8"))
        fid_data["region"] = "cc-blender-staging"
        fid_bytes = (json.dumps(fid_data, ensure_ascii=False, separators=(",", ":")) + "\n").encode(
            "utf-8"
        )
        (STAGING_PUBLIC_DIR / "source-fidelity.json").write_bytes(fid_bytes)
        source_geometry_meta["bytes"] = len(fid_bytes)
        source_geometry_meta["sha256"] = hashlib.sha256(fid_bytes).hexdigest()

    staging_manifest = {
        "schemaVersion": 1,
        "region": "cc-blender-staging",
        "buildingPipeline": "blender-library",
        "crs": prod_manifest["crs"],
        "origin": prod_manifest["origin"],
        "extentMeters": prod_manifest["extentMeters"],
        "chunkMeters": prod_manifest["chunkMeters"],
        "bounds": prod_manifest.get("bounds"),
        "source": prod_manifest.get("source"),
        "sourceGeometry": source_geometry_meta,
        "roadNetwork": prod_manifest.get("roadNetwork"),
        "walkRoute": prod_manifest.get("walkRoute"),
        "sectorZones": sectors_meta,
        "counts": {
            **prod_manifest.get("counts", {}),
            "buildingsInWorld": len(unique_buildings),
            "buildingsInWorldByZone": dict(zone_counts),
            "buildingsInWorldByDistrict": dict(district_counts),
        },
        "chunks": chunk_entries,
    }
    manifest_text = json.dumps(staging_manifest, indent=2, ensure_ascii=False) + "\n"
    (STAGING_PUBLIC_DIR / "manifest.json").write_text(manifest_text, encoding="utf-8")
    (STAGING_DATA_DIR / "manifest.json").write_text(manifest_text, encoding="utf-8")
    coverage_report = {
        "totalChunks": len(chunk_entries),
        "uniqueBuildings": len(unique_buildings),
        "zoneCounts": dict(zone_counts),
        "districtCounts": dict(district_counts),
        "enrichmentStats": dict(stats),
        "sectors": sectors_meta,
    }
    (STAGING_DATA_DIR / "coverage_stats.json").write_text(
        json.dumps(coverage_report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"[all900-staging] built {len(chunk_entries)} chunks, {len(unique_buildings)} unique buildings.")
    print("ZONES:", dict(zone_counts))
    print("DISTRICTS:", dict(district_counts))
    print("STATS:", dict(stats))


if __name__ == "__main__":
    build_all900_staging()
