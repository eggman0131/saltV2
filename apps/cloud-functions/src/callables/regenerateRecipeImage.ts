import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/https';
import { defineSecret } from 'firebase-functions/params';
import { RegenerateRecipeImageInputSchema } from '@salt/domain/schemas';
import { reportFlowError } from '../observability/reportServerError.js';

// Bound so an unexpected Firestore write failure here can be reported
// (posthog-node). Optional like elsewhere — reporting no-ops when unset.
const posthogApiKey = defineSecret('POSTHOG_API_KEY');

// Manual regenerate / un-hide escape hatch for the recipe hero (issue #148,
// Tier-2), mirroring regenerateCanonIcon. Clearing `image` (→ null) and stamping
// the `imageRequestedAt` nonce re-fires onRecipeWritten, whose image branch then
// regenerates. The nonce is load-bearing: when the recipe has no image yet
// `image` is *already* null, so writing null again is a no-op and Firestore emits
// no write event — the trigger never fires. A fresh `imageRequestedAt` guarantees
// the update always mutates the doc. Clearing `imageHidden` un-hides in the same
// write so a hidden recipe can be regenerated straight into view.
//
// Uses a callable rather than a client `setDoc` for two reasons: it is auth-gated
// (AI cost), and — critically — a partial `.update()` avoids the whole-document
// LWW clobber a client recipe write would risk against a concurrent trigger write.
// "Hide" needs no server authority, so it stays a plain client write (imageHidden
// = true) with no callable, exactly like the canon "hide".
//
// region is set explicitly (not via setGlobalOptions): this module is imported at
// the top of index.ts, so the onCall runs before index.ts's setGlobalOptions call
// — same reason the triggers pin their region inline. enforceAppCheck
// monitor-first (#145): allowed-but-reported now; flip to `true` alongside the
// index.ts callables at the enforcement step (this also fires AI image
// generation, so it is part of the cost surface App Check protects).
export const regenerateRecipeImage = onCall(
  {
    region: 'europe-west2',
    enforceAppCheck: false,
    secrets: [posthogApiKey],
    // 512MiB floor, pinned inline (top-imported, runs before setGlobalOptions —
    // same reason region is inline above).
    memory: '512MiB',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const parsed = RegenerateRecipeImageInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid request payload.');
    }
    const { recipeId, hint } = parsed.data;
    // Clear the image (→ trigger regenerates), un-hide, and carry the one-shot
    // steer if any. No hint clears any stale hint so the regeneration is plain.
    // imageRequestedAt forces the write to mutate the doc so the trigger fires
    // even when the recipe had no image (image already null) — see the header.
    try {
      await getFirestore()
        .collection('recipes')
        .doc(recipeId)
        .update({
          image: null,
          imageHidden: FieldValue.delete(),
          imageHint: hint ? hint : FieldValue.delete(),
          imageRequestedAt: Date.now(),
        });
    } catch (err) {
      // An unexpected Firestore write failure (StorageError-class) — report it
      // additively, flush, then re-throw so the callable's error path is
      // unchanged. The auth/validation guards above throw HttpsError before this.
      await reportFlowError(err);
      throw err;
    }
    return { ok: true } as const;
  },
);
