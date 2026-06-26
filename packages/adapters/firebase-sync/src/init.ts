import { initializeApp, getApps, getApp } from 'firebase/app';
import type { FirebaseApp, FirebaseOptions } from 'firebase/app';
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
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectAuthEmulatorOnce } from './auth.js';

// Tracks which app instances have had their emulator transports wired up.
// Keyed to the app instance (not a module-global boolean) so that a torn-down
// and re-created default app — as the emulator integration suite now does per
// test to isolate a poisoned Listen channel (#319) — re-establishes its
// emulator connection instead of being skipped by a stale "already connected"
// flag. Still idempotent per app: connectFirestoreEmulator throws if called
// twice on the same Firestore instance, and a live app is only ever wired once.
const emulatorConnectedApps = new WeakSet<FirebaseApp>();

export interface AppCheckConfig {
  /** reCAPTCHA Enterprise site key. Public — it ships in the client bundle. */
  siteKey: string;
  /**
   * App Check debug token, for unattested environments (local dev or CI hitting a
   * real Firebase backend). When set, the SDK uses the debug provider instead of
   * reCAPTCHA. MUST NOT be baked into a deployed bundle — it bypasses attestation.
   */
  debugToken?: string;
}

export function initFirebase(
  options: FirebaseOptions,
  useEmulators = false,
  usePersistentCache = false,
  appCheck?: AppCheckConfig,
): void {
  const isNew = getApps().length === 0;
  const app = isNew ? initializeApp(options) : getApp();

  // App Check attests that requests come from our genuine app, protecting the
  // Gemini/Genkit callables (the real cost surface) plus Firestore/Storage.
  // Skipped under emulators: the emulator suite runs against a `demo-*` project
  // that has no App Check backend and the emulators don't enforce App Check, so
  // initialising it there is pure noise. Enforcement itself is configured
  // server-side (monitor-first — see cloud-functions). Must run before any other
  // Firebase service is used so tokens attach to their requests.
  if (isNew && !useEmulators && appCheck?.siteKey) {
    if (appCheck.debugToken) {
      (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
        appCheck.debugToken;
    }
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheck.siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }

  if (isNew && usePersistentCache) {
    // Under emulators, also force long-polling — the e2e/dev PWA hits the same
    // gRPC Listen-stream corruption as the integration suite (#122/#199), which
    // surfaces as flaky cross-tab convergence (canon-sync aisle specs). Real
    // backends keep default gRPC streaming. (see the emulator branch below)
    initializeFirestore(app, {
      localCache: persistentLocalCache(),
      ...(useEmulators ? { experimentalForceLongPolling: true } : {}),
    });
  }

  if (useEmulators && !emulatorConnectedApps.has(app)) {
    const _env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
    const firestorePort = Number(_env['VITE_EMULATOR_FIRESTORE_PORT'] ?? 8080);
    const functionsPort = Number(_env['VITE_EMULATOR_FUNCTIONS_PORT'] ?? 5001);
    // Force long-polling for the emulator transport. The default gRPC streaming
    // Listen channel intermittently corrupts against the Firestore emulator —
    // bogus "RESOURCE_EXHAUSTED: Received message larger than max" framing
    // errors (a multi-GB phantom size) that poison the channel for the client's
    // lifetime, after which realtime subscriptions never deliver and the
    // integration suite times out. Long-polling sidesteps the streaming
    // transport entirely. Emulator-only — production keeps default gRPC. (#122)
    const db =
      isNew && !usePersistentCache
        ? initializeFirestore(app, { experimentalForceLongPolling: true })
        : getFirestore(app);
    connectFirestoreEmulator(db, '127.0.0.1', firestorePort);
    connectFunctionsEmulator(getFunctions(app, 'europe-west2'), '127.0.0.1', functionsPort);
    connectAuthEmulatorOnce(getAuth(app));
    emulatorConnectedApps.add(app);
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
