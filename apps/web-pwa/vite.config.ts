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
  // Icon set for this environment: non-prod builds point at a re-coloured variant
  // under public/icons/<env>/ so the installed icon matches the app's TopBar colour
  // (see scripts/generate-icons.ts). Production falls back to the master palette in
  // public/icons/. index.html reads the SAME var for the iOS apple-touch-icon.
  const pwaIconPath = env.VITE_PWA_ICON_PATH ?? '/icons';

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
          // Explicit app identity. Chromium otherwise derives it from `start_url`,
          // and `id` is the one manifest field that cannot be changed later without
          // the OS treating it as a DIFFERENT app (losing the install, its
          // permissions, and its push subscription). Pinning it now decouples the
          // identity from any future start_url change. Each environment is its own
          // origin, so a single relative id cannot collide across them.
          id: '/',
          name: pwaName,
          short_name: pwaShortName,
          description: 'Salt — your kitchen, organized.',
          theme_color: pwaThemeColor,
          background_color: '#FFFFFF',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          // Web Share Target (issue #589) — puts Salt in the Android share sheet so
          // a recipe link found in Chrome/Instagram/WhatsApp imports in two taps.
          // GET (not POST) because a POST target must be intercepted in the service
          // worker, and ours is Workbox-GENERATED, never hand-authored (#141, #544);
          // a GET target needs no SW involvement. action '/' because firebase.json
          // declares no hosting rewrites and the app is hash-routed, so any other
          // path would 404 — sharing to '/' lets Hosting serve index.html as usual
          // and the payload arrives as a query string the app reads at boot
          // (src/lib/shareTarget.ts). Chromium-only; iOS/Safari has no support and
          // the "Import from URL" button remains the path for it.
          share_target: {
            action: '/',
            method: 'GET',
            params: { title: 'title', text: 'text', url: 'url' },
          },
          // Generated from branding/icon-master.svg via `pnpm icons:generate`.
          // The master is full-bleed with its glyph inside the central safe zone,
          // so the same rasters serve both `any` and `maskable` purposes.
          icons: [
            {
              src: `${pwaIconPath}/icon-192.png`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `${pwaIconPath}/icon-512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `${pwaIconPath}/icon-192.png`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: `${pwaIconPath}/icon-512.png`,
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
          // Cook-timer push handling (issue #544). Rather than migrate off
          // generateSW to a hand-authored injectManifest SW — which would mean
          // re-implementing the #141 deferred-reload / skipWaiting / clientsClaim
          // flow by hand and risking that contract — we overlay the push +
          // notificationclick listeners via importScripts. The generated SW still
          // owns precaching + the entire #141 update flow, byte-for-byte; this
          // classic script (served from public/) only adds the two listeners.
          importScripts: ['push-sw.js'],
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
      // Deps that ONLY the excluded workspace packages import. Vite's startup
      // scan cannot see through an excluded (linked, unbundled) package, so
      // without this it meets `firebase/*` and `zod` for the first time when the
      // BROWSER requests @salt/firebase-sync's source — mid-page-load — then
      // re-bundles and issues a full page reload to swap the new deps in
      // ("optimized dependencies changed. reloading"). Under e2e that reload
      // lands on whatever test is running: locators it just resolved vanish and
      // the failure reads as "element(s) not found" / a click timing out.
      //
      // That is the whole of the shard flake class (issue #668): it used to be
      // paid once, by the first spec of a single unsharded run, and #587's 3-way
      // shard made three cold servers pay it — one per shard, on whichever spec
      // happens to sort first. Listing them here moves the work into the startup
      // scan, so the cache is complete before the first navigation and no reload
      // is ever sent. Keep in sync with what @salt/firebase-sync imports.
      //
      // The `<pkg> > <dep>` form is required, not decoration: neither `firebase`
      // nor `zod` is a dependency of web-pwa itself, so a bare specifier does not
      // resolve from the app root ("Failed to resolve dependency ... present in
      // optimizeDeps.include") and the entry is dropped — which silently restores
      // the runtime-discovery reload this exists to prevent.
      include: [
        '@salt/firebase-sync > firebase/app',
        '@salt/firebase-sync > firebase/app-check',
        '@salt/firebase-sync > firebase/auth',
        '@salt/firebase-sync > firebase/firestore',
        '@salt/firebase-sync > firebase/functions',
        '@salt/domain > zod',
      ],
    },
  };
});
