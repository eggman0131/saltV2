import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@salt/local-store',
    include: ['tests/**/*.test.ts'],
  },
});
