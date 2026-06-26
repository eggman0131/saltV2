import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@salt/observability',
    include: ['tests/**/*.test.ts'],
  },
});
