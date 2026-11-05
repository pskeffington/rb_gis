# RB_GIS legacy-to-native migration parity matrix
Audit date: 2026-11-05
Status: source inspection only; NO tests or runtime checks executed.

## Evidence references
- Implementation branch: `feat/navigation-guidance-on-native-gis`, ahead of `feat/native-gis-foundation` by 9 commits in GitHub compare; compared to `main` 107 ahead / 6 behind at inspection.
- Core and GUI source inspected: `crates/rb-gis-core/src/lib.rs`, `layers.rs`, `crates/rb-gis-gui/src/main.rs`, `map_view.rs`.
- Active Pip Boy source inspected: `crates/pipboy/src/dashboard.rs` (blob `75b1e3185d2c24182cdd5b72d325c52f588eb3f8`), `assets/map-county.js` (blob `82360bab88fac548fb4d16c36c786f7a33ac1085`), `assets/map-zip.js` (blob `e351cf1d0c8744bc91e94fb78c19f2e123be8de3`). These hashes document files examined; no functional test is implied.
- See native branch `docs/LEGACY_LOADER_HANDOFF.md` for older service-endpoint inventory and regression filenames.

## Matrix
| Function | Legacy Pip Boy path | Native RB_GIS path | Inspected code status | Runtime/acceptance status | Required next step |
| --- | --- | --- | --- | --- | --- |
| WGS84 coordinate and approximate distance | `crates/pipboy-core/src/scout_gis.rs` | `crates/rb-gis-core/src/lib.rs` | PRESENT: typed coordinates and spherical distance | NOT RUN | cargo tests and coordinate edge fixtures |
| GeoJSON layer import | `assets/map-import.js` | `crates/rb-gis-core/src/layers.rs` | PARTIAL: local bounded GeoJSON and manifest load present | NOT RUN | compare malformed/large dataset and interop behavior |
| Roads, water, county boundaries drawing | `assets/map.js`, `map-county.js` | `crates/rb-gis-gui/src/map_view.rs` | PARTIAL: road/water/boundary layer kinds and line/ring paint | NOT RUN | golden images, ordering, labeling and field coverage |
| Polygon fills and holes | `assets/map-county.js` | `crates/rb-gis-gui/src/map_view.rs` | GAP: native painter explicitly draws polygon rings only | NOT RUN | safe tessellation/hole/clip fixtures before parity |
| County TIGER roads and water package acquisition | `crates/pipboy/src/dashboard.rs`, `assets/map-county.js` | No equivalent established in inspected native sources | GAP | NOT RUN | extract allowlisted fetch/source contract into standalone service |
| ZIP/SHP/DBF Census archive decoding | `assets/map-county.js` | `layers.rs` accepts local .geojson package, not SHP/DBF ZIP | GAP | NOT RUN | bounded, validated archive decoder and normalization |
| ZIP/ZCTA -> county lookup | `assets/map-zip.js`, `dashboard.rs` | No equivalent established in inspected native sources | GAP | NOT RUN | standalone county/GEOID lookup with ambiguity handling |
| County boundary retrieval/cache endpoints | `dashboard.rs` /api/map/boundary, /api/map/cache | No corresponding native endpoint established | GAP | NOT RUN | versioned cache API, integrity, offline restore |
| Package/source/ZIP endpoints | `dashboard.rs` /api/map/package, /api/map/sources, /api/map/zip | Local manifest loader only | GAP | NOT RUN | opt-in source/catalog acquisition, preserve rollback |
| Atomic replacement of displayed layers | `assets/map-import.js` | `layers.rs`, `gui/src/main.rs` | PARTIAL: whole local manifest validates before in-memory swap | NOT RUN | disk-persistent atomic cache and crash-restart test |
| Viewport pan/zoom/fit | `assets/map.js` | `crates/rb-gis-core/src/viewport.rs`, `gui/src/map_view.rs` | PRESENT in source for native pan/zoom and fit UI | NOT RUN | snapshot and edge-case parity both display sizes |
| Standalone GUI pages | Browser MAP inside Pip Boy | `crates/rb-gis-gui/src/main.rs` | PRESENT: MAP/LYR/SRC/GPS/SET pages | NOT RUN | macOS/Linux launch and screenshots |
| GNSS current live fix | `assets/map.js`, Pip Boy host | `crates/rb-gis-core/src/lib.rs`, `gui/src/main.rs` | PARTIAL: PositionFix freshness type; GUI explicitly no live receiver | NOT RUN | consented receiver and stale/no-fix acceptance |
| Offline sample geographic package | Pip Boy county cache | `fixtures/synthetic-package/manifest.json` | PRESENT: explicitly synthetic roads/water/boundary/landmarks fixture | NOT RUN | run package tests and a genuine licensed local-county cold restart |
| Walking road graph / navigation | No verified native graph in inspected paths | Navigation kickoff specification only | GAP | NOT RUN | defer until road tags, dataset lineage and loader parity |
| Rust Boy host MAP adapter | Current in-host MAP | Package socket design target | GAP | NOT RUN | typed adapter contract after parity, with rollback |

**Status semantics:** PRESENT/PARTIAL/GAP characterize source inspection only. Acceptance is uniformly NOT RUN. Do not promote source presence to a passing gate.

## Required tests for DEV-03 and DEV-04
1. Record SHA for the current Pip Boy source baseline at task execution; existing blob hashes above may become stale.
2. Compare county GEOID, ZIP/ZCTA disambiguation, roads, linear/areal water, county polygon and in-county landmarks against original fixtures.
3. Attempt invalid ZIP, SHP/DBF mismatch, path traversal, decompression bomb, oversized geometry, malformed source metadata and missing cached package fixtures.
4. Test no permission -> no network; offline cold start; atomic replacement failure retains last verified map.
5. Compare native 320x240 and 480x320 screenshots and show missing basemap/coverage honestly.
6. Reconcile source vintage, attribution, checksum and licensing before storing any real data.

## First implementation PR recommendation
DEV-02 native workspace compilation and GUI smoke on a branch based on `feat/navigation-guidance-on-native-gis`, then DEV-04 bounded native county loader in a *separate* PR. Keep Pip Boy map untouched and require cross-repo golden parity before switching MAP.
