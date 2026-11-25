"""Phase 1 & 2 GIS cross-matching pipeline for Caceres Criminal.

Processes locally cached Overpass OSM (7.6 km x 7.6 km) and official Spanish
Catastro INSPIRE ATOM datasets (Buildings, BuildingParts, OtherConstruction,
and Addresses) in ETRS89 / UTM zone 29N (EPSG:25829) relative to the Plaza Mayor
game origin.

Writes non-destructive staging outputs to `data/staging/cc-monumental/`
without modifying `public/world/cc-monumental/`. Never stores or exports raw
cadastral reference numbers (`referencia catastral`), only derived 3D heights,
real stepped part geometry, land-use classes, era buckets, courtyard inner
rings, nearby portal coordinates, and summary counts.
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

KNOWN_HEURISTIC_TYPES = {
    "apartments",
    "residential",
    "house",
    "detached",
    "semidetached_house",
    "terrace",
    "bungalow",
    "industrial",
    "warehouse",
    "garages",
    "commercial",
    "retail",
    "supermarket",
    "office",
    "hotel",
    "hospital",
    "school",
    "college",
    "university",
    "public",
    "civic",
    "cathedral",
    "church",
    "chapel",
    "monastery",
    "palace",
    "castle",
    "manor",
    "tower",
    "train_station",
    "bus_station",
    "sports_hall",
    "sports_centre",
    "stadium",
    "farm",
    "farm_auxiliary",
}


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


def polygon_signed_area(pts: list[tuple[float, float]]) -> float:
    area = 0.0
    n = len(pts)
    for i in range(n):
        x0, z0 = pts[i]
        x1, z1 = pts[(i + 1) % n]
        area += x0 * z1 - x1 * z0
    return area


def polygon_centroid(pts: list[tuple[float, float]]) -> tuple[float, float]:
    area = polygon_signed_area(pts)
    cx = 0.0
    cz = 0.0
    n = len(pts)
    if abs(area) < 1e-6:
        return sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n
    for i in range(n):
        x0, z0 = pts[i]
        x1, z1 = pts[(i + 1) % n]
        cross = x0 * z1 - x1 * z0
        cx += (x0 + x1) * cross
        cz += (z0 + z1) * cross
    return cx / (3.0 * area), cz / (3.0 * area)


def simplify_ring(pts: list[tuple[float, float]], min_edge: float = 0.35) -> list[list[float]]:
    if len(pts) < 3:
        return []
    cleaned: list[tuple[float, float]] = [pts[0]]
    for pt in pts[1:]:
        if math.hypot(pt[0] - cleaned[-1][0], pt[1] - cleaned[-1][1]) >= min_edge:
            cleaned.append(pt)
    if len(cleaned) > 3 and math.hypot(cleaned[-1][0] - cleaned[0][0], cleaned[-1][1] - cleaned[0][1]) < min_edge:
        cleaned.pop()
    return [[round(p[0], 2), round(p[1], 2)] for p in cleaned] if len(cleaned) >= 3 else []


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


def load_catastro_buildings() -> tuple[dict[str, dict], list[dict], Counter]:
    stats: Counter = Counter()
    buildings: dict[str, dict] = {}
    parts_by_parent: dict[str, list[dict]] = defaultdict(list)
    other_constructions: list[dict] = []

    with zipfile.ZipFile(BU_ZIP_PATH) as zf:
        # 1. Stream building.gml (exterior + interior courtyards)
        with zf.open("A.ES.SDGC.BU.10900.building.gml") as fp:
            for _event, elem in ET.iterparse(fp, events=("end",)):
                if local_tag(elem.tag) != "Building":
                    continue
                stats["catastro_total_buildings_municipality"] += 1
                gml_id = elem.attrib.get("{http://www.opengis.net/gml/3.2}id", "")
                local_id = gml_id.replace("ES.SDGC.BU.", "")

                ext_pts: list[tuple[float, float]] = []
                int_rings: list[list[tuple[float, float]]] = []
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
                        pl = sub.find(".//{http://www.opengis.net/gml/3.2}posList")
                        if pl is not None:
                            ring = parse_pos_list(pl.text)
                            if len(ring) >= 3 and abs(polygon_signed_area(ring)) * 0.5 >= 4.0:
                                int_rings.append(ring)
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
                        if int_rings:
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
                            "interior_rings_pts": int_rings,
                            "use": current_use,
                            "floors_bldg": floors_above,
                            "condition": condition,
                            "era": era_bucket(year_begin),
                            "area_m2": official_area,
                        }
                elem.clear()

        # 2. Stream buildingpart.gml for real per-part geometry and floor counts
        with zf.open("A.ES.SDGC.BU.10900.buildingpart.gml") as fp:
            for _event, elem in ET.iterparse(fp, events=("end",)):
                if local_tag(elem.tag) != "BuildingPart":
                    continue
                stats["catastro_total_parts_municipality"] += 1
                gml_id = elem.attrib.get("{http://www.opengis.net/gml/3.2}id", "")
                raw_id = gml_id.replace("ES.SDGC.BU.", "")
                parent_id = raw_id.split("_part")[0]
                if parent_id in buildings:
                    stats["catastro_parts_in_7600m"] += 1
                    fl_node = None
                    part_pts: list[tuple[float, float]] = []
                    for sub in elem.iter():
                        t = local_tag(sub.tag)
                        if t == "exterior" and not part_pts:
                            pl = sub.find(".//{http://www.opengis.net/gml/3.2}posList")
                            if pl is not None:
                                part_pts = parse_pos_list(pl.text)
                        elif t == "numberOfFloorsAboveGround" and sub.text:
                            try:
                                fl_node = int(sub.text.strip())
                            except ValueError:
                                pass
                    if fl_node is not None and fl_node > 0 and len(part_pts) >= 3:
                        area = abs(polygon_signed_area(part_pts)) * 0.5
                        if area >= 6.0:
                            parts_by_parent[parent_id].append(
                                {
                                    "pts": part_pts,
                                    "floors": fl_node,
                                    "area": area,
                                    "cx": polygon_centroid(part_pts)[0],
                                    "cz": polygon_centroid(part_pts)[1],
                                }
                            )
                    elif fl_node is not None:
                        parts_by_parent[parent_id].append({"pts": [], "floors": fl_node, "area": 0.0})
                elem.clear()

        # 3. Stream otherconstruction.gml (pools/ancillary) to identify non-building footprints honestly
        with zf.open("A.ES.SDGC.BU.10900.otherconstruction.gml") as fp:
            for _event, elem in ET.iterparse(fp, events=("end",)):
                if local_tag(elem.tag) != "OtherConstruction":
                    continue
                stats["catastro_otherconstruction_municipality"] += 1
                nature = None
                oc_pts: list[tuple[float, float]] = []
                for sub in elem.iter():
                    t = local_tag(sub.tag)
                    if t == "constructionNature" and sub.text:
                        nature = sub.text.strip()
                    elif t == "exterior" and not oc_pts:
                        pl = sub.find(".//{http://www.opengis.net/gml/3.2}posList")
                        if pl is not None:
                            oc_pts = parse_pos_list(pl.text)
                if oc_pts:
                    cx, cz = polygon_centroid(oc_pts)
                    if in_world_box(cx, cz):
                        stats["catastro_otherconstruction_in_7600m"] += 1
                        xs = [p[0] for p in oc_pts]
                        zs = [p[1] for p in oc_pts]
                        other_constructions.append(
                            {
                                "cx": cx,
                                "cz": cz,
                                "min_x": min(xs),
                                "max_x": max(xs),
                                "min_z": min(zs),
                                "max_z": max(zs),
                                "pts": oc_pts,
                                "nature": nature or "ancillary",
                            }
                        )
                elem.clear()

    part_floor_hist: Counter = Counter()
    for b_id, b in buildings.items():
        raw_parts = parts_by_parent.get(b_id, [])
        all_floors = [p["floors"] for p in raw_parts if p["floors"] is not None]
        geo_parts = [p for p in raw_parts if p.get("pts") and p["floors"] > 0]
        # Sort constituent building parts by area descending, keep up to 6 distinct stepped parts
        geo_parts.sort(key=lambda item: item["area"], reverse=True)
        b["geo_parts"] = geo_parts[:6]
        b["part_count"] = max(1, len(all_floors))
        if all_floors:
            b["max_floors"] = max(all_floors)
            b["min_floors"] = min(all_floors)
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
    return buildings, other_constructions, stats


def load_catastro_portals() -> tuple[list[tuple[float, float]], int]:
    portals: list[tuple[float, float]] = []
    total_muni = 0
    with zipfile.ZipFile(AD_ZIP_PATH) as zf:
        with zf.open("A.ES.SDGC.AD.10900.gml") as fp:
            for _event, elem in ET.iterparse(fp, events=("end",)):
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


def infer_tree_species(tags: dict) -> str | None:
    leaf = (tags.get("leaf_type") or "").lower()
    genus = (tags.get("genus") or tags.get("taxon") or "").lower()
    species = (tags.get("species") or "").lower()
    combined = f"{leaf} {genus} {species}"
    if any(k in combined for k in ("phoenix", "washingtonia", "palm", "chamaerops", "trachycarpus")):
        return "palm"
    if any(k in combined for k in ("cupressus", "cipr", "thuja")):
        return "cypress"
    if any(k in combined for k in ("pinus", "pine", "needleleaved", "cedrus")):
        return "pine"
    if any(k in combined for k in ("quercus", "olea", "encina", "alcornoque")):
        return "oak"
    if "broadleaved" in combined or leaf:
        return "deciduous"
    return None


def cross_match_osm_and_catastro(
    cat_buildings: dict[str, dict],
    other_constructions: list[dict],
    portals: list[tuple[float, float]],
) -> tuple[dict[str, dict], dict]:
    osm = json.loads(OSM_PATH.read_text(encoding="utf-8"))
    elements = osm.get("elements", [])

    CELL = 40.0
    cat_grid: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for b_id, b in cat_buildings.items():
        b["id"] = b_id
        gx0 = int(math.floor((b["min_x"] - 10.0) / CELL))
        gx1 = int(math.floor((b["max_x"] + 10.0) / CELL))
        gz0 = int(math.floor((b["min_z"] - 10.0) / CELL))
        gz1 = int(math.floor((b["max_z"] + 10.0) / CELL))
        for gx in range(gx0, gx1 + 1):
            for gz in range(gz0, gz1 + 1):
                cat_grid[(gx, gz)].append(b)

    oc_grid: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for oc in other_constructions:
        gx = int(math.floor(oc["cx"] / CELL))
        gz = int(math.floor(oc["cz"] / CELL))
        oc_grid[(gx, gz)].append(oc)

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
                        osm_buildings.append(
                            {"id": f"w{el['id']}", "tags": tags, "pts": pts, "cx": cx, "cz": cz, "inners": []}
                        )
            elif tags.get("building:part"):
                osm_building_parts += 1
        elif etype == "relation" and tags.get("building"):
            osm_multipolygon_buildings += 1
            outer_pts: list[tuple[float, float]] = []
            inner_rings: list[list[tuple[float, float]]] = []
            for m in el.get("members", []):
                if m.get("type") == "way" and "geometry" in m:
                    pts = [project_etrs89_utm29(p["lon"], p["lat"]) for p in m["geometry"]]
                    if len(pts) > 3 and pts[0] == pts[-1]:
                        pts.pop()
                    if m.get("role") == "inner" and len(pts) >= 3:
                        inner_rings.append(pts)
                    elif not outer_pts and len(pts) >= 3:
                        outer_pts = pts
            if inner_rings:
                osm_courtyards += 1
            if len(outer_pts) >= 3:
                cx, cz = polygon_centroid(outer_pts)
                if in_world_box(cx, cz, 0.0):
                    osm_buildings.append(
                        {"id": f"r{el['id']}", "tags": tags, "pts": outer_pts, "cx": cx, "cz": cz, "inners": inner_rings}
                    )
        elif etype == "node":
            if tags.get("natural") == "tree":
                osm_props_stats["tree"] += 1
                sp = infer_tree_species(tags) or "unspecified"
                tree_species_stats[sp] += 1
            elif tags.get("natural") == "shrub" or tags.get("barrier") == "hedge":
                osm_props_stats["shrub"] += 1
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
    exported_inner_rings = 0
    exported_parts_total = 0

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

        xs = [p[0] for p in b["pts"]]
        zs = [p[1] for p in b["pts"]]
        bmin_x, bmax_x = min(xs), max(xs)
        bmin_z, bmax_z = min(zs), max(zs)
        cx, cz = b["cx"], b["cz"]

        # Multi-cell lookup ONLY across the OSM polygon bounding box; still require strict containment or <= 10m centroid match
        seen_ids: set[str] = set()
        candidates: list[dict] = []
        gx0 = int(math.floor((bmin_x - 8.0) / CELL))
        gx1 = int(math.floor((bmax_x + 8.0) / CELL))
        gz0 = int(math.floor((bmin_z - 8.0) / CELL))
        gz1 = int(math.floor((bmax_z + 8.0) / CELL))
        for gx in range(gx0, gx1 + 1):
            for gz in range(gz0, gz1 + 1):
                for cand in cat_grid.get((gx, gz), ()):
                    if cand["id"] not in seen_ids:
                        seen_ids.add(cand["id"])
                        candidates.append(cand)

        best_cat = None
        contained_cats: list[dict] = []
        best_dist = 10.0  # Strict radius: never force far false matches
        for cand in candidates:
            if point_in_poly(cx, cz, cand["pts"]):
                best_cat = cand
                break
            if point_in_poly(cand["cx"], cand["cz"], b["pts"]):
                contained_cats.append(cand)
                continue
            d = math.hypot(cx - cand["cx"], cz - cand["cz"])
            if d < best_dist:
                best_dist = d
                best_cat = cand

        if not best_cat and contained_cats:
            contained_cats.sort(key=lambda c: c["area_m2"] or 0.0, reverse=True)
            best_cat = contained_cats[0]

        # Check OtherConstruction (only when no regular Catastro building matched)
        other_nature = None
        if not best_cat:
            for gx in range(gx0, gx1 + 1):
                for gz in range(gz0, gz1 + 1):
                    for oc in oc_grid.get((gx, gz), ()):
                        if point_in_poly(cx, cz, oc["pts"]) or point_in_poly(oc["cx"], oc["cz"], b["pts"]):
                            other_nature = oc["nature"]
                            break
                    if other_nature:
                        break
                if other_nature:
                    break

        cat_max_fl = best_cat["max_floors"] if best_cat else None
        cat_min_fl = best_cat["min_floors"] if best_cat else None
        if contained_cats:
            all_fl = [c["max_floors"] for c in contained_cats if c["max_floors"]]
            if all_fl:
                cat_max_fl = max(cat_max_fl or 0, max(all_fl))
                cat_min_fl = min(all_fl)
        cat_parts = best_cat["part_count"] if best_cat else 0
        cat_use = best_cat["use"] if best_cat else None
        cat_era = best_cat["era"] if best_cat else None

        # Inner courtyard rings: prefer OSM explicit inner rings, fall back to matched Catastro interiors inside footprint
        final_inners: list[list[list[float]]] = []
        for ir in b["inners"]:
            s = simplify_ring(ir, 0.35)
            if s:
                final_inners.append(s)
        if not final_inners and best_cat and best_cat["interior_rings_pts"]:
            for ir in best_cat["interior_rings_pts"]:
                icx, icz = polygon_centroid(ir)
                if point_in_poly(icx, icz, b["pts"]):
                    s = simplify_ring(ir, 0.35)
                    if s:
                        final_inners.append(s)
        has_courtyard = len(final_inners) > 0 or bool(best_cat and best_cat["interior_rings_pts"])
        if final_inners:
            exported_inner_rings += 1

        # Stepped constituent parts from Catastro BuildingPart — strictly clipped/filtered
        # to parts whose centroid actually falls INSIDE this OSM building footprint so adjacent
        # rowhouses sharing a Catastro parcel never duplicate each other's geometry.
        exported_parts: list[dict] = []
        source_parts = []
        if best_cat and len(best_cat.get("geo_parts", [])) > 1:
            inside_parts = []
            for gp in best_cat["geo_parts"]:
                pcx, pcz = polygon_centroid(gp["pts"])
                if point_in_poly(pcx, pcz, b["pts"]):
                    inside_parts.append(gp)
            if len(inside_parts) > 1 and len({p["floors"] for p in inside_parts}) > 1:
                source_parts = inside_parts
                cat_max_fl = max(p["floors"] for p in inside_parts)
                cat_min_fl = min(p["floors"] for p in inside_parts)
            elif len(inside_parts) == 1 and inside_parts[0].get("floors"):
                cat_max_fl = inside_parts[0]["floors"]
                cat_min_fl = inside_parts[0]["floors"]
        elif len(contained_cats) > 1:
            for cc in contained_cats[:4]:
                if cc.get("max_floors") and cc["pts"]:
                    source_parts.append({"pts": cc["pts"], "floors": cc["max_floors"]})

        if source_parts and len({p["floors"] for p in source_parts}) > 1:
            for sp in source_parts[:4]:
                spts = simplify_ring(sp["pts"], 0.45)
                if spts:
                    exported_parts.append({"pts": spts, "floors": sp["floors"]})
        if exported_parts:
            exported_parts_total += 1

        # Portal coordinates nearby (<= 6 m from polygon bounding box)
        pmin_x, pmax_x = bmin_x - 6.0, bmax_x + 6.0
        pmin_z, pmax_z = bmin_z - 6.0, bmax_z + 6.0
        matched_portals: list[list[float]] = []
        for px_g in range(int(math.floor(pmin_x / P_CELL)), int(math.floor(pmax_x / P_CELL)) + 1):
            for pz_g in range(int(math.floor(pmin_z / P_CELL)), int(math.floor(pmax_z / P_CELL)) + 1):
                for px, pz in portal_grid.get((px_g, pz_g), ()):
                    if pmin_x <= px <= pmax_x and pmin_z <= pz <= pmax_z:
                        matched_portals.append([round(px, 2), round(pz, 2)])

        btype = (tags.get("building") or "yes").lower()
        if osm_height is not None or (osm_levels is not None and osm_levels > 0):
            origin = "osm_explicit"
        elif cat_max_fl is not None and cat_max_fl > 0:
            origin = "catastro_floors"
        elif btype in KNOWN_HEURISTIC_TYPES or other_nature:
            origin = "estimated"
        else:
            origin = "unknown"

        height_provenance[origin] += 1
        if best_cat:
            height_provenance["catastro_footprint_matched"] += 1
        if other_nature:
            height_provenance["otherconstruction_matched"] += 1
        if cat_use:
            use_counts[cat_use] += 1
        if cat_era:
            era_counts[cat_era] += 1
        if cat_parts > 1:
            stepped_buildings += 1
        if has_courtyard:
            courtyard_buildings += 1
        if matched_portals:
            portals_matched_buildings += 1

        rec: dict = {
            "heightOrigin": origin,
            "osmLevels": osm_levels,
            "osmHeightMeters": osm_height,
            "catastroMaxFloors": cat_max_fl,
            "catastroMinFloors": cat_min_fl,
            "catastroPartCount": cat_parts,
            "catastroUse": cat_use,
            "catastroEra": cat_era,
            "catastroOtherNature": other_nature,
            "hasCourtyard": has_courtyard,
            "nearbyPortalCount": len(matched_portals),
        }
        if final_inners:
            rec["innerRings"] = final_inners
        if len(exported_parts) > 1:
            rec["parts"] = exported_parts
        if matched_portals:
            rec["portalPoints"] = matched_portals[:4]
        enrichment[b["id"]] = rec

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
        "buildings_with_exported_inner_rings": exported_inner_rings,
        "buildings_with_exported_stepped_parts": exported_parts_total,
        "buildings_with_portals_matched": portals_matched_buildings,
    }
    return enrichment, summary


def main() -> None:
    STAGING_DIR.mkdir(parents=True, exist_ok=True)
    print("[geo] Loading Catastro INSPIRE BU (Buildings + BuildingParts + OtherConstruction)...")
    cat_buildings, other_constructions, cat_stats = load_catastro_buildings()
    print("[geo] Loading Catastro INSPIRE AD (Addresses/Portals)...")
    portals, total_ad_muni = load_catastro_portals()
    print(
        f"[geo] Loaded {len(cat_buildings)} Catastro buildings, "
        f"{len(other_constructions)} other constructions, and {len(portals)} portals inside 7.6 km."
    )
    enrichment, summary = cross_match_osm_and_catastro(cat_buildings, other_constructions, portals)

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
