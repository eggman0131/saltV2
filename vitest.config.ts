import { defineConfig } from 'vitest/config';
import { coverageExclude, coverageInclude, coverageThresholds } from './coverage.areas.mjs';

export default defineConfig({
  test: {
    // Every project sets `pool: 'threads'` (see any project config for why).
    // It is a PROJECT-level option — setting it in this root `test` block is
    // silently ignored when `projects` is used, and `extends` here would re-root
    // each project and break its `include` globs. So it lives in each of the
    // project configs listed below — a count here would only go stale (#1102).
    projects: [
      'packages/shared-types/vitest.config.ts',
      'packages/domain/vitest.config.ts',
      'packages/adapters/firebase-sync/vitest.config.ts',
      'packages/adapters/observability/vitest.config.ts',
      'packages/ui-components/vitest.config.ts',
      'apps/web-pwa/vitest.config.ts',
      'apps/cloud-functions/vitest.config.ts',
      // `scripts/` is outside the layer map and outside `coverage.include`
      // below, so this project adds suites without moving any threshold (#1021).
      'scripts/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      // `json` joins the three human-facing reporters so that
      // `coverage/unit/coverage-final.json` exists for `pnpm coverage:files:check`
      // to read — the guard that proves this report covered every file its globs
      // name, rather than quietly however many parsed (issue #974).
      reporter: ['text', 'html', 'lcov', 'json'],
      reportsDirectory: './coverage/unit',
      // Which files, which floors, and the reasoning behind both, all live in
      // coverage.areas.mjs — one declaration, shared with the guard that checks
      // it. Read its header before changing any of the three.
      include: coverageInclude,
      exclude: coverageExclude,
      thresholds: coverageThresholds,
    },
  },
});
