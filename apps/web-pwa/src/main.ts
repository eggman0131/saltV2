// spec: SPEC.md §1.3 v0.2.3
import './lib/observability.js';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { installE2EHooks } from './lib/e2eHooks.js';
import {
  registerServiceWorker,
  setupPreloadErrorReload,
  clearPreloadReloadGuard,
} from './lib/pwa.js';

installE2EHooks();

mount(App, { target: document.getElementById('app')! });

// Reaching a successful mount means this build's chunks loaded — clear the
// one-shot stale-chunk reload guard so a future deploy gets its own single
// silent reload. No-op in dev / when storage is unavailable.
clearPreloadReloadGuard();

// Make the app installable + offline-capable and wire the deferred-reload
// auto-update flow (issue #141). No-op in dev.
registerServiceWorker();

// Silently reload onto the fresh build if a lazy route chunk 404s after a
// deploy (stale-chunk recovery, Phase 1). No-op in dev.
setupPreloadErrorReload();
