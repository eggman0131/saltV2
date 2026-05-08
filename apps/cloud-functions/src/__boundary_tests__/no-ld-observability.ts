// VIOLATION: Cloud Functions must not import the default @salt/ld-observability
// subpath — that subpath wraps the browser-only LaunchDarkly SDK. Server-side
// code must use @salt/ld-observability/server instead.
// Expected: no-restricted-imports error.
import '@salt/ld-observability';
