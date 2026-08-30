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
  // A syntactically-valid VAPID public key so the push store reads as
  // "configured" under test (issue #544). Not a real key — tests mock the send.
  VITE_VAPID_PUBLIC_KEY:
    'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8',
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
    // process fork per file was the dominant expense. Measured across every
    // project: ~193 → ~147 CPU-seconds, with `sys` alone halving (48s → 24s) —
    // that delta IS the fork overhead. CI's runner is 4-core and this job is
    // CPU-bound, so the saving lands as real wall-clock time.
    //
    // Set `pool: 'forks'` on a project that ever needs process-level isolation
    // (`process.chdir`, a native addon that is not thread-safe) — per project,
    // not globally, and never by reaching for `isolate: false`, which DOES leak
    // module state between files and fails 3 files in this suite today.
    pool: 'threads',
    // Both numbers below are measured, not guessed. `pnpm soak` runs the root
    // suite — every project — back to back with 12 spinner processes on the CPU
    // (`scripts/soak-unit-tests.mjs`). Three soaks on 2026-08-13, same load:
    //
    //   1000ms (the library default nobody chose)   2/6  green, load 14–28
    //   5000ms                                     12/15 green, load 35–56
    //   5000ms + the Class-A fixes below           20/20 green, load 27–47
    //
    // The middle row is what settled the value: at 5000ms every remaining failure
    // burned the budget EXACTLY, which is the signature of a wait whose condition
    // never becomes true, not one that needs longer — so the answer was to fix two
    // tests (`MealPlanWeekPage.test.ts`, keystrokes swallowed by a Sheet's focus
    // trap), not to raise the number again. 5000ms is therefore the smallest budget
    // that absorbs real scheduling jitter here, not the largest one that hides bugs.
    // Re-measure with `pnpm soak` before changing either number.
    //
    // Raised from the 5000ms default purely to stay above the 5000ms
    // `asyncUtilTimeout` set in `tests/setup.ts` (issue #793). At the default the
    // two were equal, so a single expiring `waitFor` would trip the vitest timeout
    // at the same moment and report "test timed out" instead of the `waitFor`
    // failure that says which condition never held. A handful of tests here chain
    // three or four sequential waits, so the ceiling has to clear several budgets,
    // not one. This costs a passing test nothing — it only bounds how long a
    // genuinely hung test takes to report. `hookTimeout` is deliberately left at
    // its default: one hook in this suite is async (`wakeLock.test.ts`) and no hook
    // uses a Testing Library wait, so nothing here spends that budget.
    testTimeout: 20_000,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
});
