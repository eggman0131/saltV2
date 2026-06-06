// spec: SPEC.md §1.3 v0.2.3
import './lib/observability.js';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { installE2EHooks } from './lib/e2eHooks.js';
import { registerServiceWorker } from './lib/pwa.js';

installE2EHooks();

mount(App, { target: document.getElementById('app')! });

// Make the app installable + offline-capable and wire the deferred-reload
// auto-update flow (issue #141). No-op in dev.
registerServiceWorker();
