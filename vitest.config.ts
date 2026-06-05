import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/shared-types/vitest.config.ts',
      'packages/domain/vitest.config.ts',
      'packages/adapters/firebase-sync/vitest.config.ts',
      'packages/adapters/ld-observability/vitest.config.ts',
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
      exclude: ['apps/kitchen-sink/**'],
    },
  },
});
