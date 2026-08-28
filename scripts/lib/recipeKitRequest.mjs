// The one piece of scripts/backfill-recipe-kit.mjs worth a test of its own
// (issue #954 phase 3): what a request write actually sends. The script
// self-executes on import — it parses argv, reaches `gcloud` and the network at
// top level — so it has no seam otherwise; this is pulled out where a test can
// reach it, the same reason scripts/lib/recipeTimesEstimated.mjs and
// scripts/lib/ttlMigrationPlan.mjs exist (their headers explain why).
//
// `scripts/` is outside the layer map: plain node ESM run from the repo root,
// resolving nothing from `apps/` or `packages/`. This module keeps that — it
// imports nothing at all.

// ─── Why a redo needs a DIFFERENT write, not just a louder nonce ──────────────
//
// The times backfill's `--redo` bumps `timesRequestedAt` alone and that is
// sufficient, because `timesNeedEstimate` compares the stamp to the nonce. Kit's
// guard does not compare: `kitNeedsInference`'s FIRST line is
//
//     if (after.kitInferredAt !== undefined) return false;   // already answered
//
// (apps/cloud-functions/src/triggers/onRecipeWritten.ts). So on an
// already-inferred recipe a bumped `kitRequestedAt` re-fires the trigger and the
// guard immediately declines — the write costs a trigger invocation and buys
// nothing. Re-inference requires the stamp to be GONE, which is precisely what
// the `redoRecipeKit` callable does (`kitInferredAt: FieldValue.delete()` plus a
// fresh `kitRequestedAt`), and this mirrors that callable field for field.
//
// Both halves are load-bearing, and they are `redoRecipeKit`'s two halves:
//
//   - DELETE `kitInferredAt` — otherwise the guard's first line stops the branch.
//   - BUMP `kitRequestedAt`  — otherwise, on a recipe that was already unstamped
//     (a first pass, or one whose last inference failed), deleting an absent
//     field is a no-op, Firestore emits no write event for a no-op update, and
//     the trigger never sees the request at all.
//
// ─── How the delete is expressed over REST ────────────────────────────────────
//
// There is no `FieldValue.delete()` sentinel in the REST encoding. A field named
// in `updateMask.fieldPaths` but ABSENT from the request body is deleted — that
// asymmetry is the whole mechanism, and it is why the two halves of the return
// value are built together here rather than at the call site, where "add it to
// the mask" and "leave it out of the body" are two edits a reader would have to
// connect for themselves.

/**
 * The masked PATCH one recipe's kit request sends.
 *
 * @param {number} now epoch ms for the nonce (the caller passes `Date.now()`).
 * @param {boolean} redo when true, also clear `kitInferredAt` so the trigger's
 *   guard re-fires on an already-answered recipe.
 * @returns {{ fieldPaths: string[], fields: Record<string, unknown> }}
 *   `fieldPaths` goes on the query string as `updateMask.fieldPaths`; `fields`
 *   is the request body. A path in the first and not the second is a delete.
 */
export function planKitRequest(now, redo) {
  // Firestore's REST encoding wants integers as strings; the field reads back as
  // a plain number. Same shape the trigger's own `Date.now()` stamp takes.
  const fields = { kitRequestedAt: { integerValue: String(now) } };
  return {
    fieldPaths: redo ? ['kitInferredAt', 'kitRequestedAt'] : ['kitRequestedAt'],
    fields,
  };
}
