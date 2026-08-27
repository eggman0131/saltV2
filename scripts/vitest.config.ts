import { defineConfig } from 'vitest/config';

// The eighth project (issue #1021). `scripts/` is outside the layer map — plain
// node ESM run from the repo root — so it gets its own project rather than
// borrowing a package's: the subject under test resolves nothing from `apps/` or
// `packages/`, and putting it under one would say otherwise.
//
// `include` is `.mjs`, not `.test.ts`: the subject is untyped ESM, and a `.ts`
// test importing it would pull an untyped `.mjs` into a TypeScript program for
// no gain. Nothing here is typechecked, deliberately.
//
// Coverage is untouched — the root `coverage.include` globs reach only
// `packages/*/src/**`, `packages/adapters/*/src/**` and `apps/*/src/**`, none of
// which matches `scripts/`. No threshold is added or moved.
export default defineConfig({
  test: {
    name: 'scripts',
    // Threads, not the default `forks` — isolation unchanged, per-file worker
    // spin-up is the cost. Full rationale in apps/web-pwa/vitest.config.ts.
    pool: 'threads',
    include: ['tests/**/*.test.mjs'],
    environment: 'node',
  },
});
