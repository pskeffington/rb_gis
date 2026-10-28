# RB_GIS repository index

**Canonical machine entrypoint:** [catalog/index.json](../catalog/index.json)  
**Component manifest:** [catalog/components.json](../catalog/components.json)  
**Gate tracking:** [catalog/gates.json](../catalog/gates.json)

## Read order for maintainers and coding agents
1. [README](../README.md) — product boundary and getting started
2. [Migration plan](MIGRATION.md) — ownership, portability and acceptance gates
3. [Component inventory](../catalog/components.json) — verified paths and implementation maturity
4. [Literature matrix](LITERATURE_MATRIX.md) — research references and design tradeoffs
5. [Gate ledger](../catalog/gates.json) — criteria for promotion to production

## Code boundaries
- `crates/rb-gis-core/`: native, independently owned Rust library. Only actual workspace member.
- `migration/pip-boy/`: **archived working-source copies** from Pip Boy. Not part of the RB_GIS runtime. Must not be assumed compiled, linked or regression-tested.
- `catalog/`: machine-readable indexes and planned quality gates.
- `docs/`: design authority and operator restrictions.
- `.github/workflows/ci.yml`: preliminary native Rust CI, no migrated JavaScript suite yet.

## Migration ownership
RB_GIS will own all GIS mechanics including local map data, feature/layer management, viewport projection, coordinate handling, map cache and receiver adapters. Pip Boy retains its one-module display, common Settings UI, permission prompts and package lifecycle. Pip Boy maps remain in place until RB_GIS reaches G5.

## Indexed status and gaps
The imported code is a frozen starting reference, not a complete native Rust migration. Seven legacy CommonJS test files were copied, but their host dependencies and execution status have **not** been verified. Four RustGIS-related CommonJS tests and two Python audit scripts are still missing from the migration copy. No native map renderer, county cache or hardware GNSS backend is currently implemented in the RB_GIS workspace.

## Index maintenance contract
- Update component statuses only with linked commits and validation evidence.
- New modules must be added to `catalog/components.json` with owner gate and source path.
- Never represent a browser geolocation/manual center as an actual receiver fix.
- Keep offline source attribution and data provenance.
- Keep `catalog/index.json` aligned with actual repository contents, not aspirational structure.
- No location network calls without user authorization.
