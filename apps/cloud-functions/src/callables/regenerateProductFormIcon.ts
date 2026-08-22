import { onCall, HttpsError } from 'firebase-functions/https';
import { defineSecret } from 'firebase-functions/params';
import { RegenerateProductFormIconInputSchema } from '@salt/domain/schemas';
import { APP_CHECK_ENFORCEMENT } from '../tracedCallable.js';
import { requestIconRegeneration } from './requestIconRegeneration.js';

// Bound so an unexpected Firestore write failure here can be reported
// (posthog-node). Optional like elsewhere — reporting no-ops when unset.
const posthogApiKey = defineSecret('POSTHOG_API_KEY');

// Manual regenerate / un-hide escape hatch for a product form's icon (issue
// #871) — the exact twin of regenerateCanonIcon, sharing its write via
// `requestIconRegeneration` (which is also where the `iconRequestedAt` nonce is
// explained). Auth-gated: only signed-in callers may trigger (re)generation.
// "Hide" stays a client-side write here too — it needs no server authority, so
// there is no hide callable.
//
// region is pinned inline for the same reason as its canon twin: this module is
// imported at the top of index.ts, so the onCall is constructed before
// index.ts's setGlobalOptions call. App Check rides in from the shared
// APP_CHECK_ENFORCEMENT constant (#718) — this fires AI image generation, so it
// belongs to the same cost surface App Check protects and must flip with it.
export const regenerateProductFormIcon = onCall(
  {
    ...APP_CHECK_ENFORCEMENT,
    region: 'europe-west2',
    secrets: [posthogApiKey],
    memory: '512MiB',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const parsed = RegenerateProductFormIconInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid request payload.');
    }
    const { formId, hint } = parsed.data;
    await requestIconRegeneration('productForms', formId, hint);
    return { ok: true } as const;
  },
);
