// Shared convergence-timeout vocabulary for the e2e suite. Each name documents
// WHICH async path a wait is for, so the timeout reads as intent rather than a
// magic number. See docs/e2e-test-spec.md (NF-A5). Specs should import these
// rather than re-declaring them locally.

/** Single-tab persistence / local store settle. */
export const SYNC_TIMEOUT = 15_000;

/** Cross-tab `onSnapshot` propagation (slower than single-tab over long-polling). */
export const CONVERGENCE_TIMEOUT = 20_000;

/** Cloud Function trigger rewrite round-trip (write → trigger → match → write-back). */
export const TRIGGER_TIMEOUT = 30_000;

/** Full reload + rehydrate from Firestore. */
export const HYDRATE_TIMEOUT = 30_000;
