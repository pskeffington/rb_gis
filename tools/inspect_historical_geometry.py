#!/usr/bin/env python3
"""Offline validation of downloaded CIS historical GeoJSON inputs.

No network calls. This validates structural and coordinate properties only;
historical accuracy, licensed reuse, coverage completeness and mask topology
require independent review. A PASS here never authorizes public rendering.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

MAX_FILE_BYTES = 40 * 1024 * 1024
MAX_POSITIONS = 2_000_000

def positions(geometry):
    t = geometry.get("type")
    coords = geometry.get("coordinates")
    if t == "Point":
        yield coords
    elif t in ("LineString", "MultiPoint"):
        yield from coords
    elif t in ("Polygon", "MultiLineString"):
        for ring in coords:
            yield from ring
    elif t == "MultiPolygon":
        for polygon in coords:
            for ring in polygon:
                yield from ring
    else:
        raise ValueError(f"unsupported geometry: {t}")

def validate_geometry(geometry):
    if not isinstance(geometry, dict):
        raise ValueError("missing geometry object")
    t = geometry.get("type")
    coords = geometry.get("coordinates")
    if t not in {"Point", "LineString", "MultiPoint", "Polygon", "MultiLineString", "MultiPolygon"}:
        raise ValueError(f"unsupported geometry type {t}")
    if coords is None:
        raise ValueError("missing coordinates")
    if t == "Polygon":
        polys = [coords]
    elif t == "MultiPolygon":
        polys = coords
    else:
        polys = []
    for poly in polys:
        if not poly:
            raise ValueError("polygon without rings")
        for ring in poly:
            if len(ring) < 4 or ring[0] != ring[-1]:
                raise ValueError("unclosed/short polygon ring")
    count = 0
    bounds = [180., 90., -180., -90.]
    for p in positions(geometry):
        if not isinstance(p, list) or len(p) not in (2, 3):
            raise ValueError("invalid position arity")
        if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in p):
            raise ValueError("nonfinite coordinate")
        lon, lat = p[:2]
        if not -180 <= lon <= 180 or not -90 <= lat <= 90:
            raise ValueError("out-of-range WGS84 position")
        bounds = [min(lon, bounds[0]), min(lat, bounds[1]), max(lon, bounds[2]), max(lat, bounds[3])]
        count += 1
        if count > MAX_POSITIONS:
            raise ValueError("position budget exceeded")
    if not count:
        raise ValueError("empty geometry")
    return count, bounds

def inspect(path):
    if not path.is_file() or not 0 < path.stat().st_size <= MAX_FILE_BYTES:
        raise ValueError("file empty or over size budget")
    data = path.read_bytes()
    document = json.loads(data)
    if "crs" in document:
        raise ValueError("legacy CRS member; must explicitly reproject first")
    if document.get("type") != "FeatureCollection":
        raise ValueError("FeatureCollection required")
    feats = document.get("features")
    if not isinstance(feats, list) or not feats:
        raise ValueError("missing features")
    totals = {"features": 0, "positions": 0, "bbox": [180., 90., -180., -90.], "geometry_types": {}}
    for i, feature in enumerate(feats):
        if feature.get("type") != "Feature":
            raise ValueError(f"invalid feature #{i}")
        geom = feature.get("geometry")
        n, b = validate_geometry(geom)
        totals["features"] += 1
        totals["positions"] += n
        if totals["positions"] > MAX_POSITIONS:
            raise ValueError("collection position budget exceeded")
        t = geom["type"]
        totals["geometry_types"][t] = totals["geometry_types"].get(t, 0) + 1
        a = totals["bbox"]
        totals["bbox"] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
    return {"file": str(path), "sha256": hashlib.sha256(data).hexdigest(), **totals,
            "geometry_integrity": "STRUCTURAL_PASS",
            "source_completeness": "NOT_VERIFIED",
            "historical_cartographic_alignment": "NOT_VERIFIED",
            "gaza_west_bank_mask": "NOT_VERIFIED",
            "public_render_approved": False}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("geojson", type=Path, help="offline downloaded and WGS84 normalized FeatureCollection")
    parser.add_argument("--report", type=Path, help="JSON report path")
    args = parser.parse_args()
    try:
        result = inspect(args.geojson)
        outcome = 0
    except (OSError, UnicodeError, ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
        result = {"file": str(args.geojson), "geometry_integrity": "FAIL", "error": str(e), "public_render_approved": False}
        outcome = 1
    output = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.report:
        args.report.write_text(output)
    print(output, end="")
    raise SystemExit(outcome)
