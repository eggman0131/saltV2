import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@salt/firebase-sync:emulator',
    include: ['tests/**/*.emulator.test.ts'],
    environment: 'node',
    // Emulator tests run sequentially to avoid concurrent Firestore access
    // interfering with the beforeEach data-clear.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
