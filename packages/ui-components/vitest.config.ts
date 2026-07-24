import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    conditions: ['browser'],
  },
  test: {
    name: '@salt/ui-components',
    // Threads, not the default `forks` — isolation unchanged, per-file worker
    // spin-up is the cost. Full rationale in apps/web-pwa/vitest.config.ts.
    pool: 'threads',
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
});
