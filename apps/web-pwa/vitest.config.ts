import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@salt/web-pwa',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
