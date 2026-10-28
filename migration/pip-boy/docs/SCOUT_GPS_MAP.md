# Rust-Boy | Location-driven MAP and RustGIS interchange

Rust-Boy's MAP is an **offline-first field reference viewer**. The Fallout-inspired phosphor display is a rendering style; the geography comes from real, identified source records. No city, roadway, landmark, or GPS position is invented or preselected. The first MAP screen is an **unlocated reference grid**, not a demonstration region. No external provider is contacted on MAP entry.

All location ingestion, Layers, imports and map control buttons live under universal **Settings → Location / Map**. Accepted area/geometry survives tab changes; an explicitly enabled GPS session resumes only while Map/location settings is visible. Live fixes are cleared on exit and never restored as current.

## First-run operator sequence

1. Open **Settings → Location / Map**. It starts with `CENTER UNSET / GRID ONLY` unless the local device has an earlier county ZIP cache or the current browser session already holds an imported layer.
2. In Settings, press **GPS ON** to request browser location, or **CENTER** to provide WGS84 latitude and longitude manually. The manually entered point is never represented as a GPS reading. A saved GPS fix is not written to Rust-Boy storage; GPS watches stop on MAP exit.
3. GPS ON or manual **LOAD AREA** explicitly permits location-to-county lookup with U.S. Census TIGERweb. That provider receives the *chosen* location. If the operator set a manual center, it takes precedence over a currently available GPS fix.
4. The resolved county GEOID is passed to the **local** allowlisted Census package service. No raw position is passed to the package service, which retrieves **2025 All Roads**, **Areal Water**, and **Linear Water** records for the selected county. The viewer displays genuine centerlines, polygons, names, classifications and source vintage. A fourth source, state-level **Point Landmarks**, is shown **only after the returned points have been clipped to the verified county polygon**.
5. Open **MAP** for the full geographic viewport, without buttons or setup rows. Pan by dragging and zoom with wheel gestures; **FIT**, **RECENTER** and zoom buttons are available under Settings → Location / Map. Use **FIT** to frame available geography and **+/-** to zoom. Finger drag pans and disables follow. **RECENTER** returns to the live browser fix when one is available. Roads, water and landmark symbols use Rust-Boy's green/amber phosphor style, without fictional geometries.

The 480×320 primary bar contains GPS, FOLLOW/RECENTER, CENTER, **ZIP**, COUNTY, FIT and zoom. Census visibility toggles are grouped beneath the collapsed **LAYERS** disclosure. Secondary **RUSTGIS**, **SITES**, **WEB**, and **GIS** actions are under **TOOLS / MAP SOURCES**. Controls are designed for finger access and keyboard focus, but final physical touchscreen acceptance remains outstanding.

## ZIP → County GIS and reverse county ZIP lookup

Press **ZIP**, enter five digits and choose **FIND COUNTY**. Rust-Boy consults the locally cached U.S. Census 2020 ZCTA-to-county relationship index (downloaded from a fixed Census URL on the first explicit request), then loads **2025 county GIS** by validated county GEOID. One matching county proceeds directly; where a ZCTA intersects several counties, the operator must choose. Open ZIP → **COUNTY ZIPs** after selecting a county to view its associated ZCTA areas in pages of 12. The current county GIS remains available if a new ZIP does not resolve or fails to load.

ZIP codes, Census ZCTAs, USPS postal towns and legal county boundaries are not equivalent. The ZIP input is **not a GPS fix**, and Rust-Boy uses a verified county boundary as the map frame, not a guessed ZIP centroid. ZIP requests go only to the loopback Rust server; the remote Census lookup downloads a **national static crosswalk**, never the entered ZIP or coordinates. See the [bidirectional ZIP/County source and limitations](ZIP_COUNTY_LOOKUP.md).

## Offline layer controls and field rendering

On the 480×320 display, expand **LAYERS / 4 OF 4 VISIBLE** (initially closed). Four 38-pixel touch controls independently toggle **ROADS**, **WATER**, **LANDMARKS** and **BORDER**. Each control announces **ON/OFF** and its actual pressed state for keyboard/screen-reader use. **WATER** groups the official Census areal and linear waterways; **BORDER** affects only the verified Census county boundary. Imported RustGIS geometry, an explicitly activated OSM reference, and locally held Reclamation site markers are separate overlays and are not hidden by these Census-specific switches. A layer may be ON but unavailable when its source is not cached or validated.

These controls **only affect rendering**. OFF never deletes county ZIPs, stops GPS, requests new network access, changes county GEOID, or changes source attribution. FIT frames only enabled, already-loaded county features and otherwise falls back to the enabled county border or available imported GIS. Switch settings remain in volatile page memory between MAP tab visits; restarting the browser restores all four to ON. No location or layer preference is written to a server.

**Rendering performance:** On ingestion, Rust-Boy builds a conservative grid index from each validated Census feature's source envelope. The renderer selects nearby features rather than scanning an entire county for each pan/zoom. It limits index references and scans oversized features conservatively instead of dropping geometry. At overview zoom, minor roads and point landmarks are intentionally suppressed, while major roads and water remain. Full geometry is retained in memory/cache for zoom-in. When the view spans the antimeridian or most of the world, the renderer falls back to its full visibility checks, preserving wrapped geometry. Touch-motion redraws are coalesced to one animation frame; the center projection is reused for all vertices. Landmark labels take precedence over road names, with an explicit small-display collision budget.

