import { HttpsError } from 'firebase-functions/https';
import { defineSecret } from 'firebase-functions/params';
import { RegenerateCanonIconInputSchema } from '@salt/domain/schemas';
import { makeCallable } from '../tracedCallable.js';
import { requestIconRegeneration } from './requestIconRegeneration.js';

// Bound so an unexpected Firestore write failure here can be reported
// (posthog-node). Optional like elsewhere — reporting no-ops when unset.
const posthogApiKey = defineSecret('POSTHOG_API_KEY');

// Manual regenerate / un-hide escape hatch (issue #148). The write itself — and
// the reason the `iconRequestedAt` nonce is load-bearing — lives in
// `requestIconRegeneration`, shared with the product-form twin (issue #871).
// Auth-gated: only signed-in callers may trigger (re)generation. "Hide"
// (setting the "hidden" sentinel) is a client-side write — it needs no server
// authority, so there is no hide callable.
//
// region is set explicitly (not via setGlobalOptions): this module is imported
// at the top of index.ts, so the onCall runs before index.ts's
// setGlobalOptions call — same reason the triggers pin their region inline.
// App Check rides in from the shared APP_CHECK_ENFORCEMENT constant (#718) — this
// also fires AI image generation, so it is part of the cost surface App Check
// protects, and it must flip with everything else rather than on its own.
export const regenerateCanonIcon = makeCallable({
  options: {
    region: 'europe-west2',
    secrets: [posthogApiKey],
    // 512MiB floor, pinned inline (top-imported, runs before setGlobalOptions —
    // same reason region is inline above).
    memory: '512MiB',
  },
  handler: async (request) => {
    const parsed = RegenerateCanonIconInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid request payload.');
    }
    const { canonId, hint } = parsed.data;
    await requestIconRegeneration('canonItems', canonId, hint);
    return { ok: true } as const;
  },
});
