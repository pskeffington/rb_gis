#!/usr/bin/env python3
"""Audit a Rust-Boy MAP county cache using the real native Rust loopback API.

This is strictly an OFFLINE, read-only replay. All POST bodies use
cache_only=true and confirm=false. No arbitrary URL, GPS fix, Census lookup,
network permission or site-register read is accepted.

Exit codes: 0 = complete, 2 = empty cache, 3 = partial, 1 = invalid/error.
The user-facing output contains county GEOID and public source counts, but
never coordinates or private Reclamation sites.
"""
from __future__ import annotations

import argparse
import contextlib
import http.client
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit
import zlib
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / "target" / "debug" / ("pipboy.exe" if os.name == "nt" else "pipboy")
SOURCES = (
    ("tiger-roads", "roads"),
    ("tiger-areawater", "areawater"),
    ("tiger-linearwater", "linearwater"),
    ("tiger-pointlm", "pointlm"),
)
MAX_ZIP = 12 * 1024 * 1024
MAX_UNPACKED = 64 * 1024 * 1024
MAX_BOUNDARY = 1024 * 1024
MAX_RINGS = 256
MAX_VERTICES = 12000


class AuditError(Exception):
    """Corrupt/unexpected local response; no network fallback is allowed."""


def validate_geoid(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{5}", value):
        raise AuditError("Active cache GEOID is missing or invalid")
    if value[:2] == "00" or value[2:] == "000":
        raise AuditError("Active cache GEOID is not a valid county code")
    return value


def ensure_home(home: Path) -> Path:
    # An audit must not create, replace or silently redirect the test home.
    if not home.is_absolute() or home.is_symlink() or not home.is_dir():
        raise AuditError("Existing, non-symlinked absolute test-home directory required")
    return home


@contextlib.contextmanager
def local_server(home: Path):
    """Only the fixed compiled binary; bind an ephemeral 127.0.0.1 port."""
    if not BINARY.is_file():
        raise AuditError("Native pipboy binary missing; first run --verify")
    env = dict(os.environ, PIPBOY_HOME=str(home))
    process = subprocess.Popen(
        [str(BINARY), "dashboard", "--micro", "--port", "0"],
        cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, encoding="utf-8",
    )
    try:
        first = process.stdout.readline().strip()
        second = process.stdout.readline().strip()
        if first != "RUST-BOY DASHBOARD / LOCAL ONLY" or not second.startswith("Open "):
            raise AuditError("Native loopback server failed to start")
        parsed = urlsplit(second.removeprefix("Open "))
        if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1"
                or parsed.path != "/micro" or not parsed.port):
            raise AuditError("Unexpected native server listening address")
        yield parsed.port
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        if process.stdout is not None:
            process.stdout.close()


def request(port: int, method: str, path: str, body=None, max_bytes=MAX_ZIP + 1):
    if path not in ("/api/map/cache", "/api/map/sources",
                    "/api/map/boundary", "/api/map/package"):
        raise AuditError("Unapproved local API path")
    headers = {"Host": f"127.0.0.1:{port}", "Connection": "close"}
    raw = None
    if method == "POST":
        if body is None or body.get("cache_only") is not True or body.get("confirm") is not False:
            raise AuditError("Audit only permits cache-only, non-confirmed POST")
        headers["Origin"] = f"http://127.0.0.1:{port}"
        headers["Content-Type"] = "application/json"
        raw = json.dumps(body, separators=(",", ":")).encode("ascii")
    elif method != "GET" or body is not None:
        raise AuditError("Audit only permits the fixed GET/POST contract")
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=25)
    try:
        connection.request(method, path, body=raw, headers=headers)
        response = connection.getresponse()
        data = response.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise AuditError("Local response exceeds bounded audit budget")
        return response.status, response.getheader("Content-Type", ""), data
    finally:
        connection.close()


