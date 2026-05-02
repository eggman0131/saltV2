import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@salt/cloud-functions',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.emulator.test.ts'],
    environment: 'node',
  },
});
