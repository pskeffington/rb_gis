---
name: offline-navigation
description: Engineer, test, review or plan offline Rust GIS road routing, GNSS navigation, map matching, turn guidance, road topology, or Rust Boy adapter work in rb_gis. Use for phased navigation tasks and literature-backed implementation, not generic map styling.
---

# Offline navigation engineering

1. Read repository AGENTS.md, docs/navigation/ROADMAP.md and docs/navigation/LITERATURE_MATRIX.md before edits.
2. Inventory actual code and fixtures. Do not equate proposed architecture with implemented software.
3. Choose first unblocked NAV task, and write its acceptance assertions before modifying code.
4. Protect existing map road/boundary/loading behavior. Do not remove legacy paths without demonstrated parity and rollback.
5. For route topology preserve directed travel, physical crossing levels, access modes, restriction relations and way provenance. For missing policy fail explicitly, especially for driving.
6. For algorithms use Dijkstra as a reference and test A* admissibility/optimality, including disconnected graph and no-path cases.
7. For GNSS treat missing/stale/low-confidence fixes explicitly; replay synthetic traces before hardware tests.
8. Avoid network and location collection by default. Record real dataset license, coverage, age, hash and attribution.
9. Keep computation within rb_gis, the Rust Boy shell behind a versioned module adapter.
10. Run existing tests and targeted new tests; record exact outputs and environments. If tools or datasets are unavailable mark blocked.
11. Update navigation documentation and task state with a concise evidence ledger. Never declare release-ready on unit tests alone.

Read the specific literature row linked to each feature rather than loading the whole literature corpus repeatedly. Do not advance a blocked acceptance gate.
