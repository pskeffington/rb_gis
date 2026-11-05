# DEV-00 / DEV-03 baseline evidence — 2026-11-05

Scope: remote GitHub source/branch inspection only. The following are *not* checks of local checkout integrity, compilation, CI execution, GUI behavior or runtime parity.

## Observations
- `main` vs `feat/navigation-guidance-on-native-gis`: compare status diverged, 107 commits ahead / 6 behind, including `Cargo.toml`, `Cargo.lock`, core and GUI crate source, tests, fixtures, archived legacy source, navigation AGENTS/kickoff.
- `feat/native-gis-foundation` vs `feat/navigation-guidance-on-native-gis`: 9 commits ahead / 0 behind; navigation branch contains native foundation ancestry.
- `main` vs `docs/navigation-literature-agent-roadmap`: 5 ahead / 5 behind; duplicate guidance branch requires manual diff before merging.
- Root `Cargo.toml` on navigation branch declares workspace members `crates/rb-gis-core` and `crates/rb-gis-gui`, Rust 2021, rust-version 1.85.
- `layers.rs` parses operator-selected local GeoJSON/manifests with explicit metadata and bounds, includes package fixture tests in source.
- `main.rs` describes five GUI pages and explicitly states no active live GNSS receiver.
- `map_view.rs` outlines polygon rings, explicitly postponing filled polygons/holes.
- `docs/LEGACY_LOADER_HANDOFF.md` identifies `crates/pipboy/src/dashboard.rs` as source for loopback /api/map/package, /api/map/boundary, /api/map/cache, /api/map/sources and /api/map/zip.
- In active `pskeffington/pip_boy`, the dashboard and map-county/map-zip paths exist on default branch; evidence hashes are in `docs/migration/PARITY_MATRIX.md`.

## Checks not executed
No `git clone` / `git rev-parse HEAD` local run; no `cargo fmt`, `cargo check`, `cargo test`, `cargo clippy`, desktop GUI smoke, Pi 5 hardware test, legacy JS test, ingestion benchmark, map snapshot or offline restore. All are NOT RUN. No agent registry invocation or attestation was executed in this pass.

## Engineering handoff
Checkout `feat/navigation-guidance-on-native-gis` or its rebased reviewed successor, verify actual HEAD, load `.agents/skills/offline-navigation/SKILL.md` and central registry, and run the build baseline. Record test count and error logs. Compare the active Pip Boy county service implementation to native API, then implement one missing loader slice with synthetic tests, without removing any existing Pip Boy implementation.