def json_response(port, method, path, body=None, max_bytes=MAX_BOUNDARY + 4096):
    status, content_type, data = request(port, method, path, body, max_bytes=max_bytes)
    if status != 200:
        return status, None
    if not content_type.startswith("application/json"):
        raise AuditError("Local JSON endpoint returned unexpected media type")
    try:
        return status, json.loads(data)
    except (UnicodeDecodeError, ValueError) as error:
        raise AuditError("Local JSON response malformed") from error


def validate_boundary(value: object, geoid: str) -> int:
    if not isinstance(value, dict) or value.get("schema") != 1:
        raise AuditError("Unexpected boundary schema")
    if (value.get("geoid") != geoid or value.get("vintage") != "2025-01-01"
            or value.get("cache_hit") is not True
            or value.get("network_used") is not False):
        raise AuditError("Offline boundary GEOID, vintage or network flag mismatch")
    if not isinstance(value.get("name"), str) or not value["name"].strip():
        raise AuditError("Cached boundary is missing a county name")
    rings = value.get("paths")
    if not isinstance(rings, list) or not 1 <= len(rings) <= MAX_RINGS:
        raise AuditError("Invalid county boundary ring count")
    vertices = 0
    for ring in rings:
        if not isinstance(ring, list) or len(ring) < 4:
            raise AuditError("Invalid county boundary ring")
        vertices += len(ring)
        if vertices > MAX_VERTICES or ring[0] != ring[-1]:
            raise AuditError("Invalid or oversized county boundary ring")
        for item in ring:
            if (not isinstance(item, list) or len(item) != 2
                    or not all(isinstance(x, (float, int)) and
                               not isinstance(x, bool) for x in item)
                    or not -180 <= item[0] <= 180 or not -90 <= item[1] <= 90):
                raise AuditError("Non-geographic county boundary vertex")
    return vertices


def validate_zip(data: bytes, geoid: str, layer: str) -> tuple[int, int]:
    if not 4 <= len(data) <= MAX_ZIP or not data.startswith(b"PK\x03\x04"):
        raise AuditError("Local cached archive is not a bounded ZIP")
    source_code = geoid[:2] if layer == "pointlm" else geoid
    prefix = f"tl_2025_{source_code}_{layer}."
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            files = archive.infolist()
            if not 2 <= len(files) <= 32:
                raise AuditError("Unexpected county archive entry count")
            total = 0
            names = set()
            for entry in files:
                name = entry.filename
                if (entry.is_dir() or "/" in name or "\\" in name or
                        name.startswith(".") or ".." in name):
                    raise AuditError("Unexpected archive path or directory")
                if entry.file_size > MAX_UNPACKED or entry.flag_bits & 0x01:
                    raise AuditError("Encrypted or oversized Census archive entry")
                total += entry.file_size
                if total > MAX_UNPACKED:
                    raise AuditError("Unpacked county archive exceeds memory budget")
                names.add(name)
            if prefix + "shp" not in names or prefix + "dbf" not in names:
                raise AuditError("Missing source SHP or DBF attribute record")
            # Read all entries, bounded by central-directory sizes, to verify
            # Python ZIP CRC independently of Rust's cache magic check.
            for entry in files:
                with archive.open(entry) as stream:
                    count = 0
                    while True:
                        chunk = stream.read(65536)
                        if not chunk:
                            break
                        count += len(chunk)
                        if count > entry.file_size or count > MAX_UNPACKED:
                            raise AuditError("ZIP entry expanded beyond declared budget")
                    if count != entry.file_size:
                        raise AuditError("ZIP archive entry is truncated")
            return len(files), total
    except (zipfile.BadZipFile, zipfile.LargeZipFile, OSError, EOFError, RuntimeError, zlib.error) as error:
        raise AuditError("Cached Census ZIP failed structural/CRC checks") from error


