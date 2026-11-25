"""Phase 1 GIS cross-matching pipeline for Caceres Criminal.

Processes locally cached Overpass OSM (7.6 km x 7.6 km) and official Spanish
Catastro INSPIRE ATOM datasets (Buildings, BuildingParts, Addresses) in
ETRS89 / UTM zone 29N (EPSG:25829) relative to the Plaza Mayor game origin.

Writes non-destructive staging outputs to `data/staging/cc-monumental/`
without modifying `public/world/cc-monumental/`. Never stores or exports raw
cadastral reference numbers (`referencia catastral`), only derived 3D heights,
stepped part counts, land-use classes, era buckets, courtyard flags, and counts.
"""

from __future__ import annotations

import json
import math
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OSM_PATH = ROOT / "data/raw/osm/cc-monumental-expanded.json"
BU_ZIP_PATH = ROOT / "data/raw/catastro-atom/A.ES.SDGC.BU.10900.zip"
AD_ZIP_PATH = ROOT / "data/raw/catastro-atom/A.ES.SDGC.AD.10900.zip"
REGIONS_PATH = ROOT / "tools/config/regions.json"
STAGING_DIR = ROOT / "data/staging/cc-monumental"

# Exact constants from tools/projection.mjs
SEMI_MAJOR = 6378137.0
ECCENTRICITY_SQUARED = 0.0066943799901413165
SECOND_ECCENTRICITY_SQUARED = ECCENTRICITY_SQUARED / (1.0 - ECCENTRICITY_SQUARED)
SCALE = 0.9996
CENTRAL_MERIDIAN = math.radians(-9.0)

ORIGIN_EASTING = 726089.2276890515
ORIGIN_NORTHING = 4372723.106076299
WORLD_HALF_EXTENT = 3800.0
QUERY_MARGIN = 150.0


def project_etrs89_utm29(lon: float, lat: float) -> tuple[float, float]:
    phi = math.radians(lat)
    lam = math.radians(lon)
    sin_phi = math.sin(phi)
    cos_phi = math.cos(phi)
    tan_phi = math.tan(phi)
    e4 = ECCENTRICITY_SQUARED ** 2
    e6 = ECCENTRICITY_SQUARED ** 3
    n = SEMI_MAJOR / math.sqrt(1.0 - ECCENTRICITY_SQUARED * sin_phi ** 2)
    t = tan_phi ** 2
    c = SECOND_ECCENTRICITY_SQUARED * cos_phi ** 2
    a = cos_phi * (lam - CENTRAL_MERIDIAN)
    m = SEMI_MAJOR * (
        (1.0 - ECCENTRICITY_SQUARED / 4.0 - 3.0 * e4 / 64.0 - 5.0 * e6 / 256.0) * phi
        - (3.0 * ECCENTRICITY_SQUARED / 8.0 + 3.0 * e4 / 32.0 + 45.0 * e6 / 1024.0) * math.sin(2.0 * phi)
        + (15.0 * e4 / 256.0 + 45.0 * e6 / 1024.0) * math.sin(4.0 * phi)
        - (35.0 * e6 / 3072.0) * math.sin(6.0 * phi)
    )
    easting = 500000.0 + SCALE * n * (
        a
        + ((1.0 - t + c) * a ** 3) / 6.0
        + ((5.0 - 18.0 * t + t ** 2 + 72.0 * c - 58.0 * SECOND_ECCENTRICITY_SQUARED) * a ** 5) / 120.0
    )
    northing = SCALE * (
        m
        + n
        * tan_phi
        * (
            a ** 2 / 2.0
            + ((5.0 - t + 9.0 * c + 4.0 * c ** 2) * a ** 4) / 24.0
            + ((61.0 - 58.0 * t + t ** 2 + 600.0 * c - 330.0 * SECOND_ECCENTRICITY_SQUARED) * a ** 6) / 720.0
        )
    )
    return easting - ORIGIN_EASTING, northing - ORIGIN_NORTHING


