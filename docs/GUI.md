# Standalone RB_GIS GUI (first native viewport)

Run `cargo run -p rb-gis-gui` from repository root. A resizable 480x320 native operator window opens; minimum dimensions 320x240. This is a deliberately empty reference grid, **not a fabricated map**. Manual-center input does not request or represent GPS. Pan by dragging; zoom by wheel or buttons; Reset restores unlocated grid. No network access, telemetry, saved location, or Pip Boy dependency.

Native geometry and offline county/GeoJSON layers are pending. Imported Pip Boy assets in `migration/pip-boy/` are preserved for behavioral parity only. The GUI is currently an exploratory development shell, not a full-featured map. Hardware performance and CI build still require verification.

## Native local layer import
Enter an explicit local GeoJSON file path and choose **Open local file**. Points, line segments and polygon outlines render in the viewport. Accepted input is bounded to 2 MiB, 2,000 features and 30,000 vertices. Files are read only on the operator's explicit action. The project does not yet ship a file chooser, map package downloader, fill renderer or native county cache. Rendering and build are awaiting native runtime verification.

## Fit layer (M1)
The **Fit layer** action computes a native Web Mercator view from the currently loaded geometry, including shortest-arc longitude wrapping across the antimeridian. It does not change a manual center into a GPS fix. The current GUI fits to a nominal 480x240 map canvas; adapting the fit target to the exact dynamic panel dimensions is the next usability step. This change is committed but has not been compile-tested due to unavailable network access in the build environment.

## Viewport fitting update (2026-10-28)
The Fit layer control now uses the most recently measured actual central map canvas size, rather than a fixed 480x240 assumption. After a resize, the next rendered frame updates this measurement. The algorithm retains antimeridian shortest-arc handling. **Not runtime-validated**.

## CI investigation
GitHub Actions runs for this branch report `startup_failure` and an empty jobs list. This occurs before Rust steps execute; verify repository Actions permissions/billing and workflow admission. In addition, source has not yet passed `cargo fmt --check`, Clippy, a native compile, or manual GUI smoke. No test green status is asserted.

## Layer visibility pass
The standalone window now provides separate Points, Lines and Areas visibility toggles, in addition to the reference grid toggle. These controls only affect rendering: the local imported geometry remains in memory and is not deleted. The status line distinguishes local GeoJSON geography from no loaded geography. These are generic geometry-type switches, **not yet** the dedicated Roads/Water/Landmarks/Boundary classification controls of Pip Boy. Compile and hardware validation remain pending.
