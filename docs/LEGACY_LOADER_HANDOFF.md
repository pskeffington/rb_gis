# Pip Boy county loader handoff — implementation inventory

## Observed active code (2026-10-28)

The original, working map is not limited to the map.js files.

| Source in pip_boy | Responsibility | RB_GIS owner proposal |
| --- | --- | --- |
| crates/pipboy/assets/map.js | browser rendering, viewport, county layering, GPS control | rb-gis-gui native map view (partial) |
| crates/pipboy/assets/map-county.js | strict county SHP/DBF/ZIP decoding and Census layer styling | rb-gis-county backend (not yet ported) |
| crates/pipboy/assets/map-zip.js | loopback ZIP/ZCTA county matching | rb-gis-county lookup adapter (not yet ported) |
| crates/pipboy/assets/map-import.js | GeoJSON and RustGIS interchange | rb-gis-core geometry loader (partial) |
| crates/pipboy/src/dashboard.rs | Rust loopback API for /api/map/package, /api/map/boundary, /api/map/cache, /api/map/sources, /api/map/zip | rb-gis-county independent service/library (NOT migrated) |
| tools/test_county_*.cjs and tools/test_map_*.cjs | baseline functionality and malformed input checks | preserve, adapt, and compare before cutover |

The original map package draws U.S. Census TIGER 2025 roads, areal/linear water and validated county boundaries; point landmarks are clipped to verified county polygons. Download and reuse are mediated by an explicit operator action, allowlisted local Rust service and offline cache.

## Immediate extraction tasks

1. Isolate the dashboard.rs county/ZIP endpoints, cache model, request validators and allowlisted sources. Do not copy unrelated Rust Boy dashboard services into RB_GIS.
2. Port the county ZIP/SHP/DBF ingestion contract with resource limits, provenance, and reject-by-default geometry handling; use the original map-county.js as a behavioral reference.
3. Implement a Rust-native GEOID and source-catalog type, and an adapter producing MapLayer records for the standalone GUI.
4. Add cache-only startup, atomic verified update, source vintage/attribution and per-county keying. Keep state-level landmarks hidden until point-in-polygon verification succeeds.
5. Prove parity against existing Pip Boy tests for roads, water, boundaries, ZIP disambiguation, offline reopen, malformed archives and no unauthorized networking.
6. Only then replace the Rust Boy MAP tab with a thin RB_GIS host boundary. Preserve independent GUI and rollback.

## No regression rule

Do not remove, overwrite, deprecate or rewire the current Pip Boy MAP implementation while RB_GIS is incomplete. The independent GUI may test the RustGIS interop and local packages, but is not an authoritative county-navigation replacement until M2/M5 gates pass.

## Preserved regression inventory
All 16 mapped legacy tools/test_* and audit_map_cache Python/CJS files identified in the 2026-10-28 Pip Boy repository tree are copied into migration/pip-boy/tools. These are **archival parity references** only. Their original host paths and fixtures still need adaptation; no execution results are claimed.
