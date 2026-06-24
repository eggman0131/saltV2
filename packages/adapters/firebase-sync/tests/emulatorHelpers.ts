// Shared helpers for emulator integration tests.
// These run against the Firestore + Auth emulators (started by firebase emulators:exec).

import { getAuth, signInAnonymously } from 'firebase/auth';
import { getApp, getApps, deleteApp } from 'firebase/app';
import { initFirebase } from '../src/init.js';

// Firebase's default (unnamed) app is registered under this reserved name.
const DEFAULT_APP_NAME = '[DEFAULT]';

const PROJECT_ID = 'demo-salt';
// Firestore port for the REST clear endpoint. Read from import.meta.env (fed
// by this package's .env.test → the isolated Vitest stack, issue #84 Phase 3)
// — the same source init.ts/auth.ts use for the client SDK, so the clear
// endpoint and the SDK always hit the same emulator. Dev port 8080 stays as
// the ad-hoc fallback (hand-started emulator, no .env.test loaded).
const _env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const FIRESTORE_PORT = _env['VITE_EMULATOR_FIRESTORE_PORT'] ?? '8080';
const EMULATOR_HOST = `127.0.0.1:${FIRESTORE_PORT}`;

/**
 * Initialise Firebase for emulator tests and sign in anonymously so that
 * Firestore security rules (which require request.auth != null) pass.
 * Call once in beforeAll. Idempotent across test files in the same process.
 */
export async function initFirebaseEmulator(): Promise<void> {
  initFirebase({ projectId: PROJECT_ID, apiKey: 'demo-api-key' }, true);
  await signInAnonymously(getAuth(getApp()));
}

/**
 * Tears down and re-creates the default Firebase app so the next test gets a
 * brand-new Firestore client (and anonymous session). The emulator's long-poll
 * Listen channel intermittently corrupts mid-suite — a bogus multi-GB
 * `RESOURCE_EXHAUSTED: Received message larger than max` framing error — which
 * pushes the client into maximum backoff and poisons the connection for its
 * whole lifetime. `clearFirestoreEmulator` resets data but not that client
 * state, and `retry` reuses the same poisoned client, so a single hiccup used
 * to cascade into a `subscribeAisles` convergence timeout. Re-creating the app
 * per test contains the corruption to the one test that hit it (#319 / #122).
 *
 * `deleteApp` terminates the old Firestore client; `initFirebaseEmulator` then
 * re-wires a fresh app (the WeakSet-keyed guards in init.ts/auth.ts re-connect
 * the new instance) and re-authenticates. Call in beforeEach.
 */
export async function resetDefaultApp(): Promise<void> {
  const existing = getApps().find((app) => app.name === DEFAULT_APP_NAME);
  if (existing) {
    await deleteApp(existing);
  }
  await initFirebaseEmulator();
}

/**
 * Clears all Firestore documents in the emulator project.
 * Call in beforeEach to keep tests isolated.
 */
export async function clearFirestoreEmulator(): Promise<void> {
  const url = `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const resp = await fetch(url, { method: 'DELETE' });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`Failed to clear emulator data: HTTP ${resp.status}`);
  }
}

export { PROJECT_ID };
