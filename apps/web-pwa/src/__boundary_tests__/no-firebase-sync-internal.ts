// VIOLATION: web-pwa (and canonService) must not import firebase-sync internals.
// Only the published package root (@salt/firebase-sync) is allowed — never a subpath.
// Expected: no-restricted-imports error.
import '@salt/firebase-sync/src/canonSubscription';
