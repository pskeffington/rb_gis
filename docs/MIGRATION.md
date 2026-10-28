# Pip Boy -> RB_GIS migration plan

Source repository: https://github.com/pskeffington/pip_boy
Destination: https://github.com/pskeffington/rb_gis

## Source inventory (observed 2026-10-28)
- crates/pipboy-core/src/scout_gis.rs: read-only bounded Point GeoJSON and spherical distance
- crates/pipboy/assets/map.js: browser viewer, WGS84 Web Mercator, pan/zoom and indexed features
- crates/pipboy/assets/map-county.js: county GIS display logic
- crates/pipboy/assets/map-import.js: explicit local imports
- crates/pipboy/assets/map-online.js: optional online reference access
- crates/pipboy/assets/map-zip.js: ZIP/ZCTA and county lookup
- crates/pipboy/assets/map.css: phosphor host-specific presentation
- docs/SCOUT_GPS_MAP.md and docs/SCOUT_GIS_TAK.md: behaviors and constraints
- tools/test_map_*.cjs and tools/test_rustgis_*.cjs: regression fixtures

## Source-of-truth boundary
Do not delete or modify the Pip Boy mapping implementation during Phase 0.
RB_GIS independently owns coordinate and GIS domain APIs. Pip Boy owns its navigation bar, Settings, and operator consent.
No upstream RustGIS code vendoring or upstream RustGIS repository writes.
Port behavior with independent Rust modules; retain a compatibility adapter until parity evidence exists.

## Gates
| Gate | Deliverable | Acceptance |
| --- | --- | --- |
| G0 | Core crate, literature matrix, machine index | cargo fmt --check, cargo test, cargo clippy |
| G1 | Bounded GeoJSON points/lines/polygons | malformed geometry, vertex limits, antimeridian, RFC 7946 fixture tests |
| G2 | Camera, world wrap, offline layer engine | 480x320, 320x240 render fixtures, no missing-basemap masquerading as live map |
| G3 | Local county packages, offline cache | verified source/vintage, cache integrity, partial/missing coverage distinctions |
| G4 | GNSS adapters and explicit permission lifecycle | stale/no-fix/denied/low-quality states; no persistent live location by default |
| G5 | Host integration through opt-in adapter | compare original Pip Boy fixtures and snapshots before switching ownership |
| G6 | ARM64 device acceptance | actual boot/render latency, memory, power, suspend/resume, degraded receiver tests |

## Field design constraints
- First run: CENTER UNSET / GRID ONLY. Never synthesize a position.
- Manual center must not be labeled as a GPS fix.
- Map tile/package fetching requires explicit consent; offline mode must be useful without a network.
- Show horizontal uncertainty and fix age; reject stale position for live-follow.
- Distinguish reference maps from validated safety-critical navigation products.
- Keep location and cache provenance separate: persistent offline geography is permissible, implicit tracking is not.
- Limit input size, vertices, nesting, decompression ratio, archive paths, and concurrent fetches.
- Offline tiles/archives need source, attribution, license, update vintage and checksum metadata.
- Preserve last validated offline data if a replacement fails.
- Physical touchscreen usability and Pi 5 GPU performance are unverified until device testing.
