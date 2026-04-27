import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const TEST_ENV = {
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'localhost',
  VITE_FIREBASE_PROJECT_ID: 'salt-test',
  VITE_FIREBASE_STORAGE_BUCKET: 'salt-test.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '0',
  VITE_FIREBASE_APP_ID: 'test',
  VITE_USE_EMULATORS: 'false',
};

export default defineConfig({
  plugins: [svelte({ hot: false })],
  resolve: {
    conditions: ['browser'],
  },
  define: Object.fromEntries(
    Object.entries(TEST_ENV).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]),
  ),
  test: {
    name: '@salt/web-pwa',
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
});
