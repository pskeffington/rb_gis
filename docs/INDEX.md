# RB_GIS development index

Machine entrypoint: [catalog/index.json](../catalog/index.json)  
Component manifest: [catalog/components.json](../catalog/components.json)  
Gate ledger: [catalog/gates.json](../catalog/gates.json)  
Offline package schema: [catalog/package_schema.json](../catalog/package_schema.json)

## Recommended read order

1. [README](../README.md) — product boundary and quick run instructions
2. [GUI](GUI.md) — independent small-screen tabs and current features
3. [Offline package](OFFLINE_PACKAGE.md) — atomic local layer loading
4. [Legacy loader handoff](LEGACY_LOADER_HANDOFF.md) — remaining Census/ZIP source extraction
5. [Major roadmap](MAJOR_ROADMAP.md) — M0–M7 implementation and acceptance
6. [Migration contract](MIGRATION.md) — gates and safety invariants
7. [Literature matrix](LITERATURE_MATRIX.md) — geospatial technology research

## Current source of truth

- crates/rb-gis-core/src/lib.rs — core public API
- crates/rb-gis-core/src/geojson.rs — bounded GeoJSON
- crates/rb-gis-core/src/viewport.rs — Web Mercator and cursor-centered zoom
- crates/rb-gis-core/src/layers.rs — local package model, provenance and atomic load
- crates/rb-gis-gui/src/main.rs — standalone application tabs, source controls, lifecycle
- crates/rb-gis-gui/src/map_view.rs — map painting, labels and category styles
- fixtures/synthetic-package — synthetic non-navigation regression fixtures; never loaded automatically
- migration/pip-boy — legacy working reference code, excluded from native Rust workspace

## Implementation gaps that must not be hidden

The new GUI draws explicit local data; the original Pip Boy working county-loader service still lives in crates/pipboy/src/dashboard.rs and its browser assets. A true native Census loader, ZCTA lookup, county clipping, archive cache, offline cold-start restore, physical GNSS and reliable polygon fills have NOT yet been ported. Imported source attributions are not authenticated.

A native build was not executed in this session: Cargo is absent from the execution environment; GitHub Actions branch jobs have reported startup_failure before any steps are created. Passing tests, touch responsiveness and device performance must not be asserted until measured.

## Machine indexing contract

When changing code, update catalog/components.json and catalog/index.json as appropriate. Update catalog/gates.json only when evidence supports milestone changes. Keep independent GUI and original Pip Boy map intact until parity. Source owners must always be clear; do not move the entire host runtime into RB_GIS.

## October 30 coordination

- [Branch reconciliation and evidence status](STATUS_2026-10-30.md)
- [Prioritized Codex agent queue and crosswalk](AGENT_TASK_QUEUE.md)
- [Navigation roadmap](navigation/ROADMAP.md)
- [Road and waterfront deterministic algorithm kickoff](navigation/CODEX_KICKOFF_ROAD_WATER_FOOT.md)
- [Navigation literature matrix](navigation/LITERATURE_MATRIX.md)

The navigation feature branch is based on the native GIS foundation and is the documented Codex starting point; do not start an implementation pass from the minimal main checkout.
