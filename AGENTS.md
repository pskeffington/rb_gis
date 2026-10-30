# rb_gis agent instructions

rb_gis is the independently deployable Rust GIS and navigation package. The Rust Boy 2000 shell is a consumer, not the owner of GIS logic.

## Operating guardrails
1. Read README.md and docs/navigation/ROADMAP.md before touching navigation. The roadmap is a plan, not proof of implementation.
2. Start with NAV-00 inventory. Do not assume road/boundary loading is present: trace actual files and tested code paths, record missing migration pieces.
3. Never remove existing road, boundary, map, GUI, or offline loading behavior until parity is demonstrated using tests and reference outputs.
4. Keep navigation local and offline by default. No location acquisition or network activity without explicit user consent. Never transmit raw GNSS traces by default.
5. Implement all core routing and graph logic in rb_gis. Do not depend on the pip_boy repository at build or runtime; integrate through a documented versioned adapter.
6. Use deterministic synthetic datasets first. Respect OSM attribution, provenance, redistribution and licensing requirements for real extracts.
7. Keep correctness ahead of speed. Respect direction, bridges/layers, road access, restrictions and profile specificity. Unsupported features must fail explicitly.
8. Cargo fmt/check/test/clippy and focused fixtures are required where a Rust workspace exists; report actual commands and exact failures. Do not claim a successful build without execution.
9. Maintain docs/navigation/LITERATURE_MATRIX.md for new architectural decisions and cite primary sources.
10. One phase/task per reviewable change, keep feature flags off until passing gates. Mark blocked work BLOCKED; do not bypass CI or forge field acceptance.
11. Before committing, inspect diff for unrelated repository changes. Never modify upstream RustGIS or unrelated projects during rb_gis work.
12. Report changed paths, commands, test counts, evidence, remaining risks, and next unblocked task.

## Navigation workflow skill
For navigation planning/implementation, load .agents/skills/offline-navigation/SKILL.md and only the relevant references.

## First actionable task
AG-001: inventory current repository structures and the known old road/boundary/zone loader; create a file-level parity matrix before writing a routing engine.
