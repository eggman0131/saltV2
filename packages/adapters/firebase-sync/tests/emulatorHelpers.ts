// Shared helpers for emulator integration tests.
// These run against the Firestore emulator (started by firebase emulators:exec).

const PROJECT_ID = 'demo-salt';
const EMULATOR_HOST = '127.0.0.1:8080';

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
