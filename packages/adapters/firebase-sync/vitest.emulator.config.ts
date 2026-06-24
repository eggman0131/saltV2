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
    // Residual insurance for the flaky Firestore realtime Listen stream (#122).
    // Root cause: the default gRPC streaming transport intermittently breaks the
    // emulator Listen stream with a bogus multi-GB RESOURCE_EXHAUSTED, poisoning
    // the channel for the client's lifetime. Two landed fixes attack it: (1)
    // long-polling on the emulator transport (init.ts + the writer app), which
    // removes the streaming framing bug; (2) the realtime suite now re-creates
    // the default + writer apps per test (#319), so a poisoned channel is
    // contained to the one test that hit it instead of cascading into a later
    // subscribeAisles convergence timeout — and because Vitest re-runs beforeEach
    // on retry, each retry now gets a fresh client (previously the apps lived in
    // beforeAll, so retries reused the dead channel and never cleared it).
    // retry:2 stays as cheap insurance; drop it once main stays green for a
    // stretch without it.
    retry: 2,
  },
});
