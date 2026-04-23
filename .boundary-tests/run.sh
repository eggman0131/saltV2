#!/bin/sh
# Verifies that boundary enforcement tools reject each deliberate violation.
# A test PASSES when the tool reports an error (exit code != 0 or error in output).
# Run from the repo root: sh .boundary-tests/run.sh

set -e
cd "$(dirname "$0")/.."

PASS=0
FAIL=0

expect_lint_error() {
  local file="$1"
  local desc="$2"
  if pnpm eslint --no-ignore --no-error-on-unmatched-pattern "$file" 2>&1 | grep -qE " error "; then
    echo "  PASS  $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $desc — expected a lint error but got none"
    FAIL=$((FAIL + 1))
  fi
}

expect_depcruise_error() {
  local path="$1"
  local desc="$2"
  if pnpm depcruise --config .dependency-cruiser.cjs "$path" 2>&1 | grep -qE "error|✗"; then
    echo "  PASS  $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $desc — expected a dependency-cruiser error but got none"
    FAIL=$((FAIL + 1))
  fi
}

echo "Running boundary tests..."
echo ""

expect_lint_error \
  "packages/domain/src/__boundary_tests__/no-firebase.ts" \
  "domain cannot import firebase"

expect_lint_error \
  "packages/domain/src/__boundary_tests__/no-web-pwa.ts" \
  "nothing can import @salt/web-pwa"

expect_lint_error \
  "packages/shared-types/src/__boundary_tests__/no-domain.ts" \
  "shared-types cannot import @salt/domain"

expect_lint_error \
  "packages/ui-components/src/__boundary_tests__/imports-firebase.ts" \
  "ui-components cannot import Firebase SDKs"

expect_depcruise_error \
  ".boundary-tests/circular" \
  "circular imports are rejected"

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  echo "BOUNDARY TESTS FAILED — enforcement is not working correctly." >&2
  exit 1
fi

echo "All boundary tests passed."
