// Single source of truth for the Firestore emulator host/port used across the
// e2e harness. Previously `8081` and its derived URLs were hardcoded in
// globalSetup.ts, fixtures/test.ts, and helpers/auth.ts; centralising them here
// means the port appears in exactly one place. This module is runtime-neutral
// (string/number constants only) so the Node-context globalSetup and the
// Playwright-context fixtures can both import it cleanly.

/** Loopback host the test emulator stack binds to. */
export const EMULATOR_HOST = '127.0.0.1';

/** Firestore emulator port (number form). */
export const FIRESTORE_EMULATOR_PORT = 8081;

/**
 * Firestore emulator port as the string the Vite env var expects
 * (`VITE_EMULATOR_FIRESTORE_PORT`). Kept as a literal so it never drifts from
 * the numeric form above.
 */
export const FIRESTORE_EMULATOR_PORT_STRING = '8081';

/** Origin (`http://host:port`) of the Firestore emulator. */
export const FIRESTORE_EMULATOR_ORIGIN = `http://${EMULATOR_HOST}:${FIRESTORE_EMULATOR_PORT}`;

/** Demo project id the test stack targets. */
export const EMULATOR_PROJECT = 'demo-salt';

/**
 * The owner REST base for reading/writing documents directly (bypasses security
 * rules with a `Bearer owner` token). Used by the member-allowlist seed.
 * Shape: `…:8081/v1/projects/demo-salt/databases/(default)/documents`.
 */
export const FIRESTORE_DOCUMENTS_BASE_URL = `${FIRESTORE_EMULATOR_ORIGIN}/v1/projects/${EMULATOR_PROJECT}/databases/(default)/documents`;

/**
 * The emulator clear endpoint base (`DELETE` here wipes all Firestore data).
 * Shape: `…:8081/emulator/v1/projects/demo-salt/databases/(default)/documents`.
 */
export const FIRESTORE_EMULATOR_CLEAR_URL = `${FIRESTORE_EMULATOR_ORIGIN}/emulator/v1/projects/${EMULATOR_PROJECT}/databases/(default)/documents`;