def audit(port: int) -> tuple[int, dict]:
    status, info = json_response(port, "GET", "/api/map/cache")
    if status != 200 or not isinstance(info, dict) or info.get("schema") != 1:
        raise AuditError("Local county-cache manifest unavailable")
    if info.get("network_used") is not False:
        raise AuditError("Cache manifest unexpectedly reports network usage")
    if info.get("active_geoid") is None:
        return 2, {"status": "EMPTY", "note": "No cached county selected; run MAP > CENTER > COUNTY first"}
    geoid = validate_geoid(info["active_geoid"])
    catalog_status, catalog = json_response(port, "GET", "/api/map/sources")
    if catalog_status != 200 or not isinstance(catalog, dict) or catalog.get("vintage") != "2025":
        raise AuditError("Official local Census source catalog unavailable")
    reported = {item.get("id") for item in catalog.get("sources", [])
                if isinstance(item, dict)}
    if reported != {name for name, _ in SOURCES}:
        raise AuditError("Local source catalog does not match the four known Census IDs")
    cached = info.get("cached_sources")
    if not isinstance(cached, list) or any(s not in reported for s in cached):
        raise AuditError("Local cache manifest contains an unknown source")
    report = {"schema": 1, "geoid": geoid, "boundary": "missing",
              "boundary_vertices": 0, "sources": [],
              "network_used": False, "coordinates_exported": False}
    boundary_status, boundary = json_response(
        port, "POST", "/api/map/boundary",
        {"geoid": geoid, "confirm": False, "cache_only": True},
    )
    if boundary_status == 200:
        report["boundary_vertices"] = validate_boundary(boundary, geoid)
        report["boundary"] = "validated-offline"
    elif boundary_status != 404:
        raise AuditError("Cached county boundary was rejected by Rust service")
    elif info.get("boundary_cached") is True:
        raise AuditError("Boundary cache manifest claimed missing GEOID as valid")
    if info.get("boundary_cached") is True and report["boundary"] != "validated-offline":
        raise AuditError("Active county boundary unexpectedly unavailable")
    valid = 0
    for source, layer in SOURCES:
        code, mime, raw = request(
            port, "POST", "/api/map/package",
            {"geoid": geoid, "source": source, "confirm": False, "cache_only": True},
        )
        if code == 404:
            if source in cached:
                raise AuditError(f"Manifest claimed unavailable {source} package")
            report["sources"].append({"source": source, "status": "not-cached"})
            continue
        if code != 200 or not mime.startswith("application/zip"):
            raise AuditError(f"Offline {source} package failed native cache read")
        if source not in cached:
            raise AuditError(f"Manifest omitted available {source} package")
        files, uncompressed = validate_zip(raw, geoid, layer)
        valid += 1
        report["sources"].append({
            "source": source, "status": "crc-verified",
            "archive_bytes": len(raw), "entries": files,
            "uncompressed_bytes": uncompressed,
        })
    # "Complete" requires all four sources, including the state-wide point
    # archive. The browser may still clip all landmarks out legitimately.
    full = valid == len(SOURCES) and report["boundary"] == "validated-offline"
    usable = valid > 0 and report["boundary"] == "validated-offline"
    report["valid_archives"] = valid
    report["status"] = "COMPLETE" if full else "PARTIAL" if usable else "INCOMPLETE"
    return 0 if full else 3, report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", required=True,
                        help="Existing absolute Rust-Boy MAP test data directory")
    parser.add_argument("--json", action="store_true",
                        help="Print metadata only; no coordinates or private sites")
    options = parser.parse_args(argv)
    try:
        home = ensure_home(Path(options.home))
        with local_server(home) as port:
            code, report = audit(port)
    except (AuditError, OSError, http.client.HTTPException, ValueError) as error:
        code, report = 1, {"status": "FAIL", "reason": str(error)}
    if options.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(f"MAP OFFLINE CACHE: {report['status']}")
        if "reason" in report:
            print(report["reason"])
        elif "note" in report:
            print(report["note"])
        else:
            print(f"COUNTY GEOID: {report['geoid']} / BOUNDARY: {report['boundary']}")
            for row in report["sources"]:
                extra = f" / {row.get('archive_bytes', 0)} bytes" if row["status"] == "crc-verified" else ""
                print(f"  {row['source']}: {row['status']}{extra}")
            print("LIVE WEB/GPS REQUESTS: NONE / DATA CHANGES: NONE")
    return code


if __name__ == "__main__":
    sys.exit(main())
