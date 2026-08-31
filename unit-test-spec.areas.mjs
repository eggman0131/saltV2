// The unit-test-spec RATCHET: how many files in each area currently breach each
// of the nine mechanically-checkable `UT-*` rules in docs/unit-test-spec.md.
//
// One consumer: `scripts/tests/unitTestSpecGuard.test.mjs`, which scans the tree
// with `scripts/lib/unitTestSpec.mjs` and compares. Named and shaped after
// `coverage.areas.mjs`, whose per-area coverage ratchet (#943, #1133) is the
// pattern this copies — a number per area survives the renames and file moves
// that a checked-in list of 153 paths would not.
//
// ── What a number here means, and how to change it ──────────────────────────
//
// It is a count of FILES in that area breaching that rule, and the guard asserts
// EQUALITY, not `<=`. Both directions red for a reason:
//
//   - going UP is the drift the guard exists to stop. #1134 measured 76 new test
//     files in the week after the spec was written and the two countable rules
//     got worse in absolute terms, under a spec that said MUST;
//   - going DOWN without editing this file means the ratchet has stopped
//     ratcheting. The coverage ratchet learned this the hard way: its regression
//     half was mechanical from #943 and its RATCHETING half was remembered, and
//     firebase-sync sat 34 line-points of earned protection unbanked until #1133
//     went looking. A count that may only fall is worth nothing if nobody makes
//     it fall.
//
// So: fix a violation, then lower its number here in the same commit. The guard
// prints the exact number to write. Raising one is legitimate but is a
// DELIBERATE act that must carry its reason in the diff — see the UT-B1 note in
// `scripts/lib/unitTestSpec.mjs` for the one case the spec itself sanctions.
//
// Nothing here is a target. `apps/web-pwa` at 44 UT-B1 breaches is not
// acceptable; it is frozen. #941 is explicit that the fixes ride in the PR of
// the issue they protect, never as a global backfill, and #1134 fixed none of
// them on purpose — this file is the freeze, not the plan.
//
// ── The areas ───────────────────────────────────────────────────────────────
//
// Keyed by vitest PROJECT root, read out of the root `vitest.config.ts`'s
// `projects` array rather than listed here. A ninth project therefore arrives
// with no entry, and the guard reds asking for one instead of silently not
// scanning it. Keys are checked against that array both ways: a key naming no
// project is as much a defect as a project with no key.
//
// Every rule id appears in every area, including the zeros. A grid rather than
// only the non-zero rows, because a missing key is ambiguous — "nothing breaches
// this here" and "nobody thought about it here" must not look the same, and the
// zeros are the rows a future breach turns red.
//
// ── Measured 2026-08-31, at `1b6cb308` ──────────────────────────────────────
//
// Re-measured with the guard itself rather than trusted from #1134's table; it
// reproduced that table's UT-A1 (7), UT-B1 (75), UT-C1 (0), UT-C2 (38) and
// UT-C3 (31) totals exactly. UT-E4 is the one that differs, and it is a real
// finding rather than a matcher fault: #1134 read 0 real violations from a grep
// for four `../`, and there is a live escape at three — see the `apps/web-pwa`
// note below.
export const violationCeilings = {
  'packages/shared-types': {
    'UT-A1': 0,
    'UT-B1': 0,
    'UT-C2': 0,
    'UT-E4': 0,
    'UT-G1': 0,
    'UT-G3': 0,
    'UT-G4': 0,
  },
  // One UT-C2: a `makeRecipe` in domain's own tests. Not obviously the same
  // defect as the other 37 — the builders it should use live in this package —
  // but it is the same shape and the rule draws no exception, so it is frozen
  // with the rest rather than exempted here.
  'packages/domain': {
    'UT-A1': 0,
    'UT-B1': 0,
    'UT-C2': 1,
    'UT-E4': 0,
    'UT-G1': 0,
    'UT-G3': 0,
    'UT-G4': 0,
  },
  'packages/adapters/firebase-sync': {
    'UT-A1': 0,
    'UT-B1': 1,
    'UT-C2': 0,
    'UT-E4': 0,
    'UT-G1': 0,
    'UT-G3': 0,
    'UT-G4': 0,
  },
  'packages/adapters/observability': {
    'UT-A1': 0,
    'UT-B1': 0,
    'UT-C2': 0,
    'UT-E4': 0,
    'UT-G1': 0,
    'UT-G3': 0,
    'UT-G4': 0,
  },
  // The UT-G1 is `packages/ui-components/tsconfig.test.json`, which exists and
  // which the root `typecheck` script does not run — the exact latent state
  // `apps/web-pwa` was in before #942 wired its own in and 174 fixture defects
  // fell out. The spec names it in UT-G1's evidence; this is that sentence with
  // a number behind it. Wiring it in is out of scope here (#1134 edits no test
  // and no config), and the day someone does, this becomes 0.
  'packages/ui-components': {
    'UT-A1': 0,
    'UT-B1': 0,
    'UT-C2': 0,
    'UT-E4': 0,
    'UT-G1': 1,
    'UT-G3': 0,
    'UT-G4': 0,
  },
  // The UT-E4 is `apps/web-pwa/tests/subscriptionReportingGuard.test.ts:66`,
  // which reads firebase-sync's barrel through `../../../packages/adapters/…`.
  // #1134 reported 0 because it grepped for four `../` and this one climbs
  // three. It is the genuine article — a guard that stops seeing its subject the
  // day that barrel moves — and it is frozen, not fixed, because #1134 edits no
  // existing test file.
  //
  // Three OTHER files match a raw grep and are not counted, correctly: they
  // spell a `../../packages/` path inside a comment ABOUT the rule
  // (`sheetCallSites`, `sharedHelperGuard`, `extractProcessStages`). That is the
  // must-not-match self-test case in the guard.
  'apps/web-pwa': {
    'UT-A1': 5,
    'UT-B1': 44,
    'UT-C1': 0,
    'UT-C2': 33,
    'UT-C3': 31,
    'UT-E4': 1,
    'UT-G1': 0,
    'UT-G3': 0,
    'UT-G4': 0,
  },
  'apps/cloud-functions': {
    'UT-A1': 2,
    'UT-B1': 30,
    'UT-C2': 4,
    'UT-E4': 0,
    'UT-G1': 0,
    'UT-G3': 0,
    'UT-G4': 0,
  },
  // The `.mjs` suites (#1021). UT-G1 and UT-G2 do not reach them by the spec's
  // own stated limit; everything else does, and all of it is clean.
  scripts: {
    'UT-A1': 0,
    'UT-B1': 0,
    'UT-C2': 0,
    'UT-E4': 0,
    'UT-G1': 0,
    'UT-G3': 0,
    'UT-G4': 0,
  },
};
