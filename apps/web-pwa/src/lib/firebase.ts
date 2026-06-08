import {
  initFirebase,
  createFirebaseAuth,
  type FirebaseOptions,
  type AppCheckConfig,
} from '@salt/firebase-sync';
import { createLDErrorReportingAdapter } from '@salt/ld-observability';

export const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';

// In emulator mode the SDK ignores credential values but still requires
// non-empty strings for apiKey/appId. Project IDs prefixed `demo-` keep
// the SDK strictly emulator-only (no real-network fallthrough).
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const options: FirebaseOptions = useEmulators
  ? {
      apiKey: 'emulator',
      authDomain: `${projectId}.firebaseapp.com`,
      projectId,
      storageBucket: `${projectId}.appspot.com`,
      messagingSenderId: '0',
      appId: 'emulator',
    }
  : {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };

// App Check (issue #145). Only configured for real backends; under emulators
// initFirebase skips it. The site key is public; the optional debug token is for
// unattested local/CI access to a real backend and must come from an untracked
// env / CI secret, never a committed/deployed value.
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
const appCheckDebugToken = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;
const appCheck: AppCheckConfig | undefined = appCheckSiteKey
  ? {
      siteKey: appCheckSiteKey,
      ...(appCheckDebugToken ? { debugToken: appCheckDebugToken } : {}),
    }
  : undefined;

initFirebase(options, useEmulators, !useEmulators, appCheck);

export const authProvider = createFirebaseAuth(createLDErrorReportingAdapter());
