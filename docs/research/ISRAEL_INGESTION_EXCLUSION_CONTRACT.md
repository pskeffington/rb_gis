# ISR-BUILD-01 — Israel built-environment ingestion and exclusion contract
Date: 2026-11-05
Status: scoped development order; ingestion, validation, rendering and deployment NOT RUN.

## Explicit geographic product scope
**User requirement:** ZERO mapping content for the Gaza Strip and the ENTIRE West Bank.
This applies to all source feeds and all surfaces, not merely to named landmarks.
For the public MAGOG Israel demonstrator:
- Exclude the Gaza Strip and all of the West Bank, including East Jerusalem. Do not silently substitute Area A/B-only geometry; Areas A, B and C are all excluded. Do not use administrative/control-area subdivisions as an exemption.
- Do not ingest, index, search, serve, cache, label or render any buildings, roads, paths, outlines, boundaries, place labels, geocoded addresses, points of interest, routes, tiles, imagery, 3D geometry or metadata from these areas.
- Do not expose masked data through hover, API, autocomplete, bounding-box queries, clustering, downloads, debug modes, alternate zoom levels, cached or offline packages.
- Entire display regions within excluded polygons must remain uniform blank/no-data. This includes background basemaps; no faint contextual road lines, political borders or place labels.
- Exclusion applies independently of upstream provider labels and disputed-territory conventions.

## Boundary and filtering specification
- Acquire a verified, version-pinned geospatial polygon for Gaza and for the entire West Bank including East Jerusalem. Document source, date, accuracy, legal/territorial POV, SHA-256, and country/area definitions. Do not assume country-level ISO or an OSM administration tag alone is sufficient.
- Use explicit allowlist + exclusion polygons. Select Israel features only *after* subtracting exclusions, regardless of whether the source advertises an `Israel` partition. The region is not inferred by subtracting a rough bounding box.
- Apply an inward-safe exclusion mask with a configurable uncertainty buffer measured in meters to prevent inadvertent bleed from boundary imprecision; the buffer is a display/data suppression rule, not a claim of sovereignty. Preserve full original geodata in a separate non-public staging area only if permitted and necessary for filtering, with prompt disposal and no downstream access.
- Geometry semantics: drop any point in exclusion; polygon/line geometries crossing excluded polygons must be clipped on ingestion; if geometry cannot be safely clipped or validated, reject the whole feature. A feature name or source-country tag is never evidence that it lies outside the exclusion.
- No cross-boundary road segments, text glyphs, selected-feature halo, 3D silhouettes or overscaled tiles may render inside exclusion. Clip every map layer at render time in addition to ingestion and tile generation.
- At low zoom, render only allowed coverage. Never replace the blank area with a cached global basemap. Suppress sensitive territorial names and boundary outlines within the blank mask instead of displaying hidden-map silhouettes.
- When accurate polygons have not been validated, FAIL CLOSED: return NO_COVERAGE/EXCLUDED_AREA for boundary-adjacent data and do not release imagery or vector tiles.

## Existing reusable Rust implementation
Native source on `feat/navigation-guidance-on-native-gis`:
- `crates/rb-gis-core/src/geojson.rs` parses WGS84 GeoJSON point/line/polygon and Multi* geometry.
- `crates/rb-gis-core/src/layers.rs` supports `rb-gis-package/v1` manifests, local provenance and cache-only selected-layer loads.
- Existing limits: max 2 MiB per GeoJSON file, 2,000 features per file, 30,000 vertices per file, 8,000 features and 120,000 vertices per manifest, 12 layers. Nationwide buildings require bounded partitions/tiles, not a single GeoJSON file.
- Current parser preserves primarily `properties.name` (up to 64 characters). Add a versioned, typed rich building/POI metadata schema rather than losing IDs, source license and multilingual names.
- The production Pip Boy U.S. Census county importer is not yet migrated; do not treat its live dataset pipeline as a finished `rb_gis` backend.

## Data ingestion order
1. Pin and independently validate Gaza and full West Bank exclusion polygon fixtures, source attribution, and mask tests.
2. Import a small, allowed-area urban fixture (e.g. Haifa or Tel Aviv) from Geofabrik OSM and/or licensed Overture Buildings + Places.
3. Normalize source IDs, WGS84 geometry, polygon rings, optional height, native-script name labels, types and provenance into internal records.
4. Spatially filter all geometry, indexes, labels and tiles using approved area mask *before* writing public packages. Apply clipping again in renderer.
5. Build tile/partition loader compatible with existing package size limits; verify offline fresh start and cold-cache behavior.
6. Add named landmark search, layer toggles, zoom thresholds and source attribution to public frontend.
7. Validate excluded-area blankness in all render modes and all APIs before any MAGOG deployment.

## Required regression fixtures and acceptance
- Representative points and polygons in Gaza, East Jerusalem, the West Bank (Areas A/B/C), wholly inside allowed area, on boundaries and crossing borders.
- Test roads, building multipolygons, POIs, labels, cursor hover, search, clusters, tile overzoom, PNG/screenshots, stale cache, offline restart and frontend/API direct requests.
- For each excluded-area sample: **zero geometry and zero readable labels/pixels carrying geographic content**, no searchable IDs and no downloadable tile payload.
- Include fuzz/property tests for clipping, coordinate order, invalid/missing boundary files, antimeridian/wrap, 3D geometry, map zoom and tile-buffer seam leaks.
- Any ambiguous or invalid exclusion polygon => fail closed; do not fall back to unfiltered OSM, global vector tiles or image basemap.
- Audit source-map/political-boundary licensing, version and change controls. Do not equate the map's omission with a statement about sovereignty.

## Codex execution instruction
Use the pinned central agent_skills registry and local AGENTS guardrails, inventory actual implementation branch SHA, and implement **exclusion tests before source importer changes**. Keep this work on isolated feature branch; leave Pip Boy production map unchanged. Record actual tests, logs, boundary fixture provenance and rendered screenshot results. All gates remain NOT RUN until evidence is available.
