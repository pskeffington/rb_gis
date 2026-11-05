# ISR-LINE-00 — permanent historical reference-line overlay

Scope: magog.institute Israel built-environment demo. Status: catalog committed; runtime importer/render integration NOT IMPLEMENTED and NOT TESTED.

## Distinguish three independent historical lines
1. **UN General Assembly Resolution 181 (II), 29 Nov 1947**: proposed partition borders (not the 1949 Armistice Line). Proposed Jewish and Arab state areas and a distinct proposed Jerusalem international zone. Source: UN map 3067 Rev.1 and annex map 103.1(b), https://www.un.org/unispal/document/auto-insert-208958/ and https://www.un.org/unispal/document/auto-insert-204145/.
2. **1949 Armistice Demarcation Line**: also known as the Green Line; does not equal 1947 plan. Source vector candidate: OCHA FeatureServer https://gis.unocha.org/server/rest/services/Hosted/1949_Armistice_Green_Line/FeatureServer/0 (WGS84, Polyline, supports GeoJSON).
3. **1947 Jerusalem corpus separatum**: proposed special international area; source UN annex B map https://www.un.org/unispal/document/auto-insert-209955/.

## Config contract
`config/israel_historical_boundary_catalog.json` pins IDs, period labels, colors, dash patterns, source URLs, and explicit UNVERIFIED geometry status. **No coordinates have been fabricated or declared verified.** Do not use simplified bounding rectangles or manually approximate the historic lines. The word `hard-code` means ship frozen, source-validated, checksummed historical GeoJSON geometry and fixed legend metadata with the app, not put invented coordinates in UI code.

## Data-build steps
- Acquire vector representations of the three boundaries; compare UN181 third-party vector candidate against UN cartography and Resolution 181 text. Record scale, revision, lineage, coordinate transforms and geometry uncertainty. OCHA 1949 vector is a distinct dataset, not a substitute for UN181.
- Reproject and normalize to GeoJSON [lon,lat] and version artifacts with SHA256 and licensing/attribution review.
- Split into bounded files fitting native `rb-gis-core` package caps. Add a dedicated historical boundary type / style mapping without disturbing existing layer enums or renderer behavior.
- Render historical reference lines only after allowed-area clipping. Excluded Gaza and entire West Bank (including East Jerusalem) remain blank, with **no reference-line fragments inside**; mask wins over all layers and labels. Public display of portions of UN181 or Green Line is limited to areas allowed by this exclusion. Consider explicit legend text `Reference lines cropped to available map coverage`.
- Do not infer property ownership, settlement legality, or individual occupancy from a side-of-line test. Polygon/boundary ambiguity and disputed historical claims must remain identified and unclassified.
- Ship toggle controls for each vintage with default OFF, and keep data attribution next to legend.

## Acceptance
Tests must verify no line content in excluded regions at all zoom levels, all caches, screenshots, search/export, and direct tiles; verified feature hashes and no fabricated coordinate claims; clear differentiation of all three line types and date labels. Until source validation, show `Boundary reference unavailable`, not an inaccurate approximation.

## Codex handoff
Implement in isolated branch based on verified native GIS source checkout, after exclusion-mask acceptance. Attach actual fixture files, geometry audits, CI commands/output and screenshots before upgrading catalog fields from `SOURCE_GEOMETRY_NOT_VERIFIED` to valid data. Keep Pip Boy baseline untouched.
