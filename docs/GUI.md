# Standalone RB_GIS Field GUI

**Status (2026-10-28): committed source, Rust build/runtime unverified.**

From the repository root, with Rust/Cargo installed:

    cargo run -p rb-gis-gui

Targets a 480x320 window with a 320x240 minimum. Nothing in this executable depends on Pip Boy, a Rust Boy server, external maps, or a location provider.

## Operator interface

| Tab | Controls | Runtime behavior |
| --- | --- | --- |
| MAP | drag to pan, wheel to zoom around cursor, +/- zoom, FIT, GRID, LAYERS | Native offline renderer, reference grid when no source has been loaded |
| LYR | show/hide and FIT each loaded layer, remove individual layer, clear all | Changes view only; disk files unchanged |
| SRC | drag/drop local GeoJSON or an offline manifest, or enter local paths; assign role, source/vintage/credit | Multiple WGS84 layers, bounded read; manifest import replaces all layers only after complete validation |
| GPS | manual latitude/longitude center | This is explicitly NOT a GPS fix; no receiver adapter has shipped |
| SET | grid/labels, reset view | Resets camera without removing data |

The native map painter colors categories separately: roads (green), water (cyan), boundary (amber), landmarks (yellow), other (gray). Points, lines, and polygon **outlines** are drawn with a conservative seam check and a limited label budget. Polygon filling and holes are deliberately not yet implemented. No fabricated basemap or local fix is shown.

## Input capabilities

The native GeoJSON parser accepts feature collections with Point, MultiPoint, LineString, MultiLineString, Polygon and MultiPolygon geometry, with strict WGS84 lon/lat bounds. It rejects unsupported geometry types rather than silently skipping them. Maximum single file: 2 MiB / 2,000 expanded features / 30,000 vertices; maximum aggregate package: 12 layers, 8,000 features, 120,000 vertices. Limits are safety budgets, not a guarantee of device performance.

Manual GeoJSON imports require the operator to pick a category and declare source/vintage/credit. These fields are **claims by the user**, not an independently checked authority. Imports and layers are volatile application memory, never a persistent track.

Open a manifest at SRC using an absolute local filename, or drag a .json manifest onto the window. See [Offline package specification](OFFLINE_PACKAGE.md). Synthetic regression data is available under fixtures/synthetic-package and is **never** loaded automatically.

## Legacy map parity status

The original Pip Boy maps already had Census 2025 county roads/water/boundaries, ZIP/ZCTA lookup, cached shapefile packages, and optional online references. Copies of map.js, map-county.js, map-zip.js and related files are preserved under migration/pip-boy. However, the legacy browser renderer relied on Rust HTTP endpoints inside pip_boy/src/dashboard.rs, which have NOT been extracted into RB_GIS.

Thus the new GUI can display an explicitly imported GeoJSON or RB_GIS local directory package, but it **cannot yet** fetch or restore the old Census ZIP county cache directly. The remaining backend extraction is documented in [Legacy loader handoff](LEGACY_LOADER_HANDOFF.md). Do not remove Pip Boy's working map or mark full feature parity.

## Verification

Commands to run in a local checkout:

    cargo fmt --all
    cargo fmt --all -- --check
    cargo clippy --workspace --all-targets -- -D warnings
    cargo test --workspace
    cargo run -p rb-gis-gui

Use the synthetic test package only for verifying the renderer; do not use it as navigation geography. Verify both compact window sizes and actual on-device input, then record screenshots and measured performance. As of this pass, no compiled GUI or hardware test has been observed; GitHub Actions for the branch previously reported startup_failure and zero jobs.
