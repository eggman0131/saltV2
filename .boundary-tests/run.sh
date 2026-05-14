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

expect_lint_error \
  "packages/domain/src/__boundary_tests__/no-indexeddb.ts" \
  "domain cannot import IndexedDB packages"

expect_lint_error \
  "packages/adapters/firebase-sync/src/__boundary_tests__/no-indexeddb.ts" \
  "firebase-sync cannot import IndexedDB packages"

expect_lint_error \
  "packages/domain/src/canon/__boundary_tests__/no-cross-module-subpath.ts" \
  "canon cannot import sibling module internals (subpath)"

expect_lint_error \
  "packages/domain/src/canon/__boundary_tests__/no-coordinator.ts" \
  "canon cannot import a coordinator"

expect_lint_error \
  "packages/domain/src/auth/__boundary_tests__/no-cross-module-subpath.ts" \
  "auth cannot import sibling module internals (subpath)"

expect_lint_error \
  "packages/domain/src/equipment/__boundary_tests__/no-cross-module-subpath.ts" \
  "equipment cannot import sibling module internals (subpath)"

expect_depcruise_error \
  ".boundary-tests/circular" \
  "circular imports are rejected"

expect_lint_error \
  "apps/cloud-functions/src/__boundary_tests__/no-ld-observability.ts" \
  "cloud-functions cannot import the default @salt/ld-observability subpath (browser SDK)"

expect_lint_error \
  "apps/web-pwa/src/__boundary_tests__/no-ld-observability-server.ts" \
  "web-pwa cannot import @salt/ld-observability/server (Node SDK)"

expect_lint_error \
  "apps/web-pwa/src/__boundary_tests__/no-firebase-sync-internal.ts" \
  "web-pwa cannot import firebase-sync internal subpaths"

expect_lint_error \
  "apps/web-pwa/src/__boundary_tests__/no-stage-internals.ts" \
  "web-pwa cannot import canon stage internals (must go through findClosestMatch)"

expect_lint_error \
  "apps/cloud-functions/src/__boundary_tests__/no-stage-internals.ts" \
  "cloud-functions cannot import canon stage internals (must go through findClosestMatch)"

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  echo "BOUNDARY TESTS FAILED — enforcement is not working correctly." >&2
  exit 1
fi

echo "All boundary tests passed."
