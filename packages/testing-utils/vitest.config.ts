import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@salt/testing-utils',
    include: ['tests/**/*.test.ts'],
  },
});
