# Standalone RB_GIS GUI (first native viewport)

Run `cargo run -p rb-gis-gui` from repository root. A resizable 480x320 native operator window opens; minimum dimensions 320x240. This is a deliberately empty reference grid, **not a fabricated map**. Manual-center input does not request or represent GPS. Pan by dragging; zoom by wheel or buttons; Reset restores unlocated grid. No network access, telemetry, saved location, or Pip Boy dependency.

Native geometry and offline county/GeoJSON layers are pending. Imported Pip Boy assets in `migration/pip-boy/` are preserved for behavioral parity only. The GUI is currently an exploratory development shell, not a full-featured map. Hardware performance and CI build still require verification.

## Native local layer import
Enter an explicit local GeoJSON file path and choose **Open local file**. Points, line segments and polygon outlines render in the viewport. Accepted input is bounded to 2 MiB, 2,000 features and 30,000 vertices. Files are read only on the operator's explicit action. The project does not yet ship a file chooser, map package downloader, fill renderer or native county cache. Rendering and build are awaiting native runtime verification.
