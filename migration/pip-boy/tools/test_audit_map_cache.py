#!/usr/bin/env python3
"""Real Rust loopback integration tests for the strictly offline MAP cache auditor."""
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from audit_map_cache import (
    AuditError, SOURCES, audit, local_server, request, validate_zip,
)


def cache_fixture(home: Path, geoid: str = "01001",
                  source_ids=None, boundary=True):
    root = home / "county_cache"
    root.mkdir(parents=True, exist_ok=True)
    (root / "active_geoid").write_text(geoid, encoding="ascii")
    if boundary:
        fixture = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {"GEOID": geoid, "NAME": "Synthetic Test County"},
                "geometry": {"type": "Polygon", "coordinates": [[
                    [-86.5, 32.5], [-86.4, 32.5],
                    [-86.4, 32.6], [-86.5, 32.5],
                ]]},
            }],
        }
        (root / f"boundary_2025_{geoid}.geojson").write_text(
            json.dumps(fixture), encoding="utf-8"
        )
    for name, layer in SOURCES:
        if source_ids is not None and name not in source_ids:
            continue
        prefix = f"tl_2025_{geoid[:2] if layer == 'pointlm' else geoid}_{layer}"
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as stream:
            stream.writestr(prefix + ".shp", b"OFFLINE-SYNTHETIC-SHP-FIXTURE")
            stream.writestr(prefix + ".dbf", b"OFFLINE-SYNTHETIC-DBF-FIXTURE")
        (root / f"tl_2025_{geoid}_{layer}.zip").write_bytes(buf.getvalue())
    return root


class TestMapCacheAudit(unittest.TestCase):
    def test_unpopulated_home_requires_real_county_acquisition(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            with local_server(home) as port:
                code, report = audit(port)
                self.assertEqual(code, 2)
                self.assertEqual(report["status"], "EMPTY")
            self.assertFalse((home / "county_cache").exists())

    def test_four_real_loopback_reads_with_no_external_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            root = cache_fixture(home)
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            with local_server(home) as port:
                code, report = audit(port)
                self.assertEqual(code, 0)
                self.assertEqual(report["status"], "COMPLETE")
                self.assertEqual(report["valid_archives"], 4)
                self.assertEqual(report["boundary"], "validated-offline")
                self.assertEqual(report["network_used"], False)
                self.assertEqual(report["coordinates_exported"], False)
                self.assertEqual(len(report["sources"]), 4)
                self.assertTrue(all(item["status"] == "crc-verified"
                                    for item in report["sources"]))
                # The auditor must not accept a caller trying to turn on network.
                with self.assertRaises(AuditError):
                    request(port, "POST", "/api/map/package",
                            {"geoid": "01001", "source": "tiger-roads",
                             "cache_only": False, "confirm": True})
            after = {p.name: p.read_bytes() for p in root.iterdir()}
            self.assertEqual(before, after, "Audit must not mutate cache files")

    def test_partial_sources_are_reported_not_invented(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            cache_fixture(home, source_ids={"tiger-roads"})
            with local_server(home) as port:
                code, report = audit(port)
                self.assertEqual(code, 3)
                self.assertEqual(report["status"], "PARTIAL")
                self.assertEqual(report["valid_archives"], 1)
                self.assertEqual(
                    [item["status"] for item in report["sources"]],
                    ["crc-verified", "not-cached", "not-cached", "not-cached"],
                )

    def test_corrupt_zip_fails_even_if_rust_magic_accepts_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            root = cache_fixture(home)
            broken = root / "tl_2025_01001_roads.zip"
            broken.write_bytes(b"PK\x03\x04not a full ZIP")
            with local_server(home) as port:
                with self.assertRaisesRegex(AuditError, "ZIP"):
                    audit(port)
            self.assertEqual(broken.read_bytes(), b"PK\x03\x04not a full ZIP")

    def test_corrupt_county_polygon_is_never_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            root = cache_fixture(home)
            boundary = root / "boundary_2025_01001.geojson"
            data = json.loads(boundary.read_text(encoding="utf-8"))
            data["features"][0]["properties"]["GEOID"] = "01003"
            boundary.write_text(json.dumps(data), encoding="utf-8")
            with local_server(home) as port:
                with self.assertRaisesRegex(AuditError, "boundary"):
                    audit(port)

    def test_zip_crc_integrity_is_independent_of_magic_prefix(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            root = cache_fixture(home)
            data = bytearray((root / "tl_2025_01001_roads.zip").read_bytes())
            # Alter compressed member bytes but retain local-file magic and
            # central-directory metadata: CRC validation must detect damage.
            data[45] ^= 0x17
            with self.assertRaises(AuditError):
                validate_zip(bytes(data), "01001", "roads")


if __name__ == "__main__":
    unittest.main()
