import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

const TEST_ENV = {
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'localhost',
  VITE_FIREBASE_PROJECT_ID: 'salt-test',
  VITE_FIREBASE_STORAGE_BUCKET: 'salt-test.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '0',
  VITE_FIREBASE_APP_ID: 'test',
  VITE_USE_EMULATORS: 'false',
};

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      $lib: resolve(__dirname, 'src/lib'),
    },
    conditions: ['browser'],
  },
  define: {
    ...Object.fromEntries(
      Object.entries(TEST_ENV).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]),
    ),
    // Build stamp globals (injected by vite.config.ts in real builds) — stubbed
    // here so rendering Settings under vitest doesn't hit an undefined global.
    __APP_VERSION__: JSON.stringify('test'),
    __APP_BUILD_TIME__: JSON.stringify('1970-01-01T00:00:00.000Z'),
  },
  test: {
    name: '@salt/web-pwa',
    // Worker threads, not child processes (Vitest's default `forks`). Isolation
    // is UNCHANGED — every test file still gets a fresh module registry; only the
    // worker container differs. This suite's cost is almost entirely per-file
    // worker spin-up, not test execution: a trivial test file costs ~1 CPU-second
    // here while `tests` totals ~18s of a ~190 CPU-second full run. Paying a
    // process fork per file was the dominant expense. Measured across all 8
    // projects: ~193 → ~147 CPU-seconds, with `sys` alone halving (48s → 24s) —
    // that delta IS the fork overhead. CI's runner is 4-core and this job is
    // CPU-bound, so the saving lands as real wall-clock time.
    //
    // Set `pool: 'forks'` on a project that ever needs process-level isolation
    // (`process.chdir`, a native addon that is not thread-safe) — per project,
    // not globally, and never by reaching for `isolate: false`, which DOES leak
    // module state between files and fails 3 files in this suite today.
    pool: 'threads',
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
});
