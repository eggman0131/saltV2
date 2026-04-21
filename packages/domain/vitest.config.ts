import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@salt/domain',
    include: ['tests/**/*.test.ts'],
  },
});
