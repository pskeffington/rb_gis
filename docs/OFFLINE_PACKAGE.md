# RB_GIS offline directory package v1

Machine schema: [catalog/package_schema.json](../catalog/package_schema.json).

A directory contains a JSON manifest and one or more local .geojson files. Every path in the manifest must be a single filename inside the manifest's directory: no path traversal, nested paths, network locations or symlink escapes. Every layer carries an explicit declared source, vintage (optional), and attribution.

Example manifest:

    {
      "schema": "rb-gis-package/v1",
      "layers": [
        {
          "file": "roads.geojson",
          "name": "County roads",
          "role": "roads",
          "source": "Declared source (operator-supplied)",
          "vintage": "2025",
          "attribution": "Source copyright/license credit"
        },
        {
          "file": "boundary.geojson",
          "name": "County boundary",
          "role": "boundary",
          "source": "Declared source (operator-supplied)",
          "attribution": "Source copyright/license credit"
        }
      ]
    }

Supported roles: roads, water, boundary, landmarks, other.

**Trust policy:** the source declaration is shown verbatim after validation, but does not establish authenticity. This directory format is not currently the U.S. Census TIGER ZIP/DBF/SHP format and does not claim to replace the original Pip Boy county-loader or establish survey-grade datum transforms.

**Atomic swap:** all layers must pass path and geometry validation before the old map is replaced. If a read fails or input exceeds bounds, the existing active layer set is preserved. The parser never requests GPS or network resources. Missing attribution is rejected.

**Resource limits:** 12 files; each GeoJSON file at most 2 MiB / 2,000 expanded features / 30,000 vertices; combined at most 8,000 features and 120,000 vertices; manifest at most 64 KiB. Offline data must be explicitly supplied by the operator. An integrity-verified cache, signed manifest, Census archive reader, and cold-start remembered map state are pending M2.

Regression fixtures: [fixtures/synthetic-package](../fixtures/synthetic-package). These contain artificial coordinates and clearly marked source fields for non-navigation tests only.

## Next compatibility conversion

The original Pip Boy local Rust service exposes /api/map/package with allowlisted Census archive names, /api/map/boundary for validated county boundaries, and /api/map/zip for the 2020 ZCTA relationship. Port the local Census cache and SHP/DBF/ZIP readers into RB_GIS as a separate backend crate, then provide a one-time export to this package format. Preserve source license/vintage, enforce actual county clipping for state-level point landmarks, and ensure raw position is never sent to the county-package service.
