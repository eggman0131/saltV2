import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@salt/cloud-functions:emulator',
    include: ['tests/**/*.emulator.test.ts'],
    environment: 'node',
    // Point the Admin SDK at the isolated Vitest emulator stack's Firestore
    // (docker/test-emulators/docker-compose.vitest.yml, issue #84 Phase 3),
    // NOT the dev emulator. Vitest exposes this on process.env, which the
    // emulator test reads to build FIRESTORE_EMULATOR_HOST. MUST match the
    // host Firestore port mapping in docker-compose.vitest.yml.
    env: {
      VITE_EMULATOR_FIRESTORE_PORT: '8082',
    },
    // Run all emulator test files sequentially in a single process. In Vitest
    // 4 the v3 `poolOptions.forks.singleFork` was replaced by top-level
    // `maxWorkers: 1` + `isolate: false` (see vitest 4 migration guide).
    pool: 'forks',
    maxWorkers: 1,
    isolate: false,
  },
});