**DATA SOURCES** continues to report all loaded source counts irrespective of layer visibility, and additionally reports enabled categories and viewport candidate/drawn counts. These are inspection diagnostics, not timing benchmarks or guarantees of Raspberry Pi frame rate.

## What data is acquired?

See [County source catalog and acquisition contract](COUNTY_SOURCES.md) for exact 2025 archive paths, geographic scope, safety limits, and validation. U.S. Census TIGER/Line features are **reference GIS**, not a live road-condition feed or certified nautical map. TIGER raw geographic coordinates use NAD83, displayed without a formal datum transformation; high-accuracy survey or coastal navigation requires a suitable independently validated data source.

**Area roads and water** are cached on the local device as their original ZIPs. The native Rust host also caches the separately fetched county boundary as raw TIGERweb GeoJSON, after strict GEOID and geometry validation. Re-entering MAP can decode the most recently selected cached county without geolocation or remote requests. Loading the same county again reuses its archives. A failed replacement does not remove previously verified map geometry. Source status distinguishes fully loaded layers, partial coverage and absent optional layers.

**Point landmarks** are published by Census as a **state-level** archive, not as a county ZIP. Rust-Boy downloads the allowlisted state archive under a county-specific local cache key, parses actual POINT records, and filters them with the Census county polygon. The Rust host now independently fetches and stores the verified GEOID polygon so those in-county points can be restored after a cold offline restart. If the polygon is not cached or fails validation, state points stay hidden; bounding boxes and guessed membership are never county verification. Landmark names and classes come from source attributes, not inference. No facility's operating status is implied.

**WEB ON** is an independent, explicit option for OpenStreetMap/Overpass reference layers (amenities, paths, buildings, parks and other mapped objects). The user-selected viewport is sent to the provider; OSM is community-maintained, **not the U.S. Census or an authoritative substitute**. No automatic OSM fallback occurs when Census downloads fail. WEB OFF keeps the last fetched reference in browser memory but stops further network fetches.

## RustGIS local interchange

Open **TOOLS / MAP SOURCES → RUSTGIS** and select `.rgismap`, `.rgis`, `.rgislyr`, `.rgismpk`, `.rgispkg`, or GeoJSON. RustGIS map/project formats preserve supported embedded WGS84 vector layers, project camera, layer visibility, basic symbology, source labels and warnings. RustGIS external data links, raster tiles and PostGIS/GeoPackage dependencies are not magically downloaded; export embedded vector geometry for portable operation.

The displayed **DATA SOURCES** view exposes dataset names, source origin, feature counts, datum, vintage, partial-source restrictions and OSM attribution. The source's agency is the authority for the data; RustGIS itself is a GIS authoring tool, not a data provenance authority. Import failures leave last-good geometry on screen.

## Failure cases / field limitations

- **GPS denied/unsupported:** use manual CENTER; GPS HELP identifies the browser permission, OS Location Services, secure-origin and location-provider checks. Coordinates typed by hand are labeled manual.
- **No connection:** locally cached county boundaries, roads/water, clipped landmarks and imported RustGIS continue to work. A landmark layer remains hidden if its boundary cache is missing. A fresh area requires connectivity or a user-supplied offline GIS package.
- **County lookup failure or oversized dataset:** previous map remains visible; the status reports an unavailable or partial source rather than silently replacing it with a grid.
- **Local landmarks without a verified county polygon:** no landmark symbols are rendered, even from a cached state ZIP.
- **Privacy:** geolocation requires direct user action; no background GPS tracking, web provider ping or external map-area request on MAP entry. COUNTY and WEB use separate explicit consent. Local Reclamation site positions are not exposed to Census or Overpass.
- **Navigation:** this is cartographic situational awareness, not a road-routing engine, surveyed shoreline product, emergency navigation certification or full native RustGIS renderer.

### Verification

**Offline cache audit:** After acquiring a county by explicit operator action, run `bash scripts/test-map-macos.command --audit-cache`. This invokes the native Rust cache-only API, checks county boundary and stored ZIP CRC/structure without network, and reports complete/partial/corrupt state. See [Mac MAP test procedure](MAC_MAP_TESTING.md#audit-the-real-saved-county-without-a-network-connection). 

**Active test target is the Mac**, using the native Rust `pipboy` service and a local browser. Run `bash scripts/test-map-macos.command --verify`, then `--launch` and follow the [Mac MAP acceptance checklist](MAC_MAP_TESTING.md). The separate Mac test home deliberately preserves the downloaded county cache between restarts. The DATA SOURCES panel now records bounded local-only canvas draw timing (last and rolling p95) and a separate source-delivery duration; these are not FPS measurements. Physical Pi hardware acceptance is deferred.


`node tools/test_map_boot.cjs`, `node tools/test_map_layers.cjs`, `node tools/test_map_viewport.cjs` (headless Chromium), `node tools/test_county_sources.cjs`, `node tools/test_pointlm_ingestion.cjs`, `node tools/test_map_gps_permissions.cjs`, `node tools/test_county_map.cjs`, and Rust/Cargo CI check unattended boot behavior, allowlisted acquisition, clipping, no network fallback, source controls, and offline restoration. Real Census endpoint, Raspberry Pi GNSS and 480×320 physical touchscreen acceptance remain separate gates.
