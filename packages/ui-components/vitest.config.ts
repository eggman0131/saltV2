import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    conditions: ['browser'],
  },
  test: {
    name: '@salt/ui-components',
    // Threads, not the default `forks` — isolation unchanged, per-file worker
    // spin-up is the cost. Full rationale in apps/web-pwa/vitest.config.ts.
    pool: 'threads',
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // The two `.test-d.ts` type tests (issue #922). `include` above matches
    // `*.test.ts` and nothing else, so neither file had ever been executed — a
    // type test that never runs is a comment. `typecheck` is its own runner with
    // its own glob and its own tsconfig (the package's is `composite` and rooted
    // at `src/`, so it cannot see `tests/` at all), and `enabled` is what makes
    // `vitest run` collect them alongside the runtime suite rather than needing a
    // separate `--typecheck` invocation nobody would remember to make.
    typecheck: {
      enabled: true,
      include: ['tests/**/*.test-d.ts'],
      tsconfig: './tsconfig.typetest.json',
    },
  },
});
