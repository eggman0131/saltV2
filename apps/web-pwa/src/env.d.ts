/// <reference types="vite/client" />
/// <reference types="svelte" />

declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component;
  export default component;
}

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_USE_EMULATORS: string;
  // App Check (issue #145). Site key is public; absent in dev/emulator builds.
  // Debug token is injected only for unattested real-backend access (untracked
  // env / CI secret) — never committed or shipped in a deployed bundle.
  readonly VITE_FIREBASE_APPCHECK_SITE_KEY?: string;
  readonly VITE_FIREBASE_APPCHECK_DEBUG_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Build stamp injected by Vite `define` (see vite.config.ts). Shown on Settings.
declare const __APP_VERSION__: string;
declare const __APP_BUILD_TIME__: string;
