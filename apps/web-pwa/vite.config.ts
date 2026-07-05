import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';
import { execSync } from 'node:child_process';

// Version stamp shown on the Settings screen and registered as the `app_version`
// PostHog super property. Production CI passes the published GitHub Release tag via
// APP_VERSION (e.g. 202606.15) — reliable because git tags are NOT fetched in CI.
// Locally and on staging we derive it from git: `git describe --tags --always`
// yields the nearest release tag, plus commits-ahead + short SHA when the build is
// not exactly on a tag (e.g. 202606.15-3-gabc1234), falling back to a bare short
// SHA, then 'unknown'. The build timestamp (below) still guarantees every build is
// distinct — so a re-dispatched deploy of the SAME tag produces a visibly new
// build, which validates the open-client PWA auto-update flow (issue #141 Phase 3)
// via a plain workflow_dispatch re-deploy, no throwaway commit required.
function resolveAppVersion(): string {
  const fromEnv = process.env.APP_VERSION?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execSync('git describe --tags --always', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}
const appVersion = resolveAppVersion();
const buildTime = new Date().toISOString();

// PWA identity is env-distinct (issue #141): staging installs as "Salt (Staging)"
// with its own theme color so it is visually separable from prod on a device.
// The values come from the existing VITE_* env mechanism (.env.<mode>), read at
// build time here — they are NOT exposed to client code, they only shape the
// generated web app manifest.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_');
  const pwaName = env.VITE_PWA_NAME ?? 'Salt';
  const pwaShortName = env.VITE_PWA_SHORT_NAME ?? 'Salt';
  const pwaThemeColor = env.VITE_PWA_THEME_COLOR ?? '#EA580C';

  return {
    plugins: [
      tailwindcss(),
      svelte(),
      VitePWA({
        // Workbox generateSW (default strategy) — the service worker is generated,
        // never hand-authored (issue #141). injectRegister: false because the app
        // owns registration + the deferred-reload update flow in src/lib/pwa.ts;
        // we do not want the plugin's built-in immediate reload-on-update.
        injectRegister: false,
        registerType: 'autoUpdate',
        manifest: {
          name: pwaName,
          short_name: pwaShortName,
          description: 'Salt — your kitchen, organized.',
          theme_color: pwaThemeColor,
          background_color: '#FFFFFF',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          // Generated from branding/icon-master.svg via `pnpm icons:generate`.
          // The master is full-bleed with its glyph inside the central safe zone,
          // so the same rasters serve both `any` and `maskable` purposes.
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            {
              src: '/icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: '/icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // Precache the built app shell/assets only. Firebase/Firestore network
          // calls are deliberately NOT cached here — Firestore persistentLocalCache
          // owns offline data (CLAUDE.md hard rule #3); the SW owns only the shell.
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
          // Since #411 the bundle is code-split: routes are lazy chunks and the
          // Firebase/PostHog SDKs are separate vendor chunks (see manualChunks
          // above). The largest single precached file is now the Firebase chunk
          // (~650 KB) and the app chunk (~1.15 MB), both comfortably under
          // Workbox's 2 MiB default — so no override is needed.
          maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
          // SPA app-shell fallback so an offline navigation still boots the app.
          navigateFallback: '/index.html',
          // New SW takes control as soon as it installs; the app then reloads at a
          // safe moment (see src/lib/pwa.ts), never mid-interaction.
          skipWaiting: true,
          clientsClaim: true,
          // Do not let the SW intercept cross-origin Firebase/Firestore traffic.
          navigateFallbackDenylist: [/^\/__\//],
        },
        // No SW in dev — it interferes with HMR and the e2e Vite dev server.
        devOptions: {
          enabled: false,
        },
      }),
    ],
    build: {
      // 'hidden' emits .map files for every chunk WITHOUT appending a public
      // `//# sourceMappingURL=` comment, so the deployed bundle never references
      // them. The deploy workflows (deploy-production.yml / deploy-staging.yml)
      // run PostHog/upload-source-maps against dist/ after the build: it injects
      // a chunk id, uploads the maps to PostHog Error Tracking, and deletes the
      // .map files before `firebase deploy` — so production exceptions
      // symbolicate back to TS source without the maps ever being served (#359).
      sourcemap: 'hidden',
      rollupOptions: {
        output: {
          // Split the large, rarely-changing vendor SDKs into their own
          // content-hashed chunks (issue #411). Firebase and PostHog change far
          // less often than app code, so isolating them means a typical deploy
          // only invalidates the app chunk — the browser (and the SW precache)
          // keeps the cached vendor chunks instead of re-downloading them on
          // every update. The `node_modules` guard excludes workspace source
          // (e.g. @salt/firebase-sync resolves outside node_modules), so only
          // the real Firebase/PostHog SDK modules land in these chunks.
          manualChunks(id: string): string | undefined {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('firebase')) return 'firebase';
            if (id.includes('posthog')) return 'posthog';
            return undefined;
          },
        },
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_BUILD_TIME__: JSON.stringify(buildTime),
    },
    resolve: {
      alias: {
        $lib: resolve(__dirname, 'src/lib'),
      },
    },
    optimizeDeps: {
      exclude: ['@salt/shared-types', '@salt/domain', '@salt/firebase-sync'],
    },
  };
});
