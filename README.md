# rb_gis
Rust_based mapping module for the rust_boy. It's pretty fast!
rust_boys independant mapping module,
If you want to drop it insomething smaller, go ahead!
it's super lightweight
One pull and you have the GIS for the local zone you are in !

## Rust-Boy integration target

This repo is the independent future implementation of Rust-Boy's MAP package. Its interface contract and migration acceptance gates are maintained in [Rust-Boy's package socket specification](https://github.com/pskeffington/pip_boy/blob/main/docs/PACKAGE_SOCKET.md). The manifest in Rust-Boy is a **design fixture**, not an installed or runnable adapter. GIS must remain useful outside the Rust-Boy shell; preserve offline behavior and require explicit consent for location/network acquisition. Existing in-host GIS must not be removed before tested parity.

## Development progress (2026-11-05)

See [progress and branch reconciliation](docs/PROGRESS_2026-11-05.md). Native core/GUI sources and navigation tasking are on feature branches, not yet established as merged or validated on main. Pip Boy retains the operational Census road/water/boundary and ZIP/county loader until parity is demonstrated. No standalone GUI, routing, or hardware acceptance is claimed from this documentation review.

## Next development pass

Follow the [gated development roadmap](docs/DEVELOPMENT_ROADMAP_2026-11-05.md) and [Codex M1 kickoff](docs/CODEX_NEXT_PASS_2026-11-05.md). The next engineering work is branch recovery, native build evidence and legacy Census loader parity before navigation implementation.
