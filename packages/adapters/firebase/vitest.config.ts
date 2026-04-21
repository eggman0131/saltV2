import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@salt/firebase-adapter',
    include: ['tests/**/*.test.ts'],
  },
});
