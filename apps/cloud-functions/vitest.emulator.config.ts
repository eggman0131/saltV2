import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@salt/cloud-functions:emulator',
    include: ['tests/**/*.emulator.test.ts'],
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
