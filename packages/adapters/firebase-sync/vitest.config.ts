import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@salt/firebase-sync',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.emulator.test.ts'],
  },
});
