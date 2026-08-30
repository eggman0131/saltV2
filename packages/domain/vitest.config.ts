import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@salt/domain',
    // Threads, not the default `forks` — isolation unchanged, per-file worker
    // spin-up is the cost. Full rationale in apps/web-pwa/vitest.config.ts.
    pool: 'threads',
    include: ['tests/**/*.test.ts'],
    // The `.test-d.ts` type tests. `include` above matches `*.test.ts` and
    // nothing else, and the package tsconfig is rooted at `src/`, so without
    // this block a type-level assertion under `tests/` is compiled by nothing
    // and can never fail — the trap issue #922 found in ui-components. Its own
    // runner, glob and tsconfig; `enabled` is what makes `vitest run` collect
    // them alongside the runtime suite.
    typecheck: {
      enabled: true,
      include: ['tests/**/*.test-d.ts'],
      tsconfig: './tsconfig.typetest.json',
    },
  },
});
