import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/https';
import { RegenerateCanonIconInputSchema } from '@salt/domain/schemas';

// Manual regenerate / un-hide escape hatch (issue #148). Clearing `thumbnail`
// (→ null) re-fires onCanonItemWritten, whose icon branch then regenerates.
// Auth-gated: only signed-in callers may trigger (re)generation. "Hide"
// (setting the "hidden" sentinel) is a client-side write — it needs no server
// authority, so there is no hide callable.
//
// region is set explicitly (not via setGlobalOptions): this module is imported
// at the top of index.ts, so the onCall runs before index.ts's
// setGlobalOptions call — same reason the triggers pin their region inline.
export const regenerateCanonIcon = onCall({ region: 'europe-west2' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const parsed = RegenerateCanonIconInputSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid request payload.');
  }
  const { canonId, hint } = parsed.data;
  // Clear the icon (→ trigger regenerates) and carry the one-shot steer, if any.
  // No hint clears any stale hint so the regeneration is plain.
  await getFirestore()
    .collection('canonItems')
    .doc(canonId)
    .update({ thumbnail: null, iconHint: hint ? hint : FieldValue.delete() });
  return { ok: true } as const;
});
