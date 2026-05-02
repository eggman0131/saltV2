// VIOLATION: Cloud Functions must not import @salt/ld-observability.
// The LaunchDarkly Observability SDK is browser-only and cannot run in Node.
// CFs log via firebase-functions/logger instead. Expected: no-restricted-imports error.
import '@salt/ld-observability';
