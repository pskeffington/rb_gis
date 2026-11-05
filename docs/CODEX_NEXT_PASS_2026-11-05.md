# CODEX NEXT PASS — RB_GIS M1 recovery and parity

Status: instructions for a future Codex execution, not proof of execution.

## Starting point
1. Inspect `main`, `feat/native-gis-foundation`, `feat/navigation-guidance-on-native-gis`, `docs/navigation-literature-agent-roadmap`, and `codex/central-agent-doctrine-20261104`. Record HEAD and ancestry. Choose a branch containing Cargo workspace + AGENTS.md + source + navigation kickoff; create an isolated task branch off that ref. Do not implement from the minimal main tree.
2. Read `docs/DEVELOPMENT_ROADMAP_2026-11-05.md` and `docs/PROGRESS_2026-11-05.md` from main, along with native branch `docs/MAJOR_ROADMAP.md`, `docs/MIGRATION.md`, `docs/LEGACY_LOADER_HANDOFF.md`, `docs/AGENT_TASK_QUEUE.md`, `docs/navigation/ROADMAP.md`, `docs/navigation/CODEX_KICKOFF_ROAD_WATER_FOOT.md`, `AGENTS.md`, and `.agents/skills/offline-navigation/SKILL.md` where available.
3. Resolve central `agent_skills` roles and pin exact registry revision. If unavailable, label BLOCKED-AGENT and continue only safe read-only inventory.

## First work order: DEV-00 + DEV-03/WF-00
- Output `docs/migration/PARITY_MATRIX.md` with columns legacy feature, original path, new Rust path, data/provenance, fixture, status (PASS/PARTIAL/GAP/NOT RUN), and specific missing implementation.
- Trace roads, boundaries, water, ZIP/county acquisition, local package/cache, map styling, basemap fallback, viewport, and layering; identify the operational Census service rather than assuming reference files are live code.
- Check existing tests and fixtures. Do not delete, replace, or disable any legacy Pip Boy implementation.
- Record actual git SHA and Rust workspace inventory in evidence report.
- In a separate focused PR after inventory, attempt DEV-02 cargo gates and GUI smoke. If local GUI cannot launch, record accurate failure and headless follow-up rather than claiming a pass.
- Do not start WF-01 graph work until data provenance, access policy and baseline controls are understood.

## Review and handoff
Produce `docs/evidence/DEV-00_BASELINE.md` with machine, branch, checks run and results. Commit only scoped docs/tests or smallest verified fix; open draft PR and summarize unblocked follow-up. Any missing files must be called out with branch-specific paths, not invented. Preserve no-network/no-GPS-on-startup invariant.
