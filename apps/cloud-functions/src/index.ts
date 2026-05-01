import { initializeApp } from 'firebase-admin/app';
import { defineSecret } from 'firebase-functions/params';
import { onCallGenkit, isSignedIn } from 'firebase-functions/https';
import { embedTextFlow } from './flows/embedText.js';

initializeApp();

const geminiApiKey = defineSecret('GEMINI_API_KEY');

export const embedText = onCallGenkit(
  {
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  embedTextFlow,
);
