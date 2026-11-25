# Israel built-environment GIS: dataset literature matrix
Date: 2026-11-05
Target: standalone `rb_gis` Rust engine, optional public `magog.institute` demonstrator.
Status: provider documentation reviewed; datasets NOT YET ingested or validated. Website deployment ownership unverified.
Scope: building footprints, place names, landmarks, streets, addresses, historical/heritage sites, civic/public facilities. Environmental layers, live tracking, and sensitive infrastructure NOT in this pass.

## Ranked inventory
| ID | Rank | Source | Target records | Format and access | Licensing | Quality / caveat | Pipeline |
|---|---|---|---|---|---|---|---|
| B-01 | P0 | Overture Maps buildings | footprints, building parts, height if available, class | GeoParquet cloud; bbox extraction (2026-10-21.0 example) | CDLA-Permissive v2 or ODbL for OSM derivatives; preserve feature-level terms | many footprints unnamed; heights incomplete; deduplicate vs OSM | `GeoParquet -> WKB polygons -> GeoPackage/PMTiles` |
| B-02 | P0 | Geofabrik OpenStreetMap Israel and Palestine | tagged building polygons, streets, named sites, public amenities | OSM PBF, GeoPackage, Shapefile; recurring extracts | ODbL 1.0 | variable local completeness; avoid duplicating Overture source footprints | `PBF -> osmium/imposm -> normalized features` |
| B-03 | P0 | Overture Places | named points of interest, public institutions, cultural facilities, retail | GeoParquet; bbox filter; 2026 schema v2 taxonomy | per feature/source license | positional and name validation; no assumption every POI is verified | `place parquet -> typed places index` |
| B-04 | P0 | Overture Addresses | address points, location labels | GeoParquet | source-level licenses | some source restrictions and unmatched address geometries | `address points -> spatial joins` |
| B-05 | P1 | GovMap / Survey of Israel and data.gov.il | official addresses, structures, civic geographic layers where licensed | API / publisher-specific geodata | per dataset/API; verify redistribution | source-specific permissions; national geographic POV | `licensed adapter only` |
| B-06 | P1 | Wikidata geocoordinates | notable places, historic buildings, museums, monuments | SPARQL/JSON | CC0 structured data | uneven coverage; coordinate and entity conflation | `QID join, dedupe, label language` |
| B-07 | P1 | UNESCO World Heritage List | designated heritage sites | downloadable records/map metadata | check site-specific data rights | heritage designation boundaries may be approximate | `curated heritage overlays` |
| B-08 | P1 | OpenStreetMap heritage and historic tags | archaeological sites, memorials, religious and cultural places | OSM PBF | ODbL | inconsistent historic tags and names | `historic/tag filter` |
| B-09 | P1 | Overture transportation | street and pedestrian network context | GeoParquet | source-level | road network not by itself a validated walking route | `render-only topology layer` |
| B-10 | P2 | Israel CBS / municipal open-data catalogs | statistical-area public institution lists and municipal assets | varied | verify per-layer | differences in vintage, source boundaries | `optional municipal per-layer` |

## Canonical record
`feature_id, source, source_id, source_release, source_license, geometry, bbox, geometry_crs, name_primary, name_he, name_ar, name_en, feature_kind, place_class, address_ref, height_m_optional, confidence_optional, observed_or_published_at, retrieved_at, provenance_url, sha256`.
Never synthesize omitted names/heights/locations. Preserve original identifiers and source-specific claims. Spatial duplicate matches must be auditable and reversible.

## Public demo controls
- Default map features: building silhouettes, street names, named landmarks, museums, universities, places of worship, major public facilities and archaeological/heritage sites.
- Search by Hebrew, Arabic and English where available; transliteration is an alternate searchable label, not a replacement for native scripts.
- Progressive zoom and data-driven clustering; low zoom major landmarks, mid zoom named POIs, high zoom building footprints; cache bounded city packages.
- Israel primary viewport with selectable regional context, without imposing a single unqualified border POV over disputed territories. Source and date labels for any boundaries.
- Include generic public-building categories; exclude exact security-sensitive infrastructure overlays, personal residential details, real-time personnel/device tracks and operator targeting layers.
- Data licensing gate before server-side mirroring; ODbL and feature-level provenance retained.

## Proposed acceptance checks
1. Schema import of a small urban sample; no silent projection change; ring closure and polygon validity tests.
2. Overture-vs-OSM footprint overlap report, false joins and cross-source attribution.
3. Multilingual label search and category filter tests.
4. Performance: 10k, 100k and 1m feature fixtures; record actual memory, load time and render FPS, not aspirational numbers.
5. Public website integration as a replaceable thin viewer consuming normalized vector packages; GIS core must remain usable without web/network.
6. Offline reload, source license/attribution labels, missing feature fallback and stale-vintage notice.

## References (publisher documentation)
- Geofabrik https://download.geofabrik.de/asia/israel-and-palestine.html
- Overture quickstart https://docs.overturemaps.org/getting-data/
- Overture catalogs and schema https://docs.overturemaps.org/getting-data/cloud-sources/
- Overture repository https://github.com/OvertureMaps/data
- Overture AWS listing https://registry.opendata.aws/overture/
- Survey of Israel https://www.govmap.gov.il/sites/api/index.html
- Israeli open data https://data.gov.il/
- Wikidata query https://query.wikidata.org/
- UNESCO https://whc.unesco.org/en/list/
- OSM tagging https://wiki.openstreetmap.org/wiki/Key:building and https://wiki.openstreetmap.org/wiki/Key:historic

## Next Codex work order: ISR-BUILD-00
Inventory native branch sources and licensing obligations before changing core. Build repeatable sample extraction for Overture Buildings/Places/Addresses and Geofabrik OSM, store source manifest and validation outputs only (no bulk copyrighted/redistribution-restricted data in git). Capture deduplication and multilingual label fixtures. Draft UI screenshots and an integration contract for magog.institute; no production deployment, no migration of Pip Boy baseline. Log commands/versions, SHA, tests, source vintages and failures.
