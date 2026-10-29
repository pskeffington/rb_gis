#!/usr/bin/env python3
import unittest

from validate_ci_policy import validate


WORKFLOW = '''
test "$GITHUB_REPOSITORY" = "pskeffington/rb_gis"
fetch --no-tags --depth=1 origin "$GITHUB_SHA"
test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
bash scripts/ci_bootstrap.sh stable
cargo +stable fmt --all -- --check
cargo +stable clippy --workspace --all-targets --locked -- -D warnings
cargo +stable test --workspace --locked
python3 tools/test_validate_ci_policy.py
'''
BOOTSTRAP = '''rustup toolchain install "$toolchain" --profile minimal
--component rustfmt --component clippy'''


class CiPolicyTests(unittest.TestCase):
    def test_accepts_required_first_party_gates(self):
        self.assertEqual(validate(WORKFLOW, BOOTSTRAP), [])

    def test_rejects_action_imports(self):
        errors = validate(WORKFLOW + "\nuses: dtolnay/rust-toolchain@stable\n", BOOTSTRAP)
        self.assertTrue(any("must not import" in error for error in errors))

    def test_rejects_non_exact_checkout(self):
        errors = validate(WORKFLOW.replace('"$GITHUB_SHA"', '"main"'), BOOTSTRAP)
        self.assertTrue(any("exact" in error or "GITHUB_SHA" in error for error in errors))

    def test_rejects_missing_locked_test_gate(self):
        errors = validate(WORKFLOW.replace("cargo +stable test --workspace --locked", ""), BOOTSTRAP)
        self.assertTrue(any("cargo +stable test" in error for error in errors))

    def test_rejects_missing_lint_component(self):
        errors = validate(WORKFLOW, BOOTSTRAP.replace("--component clippy", ""))
        self.assertTrue(any("rustfmt and clippy" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
