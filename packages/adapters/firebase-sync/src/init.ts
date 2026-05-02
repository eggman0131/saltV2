import { initializeApp, getApps, getApp } from 'firebase/app';
import type { FirebaseOptions } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  connectFirestoreEmulator,
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
    connectFirestoreEmulator(getFirestore(app), '127.0.0.1', 8080);
    connectFunctionsEmulator(getFunctions(app), '127.0.0.1', 5001);
    connectAuthEmulatorOnce(getAuth(app));
    emulatorsConnected = true;
  }
}
