// Shared helpers for emulator integration tests.
// These run against the Firestore + Auth emulators (started by firebase emulators:exec).

import { getAuth, signInAnonymously } from 'firebase/auth';
import { getApp } from 'firebase/app';
import { initFirebase } from '../src/init.js';

const PROJECT_ID = 'demo-salt';
const EMULATOR_HOST = '127.0.0.1:8080';

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
