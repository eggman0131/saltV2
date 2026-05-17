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
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
