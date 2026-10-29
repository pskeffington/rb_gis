#!/usr/bin/env bash
# Install supported official Rust toolchains without third-party Actions.
set -euo pipefail

toolchain="${1:-}"
if [[ "$toolchain" != "stable" && "$toolchain" != "1.90.0" ]]; then
  echo "usage: bash scripts/ci_bootstrap.sh {stable|1.90.0}" >&2
  exit 2
fi

command -v rustup >/dev/null || {
  echo "rustup is required on the hosted runner" >&2
  exit 1
}

rustup toolchain install "$toolchain" --profile minimal --component rustfmt --component clippy
rustc "+$toolchain" --version
cargo "+$toolchain" --version
