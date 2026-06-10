import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/https';
import { RegenerateCanonIconInputSchema } from '@salt/domain/schemas';

// Manual regenerate / un-hide escape hatch (issue #148). Setting `thumbnail`
// (→ null) and stamping the `iconRequestedAt` nonce re-fires onCanonItemWritten,
// whose icon branch then regenerates. The nonce is load-bearing: when the item
// has no icon yet `thumbnail` is *already* null, so writing null again is a
// no-op and Firestore emits no write event — the trigger never fires. A fresh
// `iconRequestedAt` guarantees the update always mutates the doc.
// Auth-gated: only signed-in callers may trigger (re)generation. "Hide"
// (setting the "hidden" sentinel) is a client-side write — it needs no server
// authority, so there is no hide callable.
//
// region is set explicitly (not via setGlobalOptions): this module is imported
// at the top of index.ts, so the onCall runs before index.ts's
// setGlobalOptions call — same reason the triggers pin their region inline.
// enforceAppCheck monitor-first (#145): allowed-but-reported now; flip to `true`
// alongside the index.ts callables at the enforcement step (this also fires AI
// image generation, so it is part of the cost surface App Check protects).
export const regenerateCanonIcon = onCall(
  { region: 'europe-west2', enforceAppCheck: false },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const parsed = RegenerateCanonIconInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid request payload.');
    }
    const { canonId, hint } = parsed.data;
    // Clear the icon (→ trigger regenerates) and carry the one-shot steer, if any.
    // No hint clears any stale hint so the regeneration is plain. iconRequestedAt
    // forces the write to mutate the doc so the trigger fires even when the item
    // had no icon (thumbnail already null) — see the header note.
    await getFirestore()
      .collection('canonItems')
      .doc(canonId)
      .update({
        thumbnail: null,
        iconHint: hint ? hint : FieldValue.delete(),
        iconRequestedAt: Date.now(),
      });
    return { ok: true } as const;
  },
);
