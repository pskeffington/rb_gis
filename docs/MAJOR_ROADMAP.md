# RB_GIS Major Roadmap — 2026-10-28
Status: planning baseline; implementation evidence must be verified separately.

## Product contract
RB_GIS is a standalone offline-first Rust mapping application and reusable GIS library. It must launch with a truthful empty reference grid, accept an explicitly selected local geographic package, and render without Rust Boy. Rust Boy owns navigation, Settings, host authorization and package switching; RB_GIS owns map data, viewport, layers, rendering and GNSS session mechanics.

## Milestone sequence

### M0 — Repair and CI (blocker)
- Pin/resolve lockfile; compile on macOS and Linux; check MSRV and dependency safety.
- Run cargo fmt, cargo test, cargo clippy (warnings denied).
- Verify GUI launches and snapshot 320x240 / 480x320 without blank viewport.
- Add headless geometry render testing independent of a display server.
Exit: green CI and at least one documented manual GUI smoke. Do not mark complete on source-code presence.

### M1 — Native GIS geometry and display
- Add bounded geometry collections as needed; enforce limits on nested arrays and decompression; review GeoJSON RFC 7946 semantics including rings, holes, antimeridian and alternate-coordinate rejection.
- Correct world wrap, viewport clipping, drag behavior, cursor-anchored zoom, Fit to Layer.
- Render filled polygons with holes, road/path line weights, point symbols, labels and explicit layer order.
- Add layer toggles with on/off/unavailable status and geographic source provenance.
Exit: synthetic fixtures test point/line/polygon/hole, dateline and bounds at both display sizes.

### M2 — Offline geographic packages
- Split parser, data/catalog, cache, rendering crates only when boundaries justify maintenance.
- Import county road, areal/linear water, county border, in-county landmark data from known source archives, preserving source vintage and attribution.
- Add bounded archives, path traversal protections, atomic updates, checksums and cache index.
- Keep the last verified map if replacement download/import fails.
- Optional PMTiles/MBTiles adapters after licensing, memory and random-access profiling.
Exit: cold offline restart displays real sourced local geography; unavailable sources are visibly unavailable.

### M3 — GNSS and accuracy
- Formal receiver trait supporting manual centers, browser bridge, NMEA serial and optional OS location sources.
- Explicit operator start/stop; freshness, timestamp monotonicity, accuracy and permission-failure states.
- No location persistence or network sharing by default; GPS loss never moves camera to guessed center.
- Follow/recenter is opt-in and terminates when session stops.
Exit: deterministic fake receiver tests, denied/no-fix/stale/poor accuracy and physical receiver smoke.

### M4 — Self-contained field GUI
- Independent menus: MAP, LAYERS, SOURCES, GPS, SETTINGS; short labels for 320x240.
- Touch and keyboard navigation; accessible focus, high contrast, screen reader labels where supported.
- Source browser and package management without requiring Rust Boy.
- Single active map instance; no forced network startup or simulated geography.
Exit: GUI operates independently on desktop and small display with no hidden host dependencies.

### M5 — Host integration
- Provide stable rb-gis-core API and bounded host IPC/command contract, not duplicated JS.
- Standalone executable remains official dev harness. Pip Boy invokes or embeds RB_GIS through a thin adapter.
- Compare legacy Pip Boy map tests and golden fixtures before switching default.
- Disable/delete source duplicates only after audited parity and rollback.
Exit: Pip Boy MAP tab uses RB_GIS and standalone executable continues to work.

### M6 — Field portability and hardening
- macOS desktop, Linux x86_64 and actual aarch64 Raspberry Pi smoke.
- Measure cold start, p50/p95 frame time, peak RSS, offline map import, throttling, power and suspend/resume.
- Security: malicious archives, parser fuzzing, memory caps, no unexpected requests.
- Device-specific touch size and input accuracy tests.
Exit: signed/reproducible artifacts or documented reproducible build; hardware evidence attached.

### M7 — Optional interoperability
- GPX tracks, GeoJSON export, planned route measurements and offline spatial indexing.
- Optional map packages, navigation overlays, and explicit network reference sources.
- TAK/CoT, radio status or mesh position sharing only as separate consented, authenticated plugins.
Exit: each optional adapter tested without changing offline baseline.

## Release gates
- v0.2: M0–M1, real local GeoJSON renderer and independent GUI.
- v0.3: M2, verified offline real geography and cache.
- v0.4: M3–M4, handheld GPS + self-contained field controls.
- v0.5: M5, Rust Boy consumes RB_GIS without owning GIS logic.
- v1.0 candidate: M6, actual device validation and failure-mode acceptance.

## Guardrails
No fabricated GPS or basemap. No silent network or persistent track collection. Existing Pip Boy remains the production source until parity. Imported migration source is historical reference, not part of compiled library. RustGIS external repository remains read-only.
