import { initializeApp } from 'firebase-admin/app';
import { defineSecret } from 'firebase-functions/params';
import { onCallGenkit, isSignedIn } from 'firebase-functions/https';
import { embedTextFlow } from './flows/embedText.js';
import { arbitrateCanonFlow } from './flows/arbitrateCanon.js';
import { onCanonItemWritten } from './triggers/onCanonItemWritten.js';
import { onAislesWritten } from './triggers/onAislesWritten.js';
import { initManifest } from './triggers/initManifest.js';

initializeApp();

const geminiApiKey = defineSecret('GEMINI_API_KEY');

export const embedText = onCallGenkit(
  {
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  embedTextFlow,
);

export const arbitrateCanon = onCallGenkit(
  {
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  arbitrateCanonFlow,
);

export { onCanonItemWritten, onAislesWritten, initManifest };
