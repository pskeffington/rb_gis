# rb_gis navigation phased roadmap

Status: planned, not implemented or production-approved by this document. rb_gis owns all navigation core logic; pip_boy is a host shell only. Preserve the existing map module until parity evidence exists.

## NAV-00 inventory and baseline — FIRST
- Inventory repository tree, Cargo workspace, implemented road/boundary loader, renderer, GUI, test suites and Rust Boy interface. Record paths and SHA.
- Trace the prior road/boundary/zone loading path and determine whether it is present, partially migrated, or missing.
- Freeze sample reference map renders and startup/memory/load-time baselines.
- Define navigation feature flags OFF by default.
**Gate:** evidence-backed inventory, original renderer tests green, no lost capabilities.

## NAV-01 topology compiler
- Import local OSM-format road geometry and routing tags through a versioned, explicit dataset contract.
- Split ways at actual routable intersections; honor bridge/tunnel/layer, access, oneway, and turn-restriction relations.
- Produce deterministic directed nodes/edges and provenance metadata. Reject malformed or unsupported data with actionable errors.
**Gate:** synthetic topology, one-way, bridge, no-turn, restriction-via-way fixtures pass; no cross-layer false connections.

## NAV-02 deterministic routing core
- Implement Dijkstra as oracle and A* with admissible distance/time heuristic. Compare optimal cost and legal edge sequences.
- Route requests return geometry, distance, time estimate, confidence/limitations and explicit errors.
- Profiles: begin walking; enable cycling and driving only after complete access and turn-policy tests.
**Gate:** seeded property tests; disconnected graphs; no-path; zero-distance; repeated deterministic results; benchmark recorded.

## NAV-03 GPS and position
- Versioned GNSS adapter boundary (simulated input first; gpsd/NMEA or OS-specific providers only where available).
- Track timestamp, reported accuracy, fix validity, heading applicability, update age.
- Never automatically request network access or location without consent.
**Gate:** invalid/stale fixes cannot advance navigation; replayed traces work offline.

## NAV-04 map matching and guidance
- Candidate edge selection, route-progress projection, confidence thresholds, hysteresis.
- Maneuver generation and upcoming turn distances; no voice or accessibility-specific feature required to ship text guidance.
**Gate:** parallel roads, jitter, sharp turns, missing fixes and roundabout fixture coverage.

## NAV-05 rerouting/offline coverage
- Debounced deviation detection; only reroute when confidence supports it.
- Unsupported profile, missing tiles, disconnected graph, ambiguous match and failed route are visible statuses.
- Offline packages include attribution, source extract/version, integrity hash and coverage polygon.
**Gate:** zero-network simulated run, GNSS loss/recovery, out-of-coverage and corrupted-package tests.

## NAV-06 standalone micro GUI and Rust Boy socket
- Standalone rb_gis navigation view and keyboard/terminal commands; bounded memory and rendering work.
- Adapter passes typed commands/events, no reach-through imports or required pip_boy repository build.
- Existing map/road/boundary behavior parity verified before any deprecation.
**Gate:** standalone build, host adapter contract tests, macOS/Linux smoke tests where runners exist. Do not claim hardware field validation from emulator tests.

## NAV-07 readiness assessment (NOT automatic production)
- Release checklist: safety restrictions; road provenance and attribution; licensing; privacy; test corpus; performance; battery/thermal if real hardware exists; rollback and compatibility.
- No safety-critical navigation claim without field and platform validation.
**Gate:** explicit maintainer review and signed off acceptance evidence.

## Agent task queue
| Task | Phase | Output | Dependency |
|---|---|---|---|
| AG-001 | NAV-00 | Current architecture inventory and missing migration report | None |
| AG-002 | NAV-00 | Minimal fixtures and invariant test harness | AG-001 |
| AG-003 | NAV-01 | Topology importer and graph schema | AG-002 |
| AG-004 | NAV-01 | Mode/access and turn relation compiler | AG-003 |
| AG-005 | NAV-02 | Dijkstra oracle, A* and route response types | AG-004 |
| AG-006 | NAV-03 | GNSS adapter and replay fixtures | AG-002 |
| AG-007 | NAV-04 | Candidate matching and guidance | AG-005, AG-006 |
| AG-008 | NAV-05 | Offline packages, reroute and failure modes | AG-007 |
| AG-009 | NAV-06 | Standalone GUI and shell adapter | AG-008 |
| AG-010 | NAV-07 | Release evidence and rollback review | AG-009 |

## Operating rhythm
For each task: inventory -> test first -> smallest implementation -> cargo fmt/check/test/clippy where available -> document measured results -> commit focused diff -> update queue and gate. Missing tool or failing CI means BLOCKED with exact command/error. No fabricated pass status, automatic gate bypass, destructive migration, or silent external runtime dependency.
