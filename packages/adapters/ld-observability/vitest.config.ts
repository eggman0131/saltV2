import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@salt/ld-observability',
    include: ['tests/**/*.test.ts'],
  },
});
