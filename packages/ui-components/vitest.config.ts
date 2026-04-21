import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@salt/ui-components',
    include: ['tests/**/*.test.ts'],
  },
});
