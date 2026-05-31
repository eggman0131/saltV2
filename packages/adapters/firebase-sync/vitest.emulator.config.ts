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
    // interfering with the beforeEach data-clear.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
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
  },
});
