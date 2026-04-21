import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    exclude: ['@salt/shared-types', '@salt/domain', '@salt/firebase-adapter'],
  },
});
