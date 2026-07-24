import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@salt/cloud-functions',
    // Threads, not the default `forks` — isolation unchanged, per-file worker
    // spin-up is the cost. Full rationale in apps/web-pwa/vitest.config.ts.
    pool: 'threads',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.emulator.test.ts'],
    environment: 'node',
  },
});
