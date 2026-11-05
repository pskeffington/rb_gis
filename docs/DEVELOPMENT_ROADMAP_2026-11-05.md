# RB_GIS development roadmap — execution pass 2026-11-05

Status: prospective engineering plan. This document is not build, parity, or hardware acceptance evidence. See [progress audit](PROGRESS_2026-11-05.md).

## Mission and invariant
Deliver an independent offline-first Rust GIS core and standalone GUI, preserving the known working Pip Boy roads/water/boundary/ZIP-county experience before switching its MAP consumer. Build deterministic, legal pedestrian routing only on top of proven geodata and access metadata. A map line is not necessarily a walkable road. Never imply that water vectors themselves are pedestrian routes.

## Reconciliation and precedence
- `main` is documentation/integration baseline, not the native implementation checkout.
- `feat/navigation-guidance-on-native-gis` includes native foundation ancestry and navigation-specific kickoff and AGENTS.md. Inspect current commit graph, resolve conflicts and use an isolated development branch based on the verified implementation tree. Do not cherry-pick navigation files onto a tree without Cargo/source.
- Compare `docs/navigation-literature-agent-roadmap` before copying overlapping documents.
- Reconcile `codex/central-agent-doctrine-20261104` central agent_skills requirements with navigation AGENTS; additive policy only, preserving local guards.
- Keep this roadmap distinct from `docs/MAJOR_ROADMAP.md` (M0–M7), `docs/navigation/ROADMAP.md` (NAV-00–07), and `docs/navigation/CODEX_KICKOFF_ROAD_WATER_FOOT.md` (WF-00–08).

## Execution gates and work orders

| Order | Dependency | Execution deliverable | Exit evidence | State |
| --- | --- | --- | --- | --- |
| DEV-00 checkout recovery | None | Record branch/HEAD, Cargo workspace/crates, AGENTS, native GUI, tests, legacy fixtures and provenance; compare feature branches | Versioned path inventory and diff summary | TODO |
| DEV-01 agent instruction reconciliation | DEV-00 | Integrate central agent_skills roles with local offline-navigation skill without replacing safety controls | Registry SHA, resolved skills, invocation/independent review records, or BLOCKED-AGENT | TODO |
| DEV-02 native build baseline | DEV-00 | Reproducible fmt/check/test/clippy; GUI launch on supported host, capture 320x240/480x320; detect blank canvas | Exact commands, OS/Rust, counts/logs/screens and failures | NOT RUN |
| DEV-03 legacy parity inventory / WF-00 | DEV-00 | Trace Pip Boy county loopback/ZIP/Census loader, sources, cache, boundaries, roads, water, styling and controls to native equivalents | Per-feature source path -> new path -> fixture -> coverage status, with GAP labels | TODO |
| DEV-04 restore native geodata | DEV-02, DEV-03 | Bounded Census archive/package ingestion, road/water/boundary/ZIP-county layers, source/vintage and checksum, rollback-safe atomic cache | Synthetic archive adversarial tests; cold offline restart of real licensed local package | BLOCKED on baseline |
| DEV-05 renderer parity | DEV-02, DEV-03 | Layer ordering, roads and borders, polygon holes, clipping/zoom/fit, 320x240/480x320 snapshots | Golden comparisons, explicit missing-data state, no render regression | BLOCKED on baseline |
| DEV-06 graph-ready road importer / WF-01–02 | DEV-03, DEV-04 | Separate pedestrian/access importer with deterministic directed topology, actual junctions/bridge separation and restrictions | Synthetic legal-access and invalid-connectivity fixtures | BLOCKED on geodata |
| DEV-07 route correctness / WF-03 | DEV-06 | Dijkstra reference + deterministic A*; stable IDs, integer cost, explicit NO_ROUTE/COVERAGE_GAP | Oracle parity, tie stability, randomized ingest, overflow tests | BLOCKED on topology |
| DEV-08 waterfront / WF-04–06 | DEV-07 | Hydro reference corridors only, qualifying river reach >=5 km default, legal foot-edge preference <=20% within 250 m default, typed warnings | 4999/5000/5001 m, private shore, cliff, disconnected river and inland fallback fixtures | BLOCKED on route core |
| DEV-09 position and GUI / WF-07–08 | DEV-05, DEV-08 | Consent-driven GNSS replay, route progress, independent overlay and versioned host socket | Stale/denied/no-fix, offline GUI and adapter contract tests; no legacy removal | BLOCKED on parity |
| DEV-10 target device / release | DEV-09 | macOS/Linux ARM64 (Pi 5 primary) tests, memory, frame timing, secure import, rollback and operator acceptance | Physical target measurements and maintainer sign-off | NOT RUN |

## Immediate sprint: evidence before feature addition
1. **DEV-00**: inspect all candidate branches and select the complete native implementation checkout. Record SHA and every required path. Do not work from minimal main.
2. **DEV-01**: reconcile AGENTS instructions and agent_skills registry; do not assert enforcement before checks exist.
3. **DEV-02**: run the actual local/CI Rust gates, fixing the smallest reproducible failures in a separate PR. Do not infer green status from code presence.
4. **DEV-03**: independently inventory Pip Boy legacy loader and render behavior. Build fixture and parity matrix; enumerate missing source and source lineage.
5. **DEV-04/05**: choose the first unblocked, test-backed incremental migration; preserve legacy code and reversible integration.

## Architecture contracts
- `rb-gis-core`: geometry, provenance, source/cached packages, offline lookup and coordinate system correctness.
- `rb-gis-gui`: independent local mapping UI, no automatic GPS/network startup, truthful empty reference grid.
- `navigation`: directed walkable network and route outputs; must not rely on `pip_boy` repository at build or runtime.
- `pip_boy`: shell/role/Settings/consent owner, thin typed adapter only after parity.
- No implicit GNSS retention, fabricated current coordinates, illegal shoreline traversals or upstream RustGIS edits.

## Measurements and acceptance
- Format: `cargo fmt --all -- --check`
- Compile: `cargo check --workspace`
- Tests: `cargo test --workspace`
- Lint: `cargo clippy --workspace --all-targets -- -D warnings`
- GUI: `cargo run -p rb-gis-gui` where a display runner is available.
Record runner OS, toolchain, dependency/lockfile state, test counts, timed/memory measurements where executed, hashes, screenshots, failures and command exit codes. Mark unavailable checks NOT RUN, rather than PASS.

## Release crosswalk
- M0/G0 -> DEV-00/01/02.
- M1/G1/G2 -> DEV-05 renderer and geometry.
- M2/G3 -> DEV-03/04 legacy data ingestion and cached local geography.
- NAV-00/WF-00 -> DEV-03; NAV-01/02/WF-01..06 -> DEV-06..08.
- M3/M4/G4 -> DEV-09 GNSS and self-contained GUI.
- M5/G5 -> DEV-09 host adapter after sign-off.
- M6/G6/NAV-07 -> DEV-10 physical device/release review.
- M7 optional interoperability remains deferred, and does not block core offline readiness.

## Reporting template
Every implementation PR must state task ID; current branch/HEAD; agent registry commit and roles; changed paths; fixture input/provenance hashes; commands actually run, results and counts; parity before/after; explicit remaining risks; rollback procedure; and next unblocked task.

**Promotion policy:** No default Rust Boy MAP replacement, legacy deletion or release assertion until reviewed parity and separate hardware acceptance. This roadmap does not authorize automatic merge.