def local_tag(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def polygon_centroid(pts: list[tuple[float, float]]) -> tuple[float, float]:
    area = 0.0
    cx = 0.0
    cz = 0.0
    n = len(pts)
    for i in range(n):
        x0, z0 = pts[i]
        x1, z1 = pts[(i + 1) % n]
        cross = x0 * z1 - x1 * z0
        area += cross
        cx += (x0 + x1) * cross
        cz += (z0 + z1) * cross
    if abs(area) < 1e-6:
        return sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n
    return cx / (3.0 * area), cz / (3.0 * area)


def point_in_poly(x: float, z: float, pts: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, zi = pts[i]
        xj, zj = pts[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi + 1e-18) + xi:
            inside = not inside
        j = i
    return inside


def parse_pos_list(text: str | None) -> list[tuple[float, float]]:
    if not text:
        return []
    vals = text.strip().split()
    if len(vals) < 6 or len(vals) % 2 != 0:
        return []
    pts: list[tuple[float, float]] = []
    for i in range(0, len(vals), 2):
        e = float(vals[i]) - ORIGIN_EASTING
        n = float(vals[i + 1]) - ORIGIN_NORTHING
        pts.append((e, n))
    if len(pts) > 3 and pts[0] == pts[-1]:
        pts.pop()
    return pts if len(pts) >= 3 else []


def era_bucket(year_str: str | None) -> str | None:
    if not year_str:
        return None
    try:
        year = int(year_str[:4])
    except ValueError:
        return None
    if year < 1900:
        return "historic_pre_1900"
    if year < 1950:
        return "classic_1900_1950"
    if year < 1985:
        return "ensanche_1950_1985"
    return "modern_1985_plus"


def in_world_box(x: float, z: float, margin: float = QUERY_MARGIN) -> bool:
    limit = WORLD_HALF_EXTENT + margin
    return -limit <= x <= limit and -limit <= z <= limit


def load_catastro_buildings() -> tuple[dict[str, dict], dict[str, dict], Counter]:
    stats: Counter = Counter()
    buildings: dict[str, dict] = {}
    parts_by_parent: dict[str, list[int]] = defaultdict(list)

    with zipfile.ZipFile(BU_ZIP_PATH) as zf:
        # 1. Stream building.gml
        with zf.open("A.ES.SDGC.BU.10900.building.gml") as fp:
            for event, elem in ET.iterparse(fp, events=("end",)):
                if local_tag(elem.tag) != "Building":
                    continue
                stats["catastro_total_buildings_municipality"] += 1
                gml_id = elem.attrib.get("{http://www.opengis.net/gml/3.2}id", "")
                local_id = gml_id.replace("ES.SDGC.BU.", "")

                ext_pts: list[tuple[float, float]] = []
                interior_count = 0
                current_use = None
                floors_above = None
                condition = None
                year_begin = None
                official_area = None

                for sub in elem.iter():
                    t = local_tag(sub.tag)
                    if t == "exterior" and not ext_pts:
                        pl = sub.find(".//{http://www.opengis.net/gml/3.2}posList")
                        if pl is not None:
                            ext_pts = parse_pos_list(pl.text)
                    elif t == "interior":
                        interior_count += 1
                    elif t == "currentUse" and sub.text:
                        current_use = sub.text.strip()
                    elif t == "numberOfFloorsAboveGround" and sub.text:
                        try:
                            floors_above = int(sub.text.strip())
                        except ValueError:
                            pass
                    elif t == "conditionOfConstruction" and sub.text:
                        condition = sub.text.strip()
                    elif t == "beginning" and sub.text and not year_begin:
                        year_begin = sub.text.strip()
                    elif t == "value" and sub.text and sub.attrib.get("uom") == "m2":
                        try:
                            official_area = float(sub.text.strip())
                        except ValueError:
                            pass

                if ext_pts:
                    cx, cz = polygon_centroid(ext_pts)
                    if in_world_box(cx, cz):
                        stats["catastro_buildings_in_7600m"] += 1
                        if interior_count > 0:
                            stats["catastro_buildings_with_courtyards"] += 1
                        xs = [p[0] for p in ext_pts]
                        zs = [p[1] for p in ext_pts]
                        buildings[local_id] = {
                            "cx": cx,
                            "cz": cz,
                            "min_x": min(xs),
                            "max_x": max(xs),
                            "min_z": min(zs),
                            "max_z": max(zs),
                            "pts": ext_pts,
                            "use": current_use,
                            "floors_bldg": floors_above,
                            "condition": condition,
                            "era": era_bucket(year_begin),
                            "area_m2": official_area,
                            "interior_rings": interior_count,
                        }
                elem.clear()

        # 2. Stream buildingpart.gml to collect real floors per constituent part
        with zf.open("A.ES.SDGC.BU.10900.buildingpart.gml") as fp:
            for event, elem in ET.iterparse(fp, events=("end",)):
                if local_tag(elem.tag) != "BuildingPart":
                    continue
                stats["catastro_total_parts_municipality"] += 1
                gml_id = elem.attrib.get("{http://www.opengis.net/gml/3.2}id", "")
                raw_id = gml_id.replace("ES.SDGC.BU.", "")
                parent_id = raw_id.split("_part")[0]
                if parent_id in buildings:
                    stats["catastro_parts_in_7600m"] += 1
                    fl_node = None
                    for sub in elem.iter():
                        if local_tag(sub.tag) == "numberOfFloorsAboveGround" and sub.text:
                            try:
                                fl_node = int(sub.text.strip())
                            except ValueError:
                                pass
                            break
                    if fl_node is not None:
                        parts_by_parent[parent_id].append(fl_node)
                elem.clear()

    # Attach part floor statistics back to in-world Catastro buildings
    part_floor_hist: Counter = Counter()
    for b_id, b in buildings.items():
        p_floors = parts_by_parent.get(b_id, [])
        b["part_count"] = max(1, len(p_floors))
        if p_floors:
            b["max_floors"] = max(p_floors)
            b["min_floors"] = min(p_floors)
            stats["catastro_buildings_with_part_floors"] += 1
            part_floor_hist[b["max_floors"]] += 1
        elif b["floors_bldg"] is not None:
            b["max_floors"] = b["floors_bldg"]
            b["min_floors"] = b["floors_bldg"]
            stats["catastro_buildings_with_part_floors"] += 1
            part_floor_hist[b["max_floors"]] += 1
        else:
            b["max_floors"] = None
            b["min_floors"] = None

    stats["top_floor_counts"] = dict(part_floor_hist.most_common(12))
    return buildings, {}, stats


def load_catastro_portals() -> tuple[list[tuple[float, float]], int]:
    portals: list[tuple[float, float]] = []
    total_muni = 0
    with zipfile.ZipFile(AD_ZIP_PATH) as zf:
        with zf.open("A.ES.SDGC.AD.10900.gml") as fp:
            for event, elem in ET.iterparse(fp, events=("end",)):
                if local_tag(elem.tag) != "Address":
                    continue
                total_muni += 1
                pos = elem.find(".//{http://www.opengis.net/gml/3.2}pos")
                if pos is not None and pos.text:
                    parts = pos.text.strip().split()
                    if len(parts) == 2:
                        x = float(parts[0]) - ORIGIN_EASTING
                        z = float(parts[1]) - ORIGIN_NORTHING
                        if in_world_box(x, z):
                            portals.append((x, z))
                elem.clear()
    return portals, total_muni


def cross_match_osm_and_catastro(
    cat_buildings: dict[str, dict],
    portals: list[tuple[float, float]],
) -> tuple[dict[str, dict], dict]:
    osm = json.loads(OSM_PATH.read_text(encoding="utf-8"))
    elements = osm.get("elements", [])

    # Spatial index for Catastro buildings (40m grid cells)
    CELL = 40.0
    cat_grid: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for b in cat_buildings.values():
        gx0 = int(math.floor((b["min_x"] - 10.0) / CELL))
        gx1 = int(math.floor((b["max_x"] + 10.0) / CELL))
        gz0 = int(math.floor((b["min_z"] - 10.0) / CELL))
        gz1 = int(math.floor((b["max_z"] + 10.0) / CELL))
        for gx in range(gx0, gx1 + 1):
            for gz in range(gz0, gz1 + 1):
                cat_grid[(gx, gz)].append(b)

    # Spatial index for Catastro address portals (20m grid cells)
    P_CELL = 20.0
    portal_grid: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
    for px, pz in portals:
        portal_grid[(int(math.floor(px / P_CELL)), int(math.floor(pz / P_CELL)))].append((px, pz))

    osm_buildings: list[dict] = []
    osm_multipolygon_buildings = 0
    osm_building_parts = 0
    osm_courtyards = 0
    osm_props_stats: Counter = Counter()
    tree_species_stats: Counter = Counter()

    for el in elements:
        tags = el.get("tags") or {}
        etype = el.get("type")
        if etype == "way" and "geometry" in el:
            if tags.get("building") and tags.get("building") != "no":
                pts = [project_etrs89_utm29(p["lon"], p["lat"]) for p in el["geometry"]]
                if len(pts) > 3 and pts[0] == pts[-1]:
                    pts.pop()
                if len(pts) >= 3:
                    cx, cz = polygon_centroid(pts)
                    if in_world_box(cx, cz, 0.0):
                        osm_buildings.append({"id": f"w{el['id']}", "tags": tags, "pts": pts, "cx": cx, "cz": cz, "courtyard": False})
            elif tags.get("building:part"):
                osm_building_parts += 1
        elif etype == "relation" and tags.get("building"):
            osm_multipolygon_buildings += 1
            outer_pts: list[tuple[float, float]] = []
            inner_count = 0
            for m in el.get("members", []):
                if m.get("type") == "way" and "geometry" in m:
                    if m.get("role") == "inner":
                        inner_count += 1
                    elif not outer_pts and len(m["geometry"]) >= 3:
                        outer_pts = [project_etrs89_utm29(p["lon"], p["lat"]) for p in m["geometry"]]
            if len(outer_pts) > 3 and outer_pts[0] == outer_pts[-1]:
                outer_pts.pop()
            if inner_count > 0:
                osm_courtyards += 1
            if len(outer_pts) >= 3:
                cx, cz = polygon_centroid(outer_pts)
                if in_world_box(cx, cz, 0.0):
                    osm_buildings.append({"id": f"r{el['id']}", "tags": tags, "pts": outer_pts, "cx": cx, "cz": cz, "courtyard": inner_count > 0})
        elif etype == "node":
            if tags.get("natural") == "tree":
                osm_props_stats["tree"] += 1
                sp = tags.get("leaf_type") or tags.get("genus") or tags.get("species") or "unspecified"
                tree_species_stats[sp] += 1
            elif tags.get("highway") == "bus_stop" or tags.get("public_transport") == "platform":
                osm_props_stats["bus_stop"] += 1
            elif tags.get("barrier") == "bollard":
                osm_props_stats["bollard"] += 1
            elif tags.get("amenity") in ("bench", "waste_basket", "fountain", "shelter", "bicycle_parking"):
                osm_props_stats[tags["amenity"]] += 1

    enrichment: dict[str, dict] = {}
    height_provenance: Counter = Counter()
    use_counts: Counter = Counter()
    era_counts: Counter = Counter()
    stepped_buildings = 0
    courtyard_buildings = 0
    portals_matched_buildings = 0

    for b in osm_buildings:
        tags = b["tags"]
        osm_levels = None
        osm_height = None
        try:
            if "building:levels" in tags:
                osm_levels = float(str(tags["building:levels"]).replace(",", "."))
        except ValueError:
            pass
        try:
            if "height" in tags:
                osm_height = float(str(tags["height"]).replace("m", "").replace(",", ".").strip())
        except ValueError:
            pass

        # Spatial lookup against Catastro Buildings
        cx, cz = b["cx"], b["cz"]
        candidates = cat_grid.get((int(math.floor(cx / CELL)), int(math.floor(cz / CELL))), [])
        best_cat = None
        best_dist = 15.0
        for cand in candidates:
            if point_in_poly(cx, cz, cand["pts"]) or point_in_poly(cand["cx"], cand["cz"], b["pts"]):
                best_cat = cand
                break
            d = math.hypot(cx - cand["cx"], cz - cand["cz"])
            if d < best_dist:
                best_dist = d
                best_cat = cand

        cat_max_fl = best_cat["max_floors"] if best_cat else None
        cat_min_fl = best_cat["min_floors"] if best_cat else None
        cat_parts = best_cat["part_count"] if best_cat else 0
        cat_use = best_cat["use"] if best_cat else None
        cat_era = best_cat["era"] if best_cat else None
        has_courtyard = bool(b["courtyard"] or (best_cat and best_cat["interior_rings"] > 0))

        # Count portals near building bounding box
        xs = [p[0] for p in b["pts"]]
        zs = [p[1] for p in b["pts"]]
        bmin_x, bmax_x = min(xs) - 5.0, max(xs) + 5.0
        bmin_z, bmax_z = min(zs) - 5.0, max(zs) + 5.0
        p_count = 0
        for px_g in range(int(math.floor(bmin_x / P_CELL)), int(math.floor(bmax_x / P_CELL)) + 1):
            for pz_g in range(int(math.floor(bmin_z / P_CELL)), int(math.floor(bmax_z / P_CELL)) + 1):
                for px, pz in portal_grid.get((px_g, pz_g), ()):
                    if bmin_x <= px <= bmax_x and bmin_z <= pz <= bmax_z:
                        p_count += 1

        if osm_height is not None or (osm_levels is not None and osm_levels > 0):
            origin = "osm_explicit"
        elif cat_max_fl is not None and cat_max_fl > 0:
            origin = "catastro_floors"
        else:
            origin = "heuristic_fallback"

        height_provenance[origin] += 1
        if best_cat:
            height_provenance["catastro_footprint_matched"] += 1
        if cat_use:
            use_counts[cat_use] += 1
        if cat_era:
            era_counts[cat_era] += 1
        if cat_parts > 1:
            stepped_buildings += 1
        if has_courtyard:
            courtyard_buildings += 1
        if p_count > 0:
            portals_matched_buildings += 1

        enrichment[b["id"]] = {
            "heightOrigin": origin,
            "osmLevels": osm_levels,
            "osmHeightMeters": osm_height,
            "catastroMaxFloors": cat_max_fl,
            "catastroMinFloors": cat_min_fl,
            "catastroPartCount": cat_parts,
            "catastroUse": cat_use,
            "catastroEra": cat_era,
            "hasCourtyard": has_courtyard,
            "nearbyPortalCount": p_count,
        }

    summary = {
        "osm_elements_total": len(elements),
        "osm_buildings_in_world": len(osm_buildings),
        "osm_relation_buildings": osm_multipolygon_buildings,
        "osm_courtyards_in_relations": osm_courtyards,
        "osm_building_parts": osm_building_parts,
        "osm_props_in_extract": dict(osm_props_stats),
        "osm_tree_taxonomy": dict(tree_species_stats.most_common(15)),
        "height_provenance": dict(height_provenance),
        "catastro_uses": dict(use_counts.most_common()),
        "catastro_eras": dict(era_counts.most_common()),
        "buildings_with_multiple_catastro_parts": stepped_buildings,
        "buildings_with_courtyard": courtyard_buildings,
        "buildings_with_portals_matched": portals_matched_buildings,
    }
    return enrichment, summary


def main() -> None:
    STAGING_DIR.mkdir(parents=True, exist_ok=True)
    print("[geo] Loading Catastro INSPIRE BU (Buildings + BuildingParts)...")
    cat_buildings, _, cat_stats = load_catastro_buildings()
    print("[geo] Loading Catastro INSPIRE AD (Addresses/Portals)...")
    portals, total_ad_muni = load_catastro_portals()
    print(f"[geo] Loaded {len(cat_buildings)} Catastro buildings and {len(portals)} portals inside 7.6 km.")
    enrichment, summary = cross_match_osm_and_catastro(cat_buildings, portals)

    summary["catastro_atom_stats"] = dict(cat_stats)
    summary["catastro_portals_total_municipality"] = total_ad_muni
    summary["catastro_portals_in_7600m"] = len(portals)

    (STAGING_DIR / "building_enrichment.json").write_text(
        json.dumps(enrichment, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    (STAGING_DIR / "phase1_stats.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
