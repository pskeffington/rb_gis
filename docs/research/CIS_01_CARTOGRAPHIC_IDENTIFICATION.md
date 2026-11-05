# CIS-01 — Rust Boy Cartographic Identification System
Date: 2026-11-05
Status: specification / Codex tasking only. Geometry ingestion and renderer acceptance NOT RUN.
Consumers: standalone rb_gis, Rust Boy, optional MAGOG website.

## Primary map reference: pre-June 1967 lines
The default reference-label is **Pre-June 1967 Line (Green Line)**, meaning the 1949 Armistice Demarcation Lines as they stood before the June 1967 war. Display aliases: "1949 Armistice Line", "Green Line", and "Pre-1967 Line". The line is a reference used for territorial analysis, not itself an agreed final international border. A separate **June 1967 post-war ceasefire/control boundary** must NOT be conflated with the pre-June 1967 reference, and is disabled unless independently sourced. The **1947 UN Partition Plan (Resolution 181)** is a proposed historic partition and is independent of both.

## Legend and identifying conventions
| ID | Scope | Style | Default |
| --- | --- | --- | --- |
| REF-1967 | Pre-June 1967 / 1949 Green Line | high-contrast bright green, distinct dashed stroke, label "PRE-1967 / GREEN LINE" | ON only once validated |
| REF-1947 | 1947 UN proposed partition | red short dashes, label "1947 UN PROPOSAL" | OFF |
| REF-1967-POST | Post-June 1967 ceasefire/control line where independently documented | violet dotted; must declare local source and event/vintage | OFF |
| GEO-BUILDING | building footprint | low-contrast mint outline | contextual |
| GEO-PLACE | significant landmark, civic institution, historic site | amber marker | contextual |
| GEO-SETTLEMENT | *documented settlement footprint* from independently identified dated polygons | translucent blue; cannot be inferred from merely being east of a line | OFF |
| GEO-UNCERTAIN | geometric mismatch/disputed line interpretation | silver hatched band, with uncertainties | contextual |
| GEO-EXCLUDED | deliberate geographic no-coverage | blank / no basemap, details, labels, search, hover, tiles or export | mandatory |

A style indicates cartographic feature class; it is not evidence of ownership, residents' nationality or settlement legality.

## Deterministic classification contract
1. Collect publisher/source, release/date, license/attribution, geometry CRS, precision, source feature ID and integrity hash.
2. Normalize to WGS84, validate topology and correct coordinate order. Preserve names in Hebrew, Arabic, English and original scripts when supplied.
3. Apply source-validated geographic coverage rules **before** index/cache/tile generation. MAGOG public demo excludes the whole Gaza Strip and West Bank including East Jerusalem, regardless of changes in settlement geometry. This is location-based; never infer exclusions from ethnic, religious or nationality demographics. Fail closed on missing boundaries.
4. Classify type: building / civic POI / road / documented settlement polygon / dated historical reference.
5. Calculate spatial relationships (`within`, `intersects`, `crosses`, `touches`, `uncertain`) on exact feature geometry, not just centroids; ambiguous crossing segments receive no inferred legal status.
6. Assess independent provenance: source-verified, cross-source corroborated, single-source, conflicting, outdated, excluded, unavailable. Multiple derivatives of one dataset are not independent corroboration.
7. Clip source geometry and annotations to approved coverage, render, then reapply hard exclusion mask so labels, line antialiasing and cached tiles cannot leak.
8. Every object inspection exposes date, data source, license, original feature ID, position uncertainty and applicable boundary-reference version.

## Uncertainty and dispute handling
The pre-1967 Green Line is a historical armistice reference, not a universal ownership classifier. Different sources' interpretations of East Jerusalem, no-man's-land zones, and armistice representations must not be fused silently. Use provenance and visible uncertainty bands; never fabricate cartographic precision. For area-specific classifications require actual published footprint geometry with independent source evidence.

## Screen and core integration
Current native branch `feat/navigation-guidance-on-native-gis` contains `crates/rb-gis-core/src/geojson.rs` and `layers.rs` with bounded local GeoJSON and manifest loading, plus standalone egui GUI. Current parser holds mostly `properties.name`, and source attribution is operator-declared; extend with versioned typed source metadata. Present compact 320x240 and 480x320 legend: "PRE-1967" and expandable detail "1949 Armistice / Green Line"; independent 1947 and post-1967 toggle. Preserve existing Rust Boy / Pi map until renderer and parity checks pass.
Existing parsing limits: 2 MiB and 2,000 features per file; package 8,000 features, 120,000 vertices, 12 layers. Use bounded tiled/partitioned data sources for nationwide building footprint imports.

## Test gates
- Gold fixtures: 1947 vs pre-1967 vs post-1967 date and label ambiguity, independently verified geometry hashes, invalid geometry, crossing polygons, source uncertainty, duplicate source records, multilingual labels.
- Negative fixtures: missing polygons => no coverage; excluded Gaza/West Bank/East Jerusalem geometry, labels, tiles, exports, hover, POI index and overzoom all blank.
- UI: no misleading ownership inference from blue polygons; visible dated line legend; keyboard and touch; screenshots at 320x240 and 480x320.
- Audit: `cargo fmt --all -- --check`, `cargo check --workspace`, `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, headless render snapshots and actual Pi 5 smoke. Report NOT RUN until executed.

## Next Codex work order: CIS-01A
Read source branch and central agent_skills registry; establish line metadata and authoritative source fixtures first; reconcile geometry provenance and MAGOG exclusions before making renderer modifications. Open an isolated implementation PR based on complete native source, not documentation-only main. Source-code changes and public deploy require their own validation and review.

## References
- UN General Assembly Resolution 181 (II), 29 November 1947: https://digitallibrary.un.org/record/671195
- 1949 Israel-Jordan Armistice Agreement: https://peacemaker.un.org/
- UN OCHA 1949 Green Line GIS dataset (candidate, check current service): https://gis.unocha.org/
