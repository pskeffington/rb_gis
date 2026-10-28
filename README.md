# RB_GIS

Offline-first, compact GIS module extracted from [Pip Boy](https://github.com/pskeffington/pip_boy). Designed as an independent Rust library for handheld, desktop, and embedded hosts.

**Status: early migration.** A small native Rust core is scaffolded. The established Pip Boy mapping source is preserved under `migration/pip-boy/` but has **not** yet been converted into a native portable renderer.

## Start here
- [Repository navigation and machine index](docs/INDEX.md)
- [Major milestone roadmap](docs/MAJOR_ROADMAP.md)
- [Migration plan and responsibilities](docs/MIGRATION.md)
- [Geospatial literature and best-practices matrix](docs/LITERATURE_MATRIX.md)
- [Machine component inventory](catalog/components.json)
- [Machine gate ledger](catalog/gates.json)

## Rust validation

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Tests must be run before claiming a passing build. No network, user-position collection, receiver I/O or background telemetry is performed by the current native core.

## Integration boundary
RB_GIS owns GIS mechanics; Pip Boy owns host navigation, Settings and operator authorization. Do not delete the Pip Boy implementation before verified feature parity and a host adapter.
