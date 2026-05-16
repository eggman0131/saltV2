import { initializeApp, getApps, getApp } from 'firebase/app';
import type { FirebaseOptions } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  connectFirestoreEmulator,
  disableNetwork,
  enableNetwork,
} from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import { connectAuthEmulatorOnce } from './auth.js';

let emulatorsConnected = false;

export function initFirebase(
  options: FirebaseOptions,
  useEmulators = false,
  usePersistentCache = false,
): void {
  const isNew = getApps().length === 0;
  const app = isNew ? initializeApp(options) : getApp();

  if (isNew && usePersistentCache) {
    initializeFirestore(app, { localCache: persistentLocalCache() });
  }

  if (useEmulators && !emulatorsConnected) {
    const _env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
    const firestorePort = Number(_env['VITE_EMULATOR_FIRESTORE_PORT'] ?? 8080);
    const functionsPort = Number(_env['VITE_EMULATOR_FUNCTIONS_PORT'] ?? 5001);
    connectFirestoreEmulator(getFirestore(app), '127.0.0.1', firestorePort);
    connectFunctionsEmulator(getFunctions(app, 'europe-west2'), '127.0.0.1', functionsPort);
    connectAuthEmulatorOnce(getAuth(app));
    emulatorsConnected = true;
  }
}

export async function setFirestoreNetwork(online: boolean): Promise<void> {
  const db = getFirestore();
  if (online) {
    await enableNetwork(db);
  } else {
    await disableNetwork(db);
  }
}
