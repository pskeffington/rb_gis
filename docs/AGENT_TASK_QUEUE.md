# RB_GIS actionable agent queue — 2026-10-30
State of queue: documented assignments, not evidence of execution.

| Priority | ID | Assignment / deliverable | Dependencies | Acceptance |
| --- | --- | --- | --- | --- |
| P0 | RB-00 | Confirm checkout is navigation-on-native branch; log ref/HEAD and file inventory; verify intended worktree | none | AGENTS, Cargo workspace, native sources, kickoff all present |
| P0 | RB-01 | Run fmt/check/test/clippy and GUI smoke, record errors and runner details; do not rewrite CI speculatively | RB-00 | reproducible evidence or explicit BLOCKED |
| P0 | RB-02 | Reconcile legacy county roads/water/bounds/ZIP service with native source coverage; produce parity matrix and missing-file map | RB-00 | each preserved behavior mapped to tested native path or GAP |
| P0 | WF-00 / AG-001 | Inventory original graph-ready road data and realistic foot access tags versus merely drawable roads | RB-02 | provenance, path/hash and access coverage explicit |
| P1 | RB-03 | Extract bounded native Census archive loader with atomic local caching and provenance, retaining old Pip Boy MAP | RB-01, RB-02 | regression fixtures plus cold offline restart |
| P1 | WF-01 / AG-003 | Versioned pedestrian/access and hydrographic importer; conservative unknown access handling | WF-00 | malformed/unsafe inputs rejected, foot/water never conflated |
| P1 | WF-02 / AG-004 | Deterministic directed walking topology, bridge/grade separation | WF-01 | crossing, access and disconnected fixtures |
| P1 | WF-03 / AG-005 | Dijkstra oracle and deterministic A* with admissible documented lower bound | WF-02 | identical optimal cost and stable tie resolution |
| P2 | WF-04 | Continuous coast/river reference index (5 km river default, configurable), metric distances | WF-01 | 4999/5000/5001 m and disconnected reach tests |
| P2 | WF-05 | Walkable waterfront preference scoring (250 m radius, <=20% discount defaults) | WF-03, WF-04 | safe access, detour and inland fallback fixtures |
| P2 | WF-06 | Typed route response, warnings, route availability and data vintage | WF-05 | no-route vs coverage-gap distinguished |
| P2 | WF-07 | Optional consented offline GNSS replay and route-progress hysteresis | WF-06 | invalid/stale fix tests |
| P3 | RB-04 / WF-08 | Standalone route overlay and versioned Rust Boy pop-in socket | RB-03, WF-07, parity gate | independent GUI and non-destructive integration smoke |
| P3 | RB-05 | Device, security, performance and release review | RB-04 | evidence on target hardware and rollback |

## Codex operating loop
1. Check branch and HEAD. STOP with BLOCKED if `Cargo.toml`, `AGENTS.md`, or kickoff are missing; name the right branch rather than inventing implementations.
2. Read `docs/INDEX.md`, `docs/STATUS_2026-10-30.md`, `docs/MAJOR_ROADMAP.md`, navigation roadmap/kickoff, legacy handoff and applicable skill.
3. Choose **one** unblocked queue item. For first pass choose RB-00 and RB-02/WF-00 documentation inventory; only then write routing code.
4. Write minimal synthetic failing test; implement scoped change; run available checks. Test failures and unavailable tools are separate statuses.
5. Update parity matrix, fixture manifest, docs and `catalog/gates.json` only when supported by evidence.
6. Commit focused change to feature branch, report ref/SHA, changed files, exact commands/tests, observed results, blockers and next unblocked task. Never automatically promote or delete legacy source.

## Safety and invariants
Offline by default; local data ingestion only on explicit operator action. Never synthesize live GPS position, an accessible river crossing, public shoreline access or a complete basemap from absent data. No external RustGIS checkout or `pip_boy` runtime dependency. Do not merge branches or promote to production automatically. Protect existing map loading until audited parity and maintain standalone launchability.

## Phase crosswalk
- **M0–M2** native verification/ingestion, **NAV-00** inventory, **WF-00–01** foundation.
- **NAV-01–02** route graph/engine, **WF-02–06** algorithm and water preference.
- **M3–M4, NAV-03–05**, **WF-07** GNSS, progress, safe offline UX.
- **M5, NAV-06, WF-08** versioned shell socket and standalone integration.
- **M6–M7, NAV-07** device, safety, release gates and optional interoperability.
Do not count a task completed in one stream as proof another gate has passed.
