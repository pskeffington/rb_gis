#!/usr/bin/env python3
"""Guard exact-SHA checkout, official Rust setup, and required CI gates."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/ci.yml"
BOOTSTRAP = ROOT / "scripts/ci_bootstrap.sh"


def validate(workflow: str, bootstrap: str) -> list[str]:
    errors = []
    if "uses:" in workflow:
        errors.append("workflow must not import external GitHub Actions")
    for token in (
        'test "$GITHUB_REPOSITORY" = "pskeffington/rb_gis"',
        'fetch --no-tags --depth=1 origin "$GITHUB_SHA"',
        'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"',
        "scripts/ci_bootstrap.sh stable",
        "cargo +stable fmt --all -- --check",
        "cargo +stable clippy --workspace --all-targets --locked -- -D warnings",
        "cargo +stable test --workspace --locked",
        "python3 tools/test_validate_ci_policy.py",
    ):
        if token not in workflow:
            errors.append(f"missing required workflow gate: {token}")
    if "rustup toolchain install \"$toolchain\"" not in bootstrap:
        errors.append("bootstrap must install the selected official rustup toolchain")
    if "--component rustfmt --component clippy" not in bootstrap:
        errors.append("bootstrap must install rustfmt and clippy")
    return errors


def main() -> int:
    errors = validate(WORKFLOW.read_text(), BOOTSTRAP.read_text())
    if errors:
        for error in errors:
            print(f"FAIL: {error}")
        return 1
    print("PASS: first-party exact-SHA checkout, official Rust setup, and locked gates")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
