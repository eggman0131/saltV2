import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@salt/observability',
    // Threads, not the default `forks` — isolation unchanged, per-file worker
    // spin-up is the cost. Full rationale in apps/web-pwa/vitest.config.ts.
    pool: 'threads',
    include: ['tests/**/*.test.ts'],
    // Drains the browser tracer's fire-and-forget chunk load before teardown, so
    // coverage of browserTracerImpl.ts stops depending on the transform cache.
    // Full explanation in the setup file (#977).
    setupFiles: ['tests/setup.ts'],
  },
});
