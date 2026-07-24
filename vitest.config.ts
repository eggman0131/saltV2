import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every project sets `pool: 'threads'` (see any project config for why).
    // It is a PROJECT-level option — setting it in this root `test` block is
    // silently ignored when `projects` is used, and `extends` here would re-root
    // each project and break its `include` globs. So it lives in the 8 configs.
    projects: [
      'packages/shared-types/vitest.config.ts',
      'packages/domain/vitest.config.ts',
      'packages/adapters/firebase-sync/vitest.config.ts',
      'packages/adapters/observability/vitest.config.ts',
      'packages/ui-components/vitest.config.ts',
      'packages/testing-utils/vitest.config.ts',
      'apps/web-pwa/vitest.config.ts',
      'apps/cloud-functions/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage/unit',
      include: ['packages/*/src/**', 'packages/adapters/*/src/**', 'apps/*/src/**'],
    },
  },
});
