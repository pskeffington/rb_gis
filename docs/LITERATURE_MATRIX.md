# RB_GIS literature / engineering decision matrix (2026-10-28)
Status vocabulary: candidate | reference | selected | deferred; these are design assessments, not benchmark outcomes.

| ID | Work / canonical resource | Applicability | Status | Tradeoff / validation |
| --- | --- | --- | --- | --- |
| GIS-001 | RustGIS architecture https://rustgis.app/architecture/ | Layered geometry/data/tiles/render, interchange | reference | Larger engine; do not assume embedded Pi performance or copy source |
| GIS-002 | geo / geo-types https://github.com/georust/geo | Rust geometry model and algorithms | candidate | Measure binary size and feature footprint |
| GIS-003 | geozero https://github.com/georust/geozero | Streaming geospatial formats | candidate | Validate bounds, malformed inputs and supported geometry |
| GIS-004 | tiny-skia https://github.com/linebender/tiny-skia | Software fallback rendering without GPU | candidate | Benchmark label and polyline density on Pi |
| GIS-005 | MapLibre Native Rust https://github.com/maplibre/maplibre-native-rs | Rich vector rendering | deferred | Native build chain and footprint may exceed micro-display budget |
| GIS-006 | maplibre-rs https://maplibre.org/maplibre-rs/docs/api/maplibre/ | Rust/WebGPU renderer | deferred | Verify API maturity and minimal device GPU |
| GIS-007 | PMTiles https://docs.protomaps.com/pmtiles/ | Single-file offline tiled storage | candidate | Cache integrity, seek/read amplification, offline licensing |
| GIS-008 | MBTiles https://github.com/mapbox/mbtiles-spec | SQLite tile package interchange | candidate | SQLite footprint and atomic cache updates |
| GIS-009 | RFC 7946 https://www.rfc-editor.org/rfc/rfc7946 | GeoJSON lon/lat interoperability | selected | Geometry collection/depth budgets and antimeridian |
| GIS-010 | WGS 84 https://earth-info.nga.mil/ | Location CRS/datum conventions | reference | Avoid silent NAD83 -> WGS84 survey-grade claims |
| GIS-011 | NMEA 0183 https://www.nmea.org/ | External GNSS serial interchange | candidate | Parse only bounded sentences, validate checksum/timestamp |
| GIS-012 | USGS GPS guidance https://water.usgs.gov/osw/gps/ | Accuracy and handheld mapping limits | reference | Display uncertainty; do not claim survey-grade GPS |
| GIS-013 | U.S. Census TIGER/Line https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html | Opt-in local county reference packages | candidate | Legal boundary, ZCTA and source vintage semantics |
| GIS-014 | OSM copyright/license https://www.openstreetmap.org/copyright | Optional OSM geography and attribution | candidate | User-approved requests, provider usage policy, update semantics |
| GIS-015 | GPX 1.1 https://www.topografix.com/gpx.asp | Waypoint/track interchange | candidate | Privacy, extension preservation, timestamp interpretation |

## Recommendation
Build a pure Rust core and small CPU-renderer first. Treat a richer GPU renderer as an optional adapter, not the base dependency. Keep import, GPS acquisition, local cache and HTTP transport behind separate feature boundaries. Validate upstream library licensing and current release APIs before implementation.
