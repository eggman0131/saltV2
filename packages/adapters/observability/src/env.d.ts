// Minimal ImportMeta.env typings for the Vite vars this package reads. Declared
// locally (rather than via `/// <reference types="vite/client" />`) so the
// adapter doesn't take a build-time dependency on `vite`; the consuming app
// (web-pwa) is what actually injects these at build time.
interface ImportMetaEnv {
  readonly PROD: boolean;
  readonly VITE_PUBLIC_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
