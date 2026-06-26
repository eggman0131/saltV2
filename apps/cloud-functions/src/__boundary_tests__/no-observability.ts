// VIOLATION: Cloud Functions must not import the default @salt/observability
// subpath — that subpath wraps the browser-only posthog-js SDK. Server-side
// code must use @salt/observability/server instead.
// Expected: no-restricted-imports error.
import '@salt/observability';
