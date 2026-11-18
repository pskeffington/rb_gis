# Navigation engineering literature matrix

Reviewed: 2026-10-30. Scope: offline handheld GNSS navigation, Rust routing, GIS compatibility, and autonomous agent development. References are design evidence, not evidence of implementation in rb_gis.

| ID | Domain | Source | Finding | rb_gis decision | Verification |
|---|---|---|---|---|---|
| LIT-01 | Turn rules | https://wiki.openstreetmap.org/wiki/Turn_Restriction | Restrictions may use from/via/to relations; via may be a node or way; restrictions may be mode-specific. | Preserve original way IDs, relation members, mode applicability, and turn state. Fail closed for unresolved restrictions in driving routes. | Synthetic no-left, only-right, via-way and mode-specific fixtures |
| LIT-02 | Routing stages | https://valhalla.github.io/valhalla/concepts/ | Candidate edge search, graph traversal and downstream route generation are distinct stages. | Separate spatial candidate retrieval, graph search, and maneuver generation. | Tests at each boundary |
| LIT-03 | Dynamic costing | https://valhalla.github.io/valhalla/sif/dynamic-costing/ | User profiles adjust edge and turn costs at route time. | Define typed cost policy for foot, bicycle and car, without embedding policy in geometry. | Cross-profile route fixtures |
| LIT-04 | Map matching | https://valhalla.github.io/valhalla/api/map-matching/api-reference/ | Raw GPS traces may need candidate/path matching; match quality depends on accuracy and trace density. | Start with candidate scoring and hysteresis; introduce sequence matching only after recorded-trace tests. | Parallel road, tunnel, noisy-fix fixtures |
| LIT-05 | Route guidance | https://valhalla.github.io/valhalla/api/turn-by-turn/overview/ | Routing outputs route shape and stepwise instructions per travel mode. | Generate deterministic maneuver events from traversed edges and transitions. | Intersection-angle and roundabout fixtures |
| LIT-06 | GNSS interchange | https://gpsd.io/gpsd_json.html | TPV/SKY/DEVICE reports expose fixes and metadata; fields may be absent. | Adapter validates incomplete/stale/invalid input and represents unavailable values explicitly. | Missing-fix, stale timestamp and interrupted-stream tests |
| LIT-07 | Skills | https://learn.chatgpt.com/docs/build-skills | Reusable agent procedures use SKILL.md plus optional references/scripts, loaded progressively. | Keep procedures in repo-local .agents/skills; durable guardrails in AGENTS.md. | Skill frontmatter and referenced-path validation |
| LIT-08 | Codex project customization | https://learn.chatgpt.com/docs/customization/overview | AGENTS.md governs the repository; repo skills live in .agents/skills. | Keep instructions portable and non-destructive. | Verify entrypoints load in Codex |
| LIT-09 | Licensing | https://www.openstreetmap.org/copyright | OpenStreetMap data has attribution and licensing obligations. | Record dataset provenance, license, extract date and attribution in packaged datasets/UI. | Offline attribution visible |
| LIT-10 | Routing baseline | https://project-osrm.org/ | Mature road routing systems provide useful functional comparison. | Compare route shape and legal maneuvers against reference tools on licensed small fixtures; do not ship runtime dependency. | Discrepancy log and targeted regressions |

## Evidence grading
A = authoritative specification or primary project documentation. B = maintainer documentation or directly reproducible project source. C = third-party commentary. These entries are primary project or protocol documentation (A/B), not independent scientific performance benchmarks.

## Core pitfalls
- A rendered road crossing is not necessarily a navigable junction (bridges/layers).
- Shortest distance is not shortest travel time.
- Missing traffic and closure data must not be represented as current knowledge.
- A snapped location is an inference, not a guaranteed GPS location.
- Explicitly reject unsupported restrictions, regions, or travel profiles rather than silently inventing valid paths.
- Offline geocoding/address lookup is a separate capability; navigation to coordinates can ship first.

## Open research questions
Determine minimum viable memory footprint for handheld graphs; benchmark compact adjacency representation versus compressed tiles; compare admissible A* heuristics; evaluate accuracy-aware reroute debounce; confirm local device adapter availability and licensing for region extracts. Record datasets, machine, toolchain, and measurement distributions for every performance claim.
