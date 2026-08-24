import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/https';
import { defineSecret } from 'firebase-functions/params';
import { RedoRecipeKitInputSchema } from '@salt/domain/schemas';
import { makeCallable } from '../tracedCallable.js';
import { reportFlowError } from '../observability/reportServerError.js';

// Bound so an unexpected Firestore write failure here can be reported
// (posthog-node). Optional like elsewhere — reporting no-ops when unset.
const posthogApiKey = defineSecret('POSTHOG_API_KEY');

// "Redo kit" (issue #882) — the manual escape hatch for the kit branch of
// onRecipeWritten, mirroring regenerateCanonIcon. It does no work itself: it
// CLEARS the `kitInferredAt` stamp and bumps the `kitRequestedAt` nonce in one
// write, and the trigger's `kitNeedsInference` guard re-fires on that transition.
//
// Both halves are needed, and they are canon's two halves exactly.
// `regenerateCanonIcon` nulls `thumbnail` (the answer, which is also the guard)
// AND bumps `iconRequestedAt` (so the write is never a no-op). Here `kitInferredAt`
// is the guard and `kitRequestedAt` is the nonce. Clearing the stamp alone would be
// a no-op on a recipe that had never been inferred — nothing to delete, no write
// event, no retry — which is precisely the failed-inference case the redo exists
// to rescue.
//
// The nonce is load-bearing for exactly the reason `regenerateCanonIcon` spells
// out at its own head: Firestore emits no write event for a no-op update, so a
// recipe that already has a kit has nothing about it to change and the trigger
// would never see the request. A fresh epoch-ms stamp guarantees the write
// mutates the document. It is also why the guard cannot be "is `kit` empty" — see
// RecipeSchema's `kitInferredAt` note.
//
// A callable rather than a client `setDoc` for the same two reasons regenerating
// a hero is one: it is auth-gated because it costs an AI call, and — critically —
// a partial `.update()` avoids the whole-document LWW clobber a client recipe
// write would risk against a concurrent trigger write. Note it deliberately does
// NOT clear `kit` itself, only the stamp above it: leaving the old list in place
// means the strip on the recipe page keeps showing something useful while the new
// answer is computed, and the trigger overwrites the field wholesale when it lands.
//
// region is set explicitly (not via setGlobalOptions): this module is imported at
// the top of index.ts, so the onCall runs before index.ts's setGlobalOptions call
// — same reason the triggers pin their region inline. App Check rides in from the
// shared APP_CHECK_ENFORCEMENT constant (#718) — this fires an AI call, so it is
// part of the cost surface App Check protects and must flip with everything else
// rather than on its own.
export const redoRecipeKit = makeCallable({
  options: {
    region: 'europe-west2',
    secrets: [posthogApiKey],
    // 512MiB floor, pinned inline (top-imported, runs before setGlobalOptions —
    // same reason region is inline above).
    memory: '512MiB',
  },
  handler: async (request) => {
    const parsed = RedoRecipeKitInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid request payload.');
    }
    await getFirestore()
      .collection('recipes')
      .doc(parsed.data.recipeId)
      .update({ kitInferredAt: FieldValue.delete(), kitRequestedAt: Date.now() });
    return { ok: true } as const;
  },
});
