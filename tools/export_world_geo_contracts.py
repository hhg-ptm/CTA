"""Export verified public geographic contracts for portals and bus stops.

Reads locally cached open datasets (Spanish Catastro INSPIRE Addresses GML,
OpenStreetMap extract, verified MDT05 chunk terrain and road-network graph)
via `shared_data_paths` in strict read-only mode, strips all private cadastral
identifiers (`rc1`/`rc2`/`localId`), filters commercial blocklist terms, and
writes decoupled public JSON catalogs under `public/data/world/`:
  - `public/data/world/portals.json`
  - `public/data/world/bus-stops.json`

NEVER writes to `public/world/cc-monumental/` or sibling worktrees.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import struct
import sys
import xml.etree.ElementTree as ET
import zipfile
import zlib
from collections import defaultdict
from pathlib import Path
from typing import Any

TOOLS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS_DIR))
import caceres_geo_processing as geo  # noqa: E402
from shared_data_paths import WORKTREE_ROOT, resolve_shared_readonly_path  # noqa: E402

NS_GML = "http://www.opengis.net/gml/3.2"
NS_AD = "urn:x-inspire:specification:gmlas:Addresses:3.0"
NS_GN = "urn:x-inspire:specification:gmlas:GeographicalNames:3.0"
NS_XLINK = "http://www.w3.org/1999/xlink"

PUBLIC_WORLD_DATA_DIR = WORKTREE_ROOT / "public/data/world"
CHUNK_METERS = 256.0
HALF_WORLD = 3840.0

STREET_PREFIX_MAP: dict[str, str] = {
    "CL": "Calle",
    "PZ": "Plaza",
    "AV": "Avenida",
    "PS": "Paseo",
    "RD": "Ronda",
    "TR": "Travesía",
    "CT": "Cuesta",
    "CR": "Carretera",
    "CM": "Camino",
    "CJ": "Callejón",
    "PJ": "Pasaje",
    "UR": "Urbanización",
    "LG": "Lugar",
    "PL": "Polígono",
    "BO": "Barrio",
    "FN": "Finca",
    "SC": "Sector",
    "DS": "Diseminado",
    "VI": "Vía",
    "CU": "Complejo",
}

LOWER_PARTICLES = {"de", "del", "la", "las", "los", "el", "y", "e", "en", "a", "al", "san", "santa"}
ROMAN_TOKENS = {"i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii"}
RE_CATASTRO_NOTE = re.compile(r"\s*\(RC\.?\s*[^)]*\)\s*", re.IGNORECASE)


def format_spanish_street(raw_name: str) -> tuple[str, str]:
    """Return `(readable_street, cleaned_official_street)` without cadastral codes."""
    cleaned_official = RE_CATASTRO_NOTE.sub(" ", raw_name).strip()
    cleaned_official = re.sub(r"\s+", " ", cleaned_official)
    if not cleaned_official:
        return "Vía sin nombre", ""

    parts = cleaned_official.split(" ", 1)
    prefix = parts[0].upper()
    rest = parts[1] if len(parts) > 1 else ""
    expanded_prefix = STREET_PREFIX_MAP.get(prefix)
    tokens = rest.split() if expanded_prefix else cleaned_official.split()

    formatted_tokens: list[str] = []
    if expanded_prefix:
        formatted_tokens.append(expanded_prefix)

    for idx, tok in enumerate(tokens):
        low = tok.lower()
        # Keep Roman numerals uppercase cleanly
        if re.fullmatch(r"[ivx]+", low) and low in ROMAN_TOKENS and idx > 0:
            formatted_tokens.append(tok.upper())
        elif idx > 0 and low in LOWER_PARTICLES:
            # Keep first title word after expanded prefix capitalized only if lowercase particle starts name?
            # In Spanish street names ("Avenida de España", "Calle San Antón"), articles stay lowercase
            # while "San/Santa" inside the proper noun look clearer capitalized.
            if low in {"san", "santa"}:
                formatted_tokens.append(low.capitalize())
            else:
                formatted_tokens.append(low)
        elif tok.isupper() and any(ch.isdigit() for ch in tok):
            formatted_tokens.append(tok)
        else:
            sub = "-".join(s.capitalize() for s in low.split("-"))
            formatted_tokens.append(sub)

    return " ".join(formatted_tokens), cleaned_official


def map_catastro_use(catastro_use: str, btype: str, commercial: bool) -> str:
    if commercial or catastro_use in ("4_2_retail", "4_1_office"):
        return "commercial"
    if catastro_use == "3_industrial" or btype in ("industrial", "warehouse", "garages", "manufacture"):
        return "industrial"
    if catastro_use in ("4_3_publicServices",) or btype in (
        "public",
        "civic",
        "school",
        "university",
        "hospital",
        "museum",
        "church",
        "cathedral",
        "townhall",
    ):
        return "civic"
    if catastro_use == "2_agriculture" or btype in ("farm", "farm_auxiliary"):
        return "mixed"
    return "residential"


def chunk_id_for(x: float, z: float) -> str:
    cx = max(-15, min(14, int(math.floor(x / CHUNK_METERS))))
    cz = max(-15, min(14, int(math.floor(z / CHUNK_METERS))))
    return f"{cx}_{cz}"


class TerrainElevationLookup:
    """Bilinear terrain height sampler over compressed CTA2 chunks."""

    def __init__(self, world_dir: Path) -> None:
        self.world_dir = world_dir
        manifest = json.loads((world_dir / "manifest.json").read_text(encoding="utf-8"))
        self.chunk_map = {c["id"]: c for c in manifest["chunks"]}
        self._cache: dict[str, dict[str, Any]] = {}

    def _load_chunk(self, cid: str) -> dict[str, Any] | None:
        if cid in self._cache:
            return self._cache[cid]
        entry = self.chunk_map.get(cid)
        if not entry:
            return None
        raw = (self.world_dir / entry["path"]).read_bytes()
        payload = json.loads(zlib.decompress(raw[12:]).decode("utf-8"))
        self._cache[cid] = payload
        return payload

    def sample(self, x: float, z: float) -> float:
        cid = chunk_id_for(x, z)
        chunk = self._load_chunk(cid)
        if not chunk:
            return 0.0
        terr = chunk["terrain"]
        bounds = chunk["bounds"]
        samples = int(terr["samples"])
        step = float(terr["stepMeters"])
        quant = float(terr.get("quantizationMeters", 1.0))
        heights = terr["heights"]
        lx = max(0.0, min((samples - 1) * step, x - float(bounds["minX"])))
        lz = max(0.0, min((samples - 1) * step, z - float(bounds["minZ"])))
        gx = min(samples - 2, int(math.floor(lx / step)))
        gz = min(samples - 2, int(math.floor(lz / step)))
        tx = (lx - gx * step) / step
        tz = (lz - gz * step) / step
        h00 = heights[gz * samples + gx] * quant
        h10 = heights[gz * samples + (gx + 1)] * quant
        h01 = heights[(gz + 1) * samples + gx] * quant
        h11 = heights[(gz + 1) * samples + (gx + 1)] * quant
        h0 = h00 * (1.0 - tx) + h10 * tx
        h1 = h01 * (1.0 - tx) + h11 * tx
        return round(h0 * (1.0 - tz) + h1 * tz, 2)


def _point_in_ring(x: float, z: float, pts: list[list[float]]) -> bool:
    inside = False
    n = len(pts)
    for i in range(n):
        x1, z1 = pts[i][0], pts[i][1]
        x2, z2 = pts[(i + 1) % n][0], pts[(i + 1) % n][1]
        if (z1 > z) != (z2 > z):
            x_int = (x2 - x1) * (z - z1) / ((z2 - z1) or 1e-9) + x1
            if x < x_int:
                inside = not inside
    return inside


def _dist_to_poly_bbox_filter(x: float, z: float, pts: list[list[float]]) -> float:
    if _point_in_ring(x, z, pts):
        return 0.0
    best_sq = float("inf")
    n = len(pts)
    for i in range(n):
        ax, az = pts[i][0], pts[i][1]
        bx, bz = pts[(i + 1) % n][0], pts[(i + 1) % n][1]
        dx, dz = bx - ax, bz - az
        l2 = dx * dx + dz * dz
        t = 0.0 if l2 < 1e-9 else max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / l2))
        px, pz = ax + dx * t, az + dz * t
        d2 = (x - px) ** 2 + (z - pz) ** 2
        if d2 < best_sq:
            best_sq = d2
    return math.sqrt(best_sq)


class RoadSnapIndex:
    """Fast 64m spatial index over road-network nodes & segments."""

    def __init__(self, network: dict[str, Any], cell_meters: float = 64.0) -> None:
        self.cell = cell_meters
        self.nodes: dict[str, tuple[float, float]] = {
            n["id"]: (float(n["position"][0]), float(n["position"][1])) for n in network["nodes"]
        }
        self.segments = network["segments"]
        self.vehicle_buckets: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
        self.all_buckets: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)

        for seg in self.segments:
            p0 = self.nodes.get(seg["fromNode"])
            p1 = self.nodes.get(seg["toNode"])
            if not p0 or not p1:
                continue
            item = {
                "id": seg["id"],
                "fromNode": seg["fromNode"],
                "toNode": seg["toNode"],
                "ax": p0[0],
                "az": p0[1],
                "bx": p1[0],
                "bz": p1[1],
                "walkable": bool(seg.get("walkable")),
                "oneWay": int(seg.get("oneWay", 0)),
                "highway": seg.get("highway", "unclassified"),
            }
            cx0 = int(math.floor(min(p0[0], p1[0]) / self.cell))
            cx1 = int(math.floor(max(p0[0], p1[0]) / self.cell))
            cz0 = int(math.floor(min(p0[1], p1[1]) / self.cell))
            cz1 = int(math.floor(max(p0[1], p1[1]) / self.cell))
            for gz in range(cz0, cz1 + 1):
                for gx in range(cx0, cx1 + 1):
                    self.all_buckets[(gx, gz)].append(item)
                    if not item["walkable"] and item["highway"] != "cycleway":
                        self.vehicle_buckets[(gx, gz)].append(item)

    def snap(
        self, x: float, z: float, *, vehicular_only: bool, max_dist: float = 85.0
    ) -> dict[str, Any] | None:
        buckets = self.vehicle_buckets if vehicular_only else self.all_buckets
        gx0 = int(math.floor(x / self.cell))
        gz0 = int(math.floor(z / self.cell))
        best: dict[str, Any] | None = None
        best_d2 = max_dist * max_dist
        seen_ids: set[str] = set()

        for ring in range(0, 3):
            for dz in range(-ring, ring + 1):
                for dx in range(-ring, ring + 1):
                    if max(abs(dx), abs(dz)) != ring:
                        continue
                    for seg in buckets.get((gx0 + dx, gz0 + dz), ()):
                        if seg["id"] in seen_ids:
                            continue
                        seen_ids.add(seg["id"])
                        vx = seg["bx"] - seg["ax"]
                        vz = seg["bz"] - seg["az"]
                        l2 = vx * vx + vz * vz
                        t = 0.0 if l2 < 1e-9 else max(0.0, min(1.0, ((x - seg["ax"]) * vx + (z - seg["az"]) * vz) / l2))
                        px = seg["ax"] + vx * t
                        pz = seg["az"] + vz * t
                        d2 = (x - px) ** 2 + (z - pz) ** 2
                        if d2 < best_d2:
                            best_d2 = d2
                            nearest_node = seg["fromNode"] if t < 0.5 else seg["toNode"]
                            # Segment heading uses repo convention atan2(dirX, dirZ) respecting oneWay == -1
                            tx, tz = (-vx, -vz) if seg["oneWay"] == -1 else (vx, vz)
                            seg_heading = math.atan2(tx, tz) if (abs(tx) + abs(tz)) > 1e-6 else 0.0
                            best = {
                                "roadNodeId": nearest_node,
                                "roadSegmentId": seg["id"],
                                "roadPoint": [round(px, 2), round(pz, 2)],
                                "roadDistanceMeters": round(math.sqrt(d2), 2),
                                "segmentHeading": round(seg_heading, 4),
                            }
        return best


def load_blocklist_patterns() -> list[re.Pattern[str]]:
    block_path = WORKTREE_ROOT / "tools/brand-blocklist.json"
    data = json.loads(block_path.read_text(encoding="utf-8"))
    patterns: list[re.Pattern[str]] = []
    for brand in data.get("brands", []):
        for alias in brand.get("aliases", []):
            esc = re.escape(alias.strip())
            if esc:
                patterns.append(
                    re.compile(rf"(^|[^a-záéíóúñü]){esc}([^a-záéíóúñü]|$)", re.IGNORECASE)
                )
    return patterns


def sanitize_public_label(text: str, forbidden: list[re.Pattern[str]], fallback: str) -> str:
    for pat in forbidden:
        if pat.search(text):
            return fallback
    return text


def build_building_spatial_index(
    world_dir: Path, enrichment: dict[str, Any]
) -> tuple[dict[tuple[int, int], list[dict[str, Any]]], dict[tuple[int, int], list[str]]]:
    manifest = json.loads((world_dir / "manifest.json").read_text(encoding="utf-8"))
    b_buckets: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    road_name_buckets: dict[tuple[int, int], list[str]] = defaultdict(list)
    seen_bids: set[str] = set()
    cell = 64.0

    for entry in manifest["chunks"]:
        raw = (world_dir / entry["path"]).read_bytes()
        payload = json.loads(zlib.decompress(raw[12:]).decode("utf-8"))
        for feat in payload.get("features", []):
            ftype = feat.get("featureType")
            if ftype in ("road", "pedestrian") and feat.get("name"):
                pts = feat.get("points") or []
                for p in pts:
                    key = (int(math.floor(p[0] / cell)), int(math.floor(p[1] / cell)))
                    if feat["name"] not in road_name_buckets[key]:
                        road_name_buckets[key].append(feat["name"])
                continue
            if ftype != "building":
                continue
            bid = feat.get("id")
            pts = feat.get("points")
            if not bid or bid in seen_bids or not pts or len(pts) < 3:
                continue
            seen_bids.add(bid)
            xs = [p[0] for p in pts]
            zs = [p[1] for p in pts]
            enr = enrichment.get(bid, {})
            rec = {
                "id": bid,
                "pts": pts,
                "minX": min(xs),
                "maxX": max(xs),
                "minZ": min(zs),
                "maxZ": max(zs),
                "zone": feat.get("zone") or "periferia",
                "district": feat.get("district") or (feat.get("zone") or "periferia"),
                "use": map_catastro_use(
                    str(feat.get("catastroUse") or enr.get("catastroUse") or ""),
                    str(feat.get("buildingType") or "").lower(),
                    bool(feat.get("commercial")),
                ),
            }
            gx0 = int(math.floor(rec["minX"] / cell))
            gx1 = int(math.floor(rec["maxX"] / cell))
            gz0 = int(math.floor(rec["minZ"] / cell))
            gz1 = int(math.floor(rec["maxZ"] / cell))
            for gz in range(gz0, gz1 + 1):
                for gx in range(gx0, gx1 + 1):
                    b_buckets[(gx, gz)].append(rec)
    return b_buckets, road_name_buckets


def match_nearest_building(
    x: float, z: float, buckets: dict[tuple[int, int], list[dict[str, Any]]]
) -> dict[str, Any] | None:
    cell = 64.0
    gx = int(math.floor(x / cell))
    gz = int(math.floor(z / cell))
    best: dict[str, Any] | None = None
    best_dist = 14.0
    seen: set[str] = set()
    for dz in (-1, 0, 1):
        for dx in (-1, 0, 1):
            for rec in buckets.get((gx + dx, gz + dz), ()):
                if rec["id"] in seen:
                    continue
                seen.add(rec["id"])
                if (
                    x < rec["minX"] - best_dist
                    or x > rec["maxX"] + best_dist
                    or z < rec["minZ"] - best_dist
                    or z > rec["maxZ"] + best_dist
                ):
                    continue
                d = _dist_to_poly_bbox_filter(x, z, rec["pts"])
                if d < best_dist:
                    best_dist = d
                    best = rec
                    if d == 0.0:
                        return rec
    return best


def fallback_zone_for_coords(x: float, z: float) -> str:
    dist = math.hypot(x, z)
    if dist <= 320.0:
        return "casco"
    if dist <= 950.0:
        return "ensanche"
    return "periferia"


def district_for_zone(zone: str, district: str | None) -> str:
    if district and district != "ensanche":
        return district
    if zone == "casco":
        return "casco"
    if zone == "ensanche":
        return "canovas_centro"
    return "periferia"


def export_portals(
    ad_zip_path: Path,
    terrain: TerrainElevationLookup,
    roads: RoadSnapIndex,
    building_buckets: dict[tuple[int, int], list[dict[str, Any]]],
    forbidden: list[re.Pattern[str]],
) -> dict[str, Any]:
    thoroughfares: dict[str, str] = {}
    postcodes: dict[str, str] = {}
    raw_addresses: list[tuple[float, float, str, str, str, str]] = []

    with zipfile.ZipFile(ad_zip_path) as zf:
        with zf.open("A.ES.SDGC.AD.10900.gml") as fp:
            for _ev, elem in ET.iterparse(fp, events=("end",)):
                if elem.tag.endswith("ThoroughfareName"):
                    gid = elem.attrib.get(f"{{{NS_GML}}}id", "")
                    txt = (elem.findtext(f".//{{{NS_GN}}}text") or "").strip()
                    thoroughfares[gid] = txt
                    elem.clear()
                elif elem.tag.endswith("PostalDescriptor"):
                    gid = elem.attrib.get(f"{{{NS_GML}}}id", "")
                    pc = (elem.findtext(f".//{{{NS_AD}}}postCode") or "").strip()
                    postcodes[gid] = pc
                    elem.clear()
                elif elem.tag.endswith("Address"):
                    pos_txt = (elem.findtext(f".//{{{NS_GML}}}pos") or "").split()
                    if len(pos_txt) == 2:
                        x = float(pos_txt[0]) - geo.ORIGIN_EASTING
                        z = float(pos_txt[1]) - geo.ORIGIN_NORTHING
                        if -3800.0 <= x <= 3800.0 and -3800.0 <= z <= 3800.0:
                            spec = (elem.findtext(f".//{{{NS_AD}}}specification") or "").strip()
                            num = (
                                elem.findtext(
                                    f".//{{{NS_AD}}}LocatorDesignator/{{{NS_AD}}}designator"
                                )
                                or ""
                            ).strip()
                            tn_ref = ""
                            pd_ref = ""
                            for comp in elem.findall(f".//{{{NS_AD}}}component"):
                                href = comp.attrib.get(f"{{{NS_XLINK}}}href", "").lstrip("#")
                                if ".TN." in href:
                                    tn_ref = href
                                elif ".PD." in href:
                                    pd_ref = href
                            raw_addresses.append((x, z, tn_ref, num, pd_ref, spec))
                    elem.clear()

    # Deduplicate Entrance vs Parcel pairs sharing street + number within 45 m
    # keeping exact Entrance coordinates whenever available.
    by_street_num: dict[tuple[str, str], list[tuple[float, float, str, str, str]]] = defaultdict(list)
    for x, z, tn_ref, num, pd_ref, spec in raw_addresses:
        raw_st = thoroughfares.get(tn_ref, "")
        kind = "entrance" if spec == "Entrance" else "parcel"
        by_street_num[(raw_st, num)].append((x, z, pd_ref, kind, raw_st))

    selected: list[tuple[float, float, str, str, str, str]] = []
    dropped_parcel_duplicates = 0
    for (_raw_st, num), items in by_street_num.items():
        entrances = [it for it in items if it[3] == "entrance"]
        parcels = [it for it in items if it[3] == "parcel"]
        for ent in entrances:
            selected.append((ent[0], ent[1], ent[4], num, postcodes.get(ent[2], ""), "entrance"))
        for par in parcels:
            if any(math.hypot(par[0] - ent[0], par[1] - ent[1]) <= 45.0 for ent in entrances):
                dropped_parcel_duplicates += 1
                continue
            selected.append((par[0], par[1], par[4], num, postcodes.get(par[2], ""), "parcel"))

    # Stable deterministic sort & collision-free anonymous IDs (zero cadastral reference!)
    selected.sort(key=lambda item: (item[2], item[3], round(item[0], 2), round(item[1], 2)))
    used_ids: set[str] = set()
    records: list[dict[str, Any]] = []

    for x, z, raw_street, num, postal, kind in selected:
        readable_street, _ = format_spanish_street(raw_street)
        readable_street = sanitize_public_label(readable_street, forbidden, "Vía Pública")
        xr, zr = round(x, 2), round(z, 2)
        yr = terrain.sample(xr, zr)
        bmatch = match_nearest_building(xr, zr, building_buckets)
        road_snap = roads.snap(xr, zr, vehicular_only=False, max_dist=85.0)

        # Heading points from portal toward nearest road segment (Three.js +Z forward = atan2(dx, dz))
        heading = 0.0
        if road_snap:
            dx = road_snap["roadPoint"][0] - xr
            dz = road_snap["roadPoint"][1] - zr
            if abs(dx) + abs(dz) > 1e-3:
                heading = round(math.atan2(dx, dz), 4)

        zone = bmatch["zone"] if bmatch else fallback_zone_for_coords(xr, zr)
        district = district_for_zone(zone, bmatch["district"] if bmatch else None)
        use = bmatch["use"] if bmatch else "residential"
        bid = bmatch["id"] if bmatch else None

        digest = hashlib.sha256(f"{xr:.2f}|{zr:.2f}|{readable_street}|{num}|{kind}".encode("utf-8")).hexdigest()[:10]
        pid = f"p_{digest}"
        suffix = 1
        while pid in used_ids:
            pid = f"p_{digest}_{suffix}"
            suffix += 1
        used_ids.add(pid)

        records.append(
            {
                "id": pid,
                "street": readable_street,
                "number": num,
                "postalCode": postal,
                "kind": kind,
                "x": xr,
                "y": yr,
                "z": zr,
                "heading": heading,
                "chunkId": chunk_id_for(xr, zr),
                "zone": zone,
                "district": district,
                "use": use,
                "buildingId": bid,
                "roadNodeId": road_snap["roadNodeId"] if road_snap else None,
                "roadPoint": road_snap["roadPoint"] if road_snap else None,
            }
        )

    return {
        "schemaVersion": 1,
        "crs": "EPSG:25829",
        "source": "Catastro INSPIRE AD 10900 (anonymized, no rc1/rc2) + OSM + IGN MDT05",
        "rawInBoundsCount": len(raw_addresses),
        "dedupedParcelCount": dropped_parcel_duplicates,
        "count": len(records),
        "portals": records,
    }


def export_bus_stops(
    osm_path: Path,
    terrain: TerrainElevationLookup,
    roads: RoadSnapIndex,
    road_name_buckets: dict[tuple[int, int], list[str]],
    forbidden: list[re.Pattern[str]],
) -> dict[str, Any]:
    osm = json.loads(osm_path.read_text(encoding="utf-8"))
    stops: list[dict[str, Any]] = []
    used_ids: set[str] = set()

    for el in osm.get("elements", []):
        tags = el.get("tags") or {}
        is_bus = tags.get("highway") == "bus_stop" or tags.get("public_transport") == "platform"
        if not is_bus:
            continue
        if tags.get("railway") and tags.get("bus") != "yes" and tags.get("highway") != "bus_stop":
            continue

        lon = el.get("lon")
        lat = el.get("lat")
        if lon is None and el.get("geometry"):
            lon = sum(p["lon"] for p in el["geometry"]) / len(el["geometry"])
            lat = sum(p["lat"] for p in el["geometry"]) / len(el["geometry"])
        if lon is None or lat is None:
            continue

        x, z = geo.project_etrs89_utm29(float(lon), float(lat))
        if abs(x) > HALF_WORLD or abs(z) > HALF_WORLD:
            continue

        prefix = "n" if el.get("type") == "node" else "w"
        sid = f"{prefix}{el['id']}"
        if sid in used_ids:
            continue
        used_ids.add(sid)

        xr, zr = round(x, 2), round(z, 2)
        yr = terrain.sample(xr, zr)
        raw_name = str(tags.get("name") or "").strip()
        if raw_name:
            name = sanitize_public_label(raw_name, forbidden, f"Parada {tags.get('ref') or sid}")
            name_source = "osm"
        else:
            gx, gz = int(math.floor(xr / 64.0)), int(math.floor(zr / 64.0))
            nearby_streets = road_name_buckets.get((gx, gz), [])
            inferred_street = nearby_streets[0] if nearby_streets else f"Sector {chunk_id_for(xr, zr)}"
            name = sanitize_public_label(f"Parada {inferred_street}", forbidden, f"Parada {sid}")
            name_source = "road_inferred"

        route_ref_raw = str(tags.get("route_ref") or "").strip()
        line_refs = [tok.strip() for tok in re.split(r"[;,/]+", route_ref_raw) if tok.strip()] if route_ref_raw else []
        veh_snap = roads.snap(xr, zr, vehicular_only=True, max_dist=90.0)
        zone = fallback_zone_for_coords(xr, zr)

        stops.append(
            {
                "id": sid,
                "name": name,
                "nameSource": name_source,
                "ref": str(tags["ref"]).strip() if tags.get("ref") else None,
                "lineRefs": line_refs,
                "hasShelter": tags.get("shelter") == "yes",
                "hasBench": tags.get("bench") == "yes",
                "hasBin": tags.get("bin") == "yes",
                "tactilePaving": tags.get("tactile_paving") == "yes",
                "x": xr,
                "y": yr,
                "z": zr,
                "chunkId": chunk_id_for(xr, zr),
                "zone": zone,
                "roadNodeId": veh_snap["roadNodeId"] if veh_snap else None,
                "roadSegmentId": veh_snap["roadSegmentId"] if veh_snap else None,
                "roadPoint": veh_snap["roadPoint"] if veh_snap else None,
                "roadDistanceMeters": veh_snap["roadDistanceMeters"] if veh_snap else None,
                "heading": veh_snap["segmentHeading"] if veh_snap else 0.0,
            }
        )

    stops.sort(key=lambda s: (s["ref"] or "zzz", s["name"], s["id"]))
    return {
        "schemaVersion": 1,
        "crs": "EPSG:25829",
        "source": "OpenStreetMap bus_stop/platform + cc-monumental road-network + IGN MDT05",
        "count": len(stops),
        "stops": stops,
    }


def main() -> None:
    ad_zip = resolve_shared_readonly_path("data/raw/catastro-atom/A.ES.SDGC.AD.10900.zip")
    osm_json = resolve_shared_readonly_path("data/raw/osm/cc-monumental-expanded.json")
    enrichment_path = resolve_shared_readonly_path("data/staging/cc-monumental/building_enrichment.json")

    try:
        world_dir = resolve_shared_readonly_path("public/world/cc-blender-staging")
    except FileNotFoundError:
        world_dir = WORKTREE_ROOT / "public/world/cc-monumental"

    road_network_path = WORKTREE_ROOT / "public/world/cc-monumental/road-network.json"
    road_network = json.loads(road_network_path.read_text(encoding="utf-8"))
    enrichment = json.loads(enrichment_path.read_text(encoding="utf-8"))
    forbidden = load_blocklist_patterns()

    terrain = TerrainElevationLookup(world_dir)
    roads = RoadSnapIndex(road_network)
    b_buckets, road_name_buckets = build_building_spatial_index(world_dir, enrichment)

    portals_payload = export_portals(ad_zip, terrain, roads, b_buckets, forbidden)
    bus_stops_payload = export_bus_stops(osm_json, terrain, roads, road_name_buckets, forbidden)

    PUBLIC_WORLD_DATA_DIR.mkdir(parents=True, exist_ok=True)
    portals_out = PUBLIC_WORLD_DATA_DIR / "portals.json"
    stops_out = PUBLIC_WORLD_DATA_DIR / "bus-stops.json"

    portals_out.write_text(
        json.dumps(portals_payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    stops_out.write_text(
        json.dumps(bus_stops_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "sharedWorldSource": str(world_dir),
                "portalsWritten": str(portals_out),
                "portalsCount": portals_payload["count"],
                "rawInBoundsCount": portals_payload["rawInBoundsCount"],
                "dedupedParcelCount": portals_payload["dedupedParcelCount"],
                "portalsBytes": portals_out.stat().st_size,
                "busStopsWritten": str(stops_out),
                "busStopsCount": bus_stops_payload["count"],
                "busStopsWithRoadNode": sum(
                    1 for s in bus_stops_payload["stops"] if s["roadNodeId"] is not None
                ),
                "busStopsBytes": stops_out.stat().st_size,
            },
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
