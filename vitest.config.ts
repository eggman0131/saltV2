import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/shared-types/vitest.config.ts',
      'packages/domain/vitest.config.ts',
      'packages/adapters/firebase-sync/vitest.config.ts',
      'packages/adapters/local-store/vitest.config.ts',
      'packages/ui-components/vitest.config.ts',
      'packages/testing-utils/vitest.config.ts',
      'apps/web-pwa/vitest.config.ts',
      'apps/cloud-functions/vitest.config.ts',
    ],
  },
});
