import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@salt/firebase-sync:emulator',
    include: ['tests/**/*.emulator.test.ts'],
    environment: 'node',
    // Emulator host ports come from `.env.test` in this package (Vite's
    // loadEnv exposes VITE_-prefixed vars on import.meta.env). init.ts /
    // auth.ts (unchanged — they already read import.meta.env VITE_EMULATOR_*)
    // and tests/emulatorHelpers.ts therefore all resolve the isolated Vitest
    // stack ports, NOT the dev emulator (issue #84 Phase 3). `test.env` was
    // deliberately NOT used: Vitest only reaches process.env via test.env,
    // never import.meta.env, so it cannot retarget the client SDK.
    // Emulator tests run sequentially to avoid concurrent Firestore access
    // interfering with the beforeEach data-clear. In Vitest 4 the v3
    // `poolOptions.forks.singleFork` was replaced by top-level `maxWorkers: 1`
    // + `isolate: false` (see vitest 4 migration guide).
    pool: 'forks',
    maxWorkers: 1,
    isolate: false,
    // Per-test ceiling must exceed the realtime tests' CONVERGENCE_MS window.
    // Vitest's default 5000ms timeout equals that window, but Vitest's clock
    // starts at the top of the test while each waitFor only starts after the
    // subscribe + write setup — so the default is effectively tighter than the
    // convergence budget and aborts the test first on a cold CI emulator (the
    // first-in-block subscription callbacks take seconds there). These are just
    // ceilings (waitFor polls and returns the instant data converges), so warm
    // local runs are unaffected. hookTimeout covers beforeAll/beforeEach, which
    // hit the emulator (init, anon sign-in, data clear).
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // NO `retry` — deliberately, and it must not come back without an issue (#944).
    //
    // This suite carried `retry: 2` as residual insurance for the flaky Firestore
    // realtime Listen stream (#122): the default gRPC streaming transport
    // intermittently breaks the emulator Listen stream with a bogus multi-GB
    // RESOURCE_EXHAUSTED and poisons the channel for the client's lifetime. Two
    // fixes for that landed first — (1) long-polling on the emulator transport
    // (init.ts + the writer app), removing the streaming framing bug; (2) the
    // realtime suite re-creates the default + writer apps per test (#319), so a
    // poisoned channel is contained to the test that hit it instead of cascading
    // into a later subscribeAisles convergence timeout. The retry was the belt to
    // those braces, and its own comment said to drop it once main stayed green.
    //
    // Dropped because a retry here is not free insurance, it is a blindfold. The
    // e2e suite's NF-G3 (docs/e2e-test-spec.md) already binds the other half of
    // this repo: "a test that only passes on the retry is a bug to fix, not a
    // passing test." More concretely, #928 triples this suite — 8 of the 28
    // exported subscriptions are covered today, and the plan is all 28 — and a
    // genuine collision among the new cases would be indistinguishable from a
    // green run while retries absorbed it.
    //
    // What this does NOT mean: the flake, if any returns, is not stale Firestore
    // data. Both suites that need it already clear the whole database and
    // re-create the app in beforeEach, and `maxWorkers: 1` rules out cross-worker
    // collisions. The residual bleed vector is `isolate: false` above, which
    // persists MODULE-level state across files. Diagnose there, not in teardown.
  },
});
