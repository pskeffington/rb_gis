# RB_GIS

An **independent, offline-first Rust GIS application and library** for small handheld displays, desktops and eventual use as a Rust Boy module. Developed separately from [Pip Boy](https://github.com/pskeffington/pip_boy) so mapping can be tested and changed without rebuilding the entire host.

## Current development status

The native workspace contains:
- **rb-gis-core**: WGS84 coordinates, approximate distances, freshness, Web Mercator viewport, bounded GeoJSON, source-labelled offline map layers and package-manifest ingestion.
- **rb-gis-gui**: standalone eframe application with MAP, LYR, SRC, GPS, SET pages; independent category visibility, multiple local map layers, manual center, zoom/pan/fit and local file/drop import.
- **migration/pip-boy/**: preserved originals of the older, fully featured Pip Boy browser map. Those files are reference copies, not automatically wired into the new GUI.

**Important:** standalone GUI builds and tests have not yet been verified. The working Census road/water/boundary and ZIP/county download service remains in Pip Boy until backend extraction and parity tests are complete. The current standalone GUI supports **explicit local GeoJSON or RB_GIS directory packages**, not direct Census shapefile ZIP acquisition. It makes no network or GNSS calls.

## Run / validate locally

    cargo fmt --all
    cargo clippy --workspace --all-targets -- -D warnings
    cargo test --workspace
    cargo run -p rb-gis-gui

Default GUI size is 480x320, minimum 320x240. On first run it displays only a clearly marked reference grid and does not pretend that a location or basemap is available.

## Read first

- [Repository index](docs/INDEX.md) and [machine catalog](catalog/index.json)
- [New GUI controls](docs/GUI.md)
- [Offline package specification](docs/OFFLINE_PACKAGE.md)
- [Pip Boy county service handoff](docs/LEGACY_LOADER_HANDOFF.md)
- [Major roadmap](docs/MAJOR_ROADMAP.md)
- [Migration gates](docs/MIGRATION.md) and [literature matrix](docs/LITERATURE_MATRIX.md)

## Safety and ownership

No automatic GPS use, synthetic live locations, background tracking, or network requests. Imported provenance is displayed as declared, not independently verified. Pip Boy remains the operational map implementation until audited parity and a thin host adapter are complete. No changes are made to upstream RustGIS.
