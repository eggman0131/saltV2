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
  },
});
