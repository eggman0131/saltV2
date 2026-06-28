import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

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
    alias: {
      $lib: resolve(__dirname, 'src/lib'),
    },
    conditions: ['browser'],
  },
  define: {
    ...Object.fromEntries(
      Object.entries(TEST_ENV).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]),
    ),
    // Build stamp globals (injected by vite.config.ts in real builds) — stubbed
    // here so rendering Settings under vitest doesn't hit an undefined global.
    __APP_VERSION__: JSON.stringify('test'),
    __APP_BUILD_TIME__: JSON.stringify('1970-01-01T00:00:00.000Z'),
  },
  test: {
    name: '@salt/web-pwa',
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
});
