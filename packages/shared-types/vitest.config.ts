import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@salt/shared-types',
    include: ['tests/**/*.test.ts'],
  },
});
