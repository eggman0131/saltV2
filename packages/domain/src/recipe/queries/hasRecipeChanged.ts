// Has the live recipe drifted from the snapshot some derived artefact took of it?
// A plain string inequality on `updatedAt` — any write to the recipe counts,
// because whatever was built from the recipe is now stale in a way this module
// cannot characterise.
//
// It takes TWO TIMESTAMPS rather than a document, because there is more than one
// kind of artefact that snapshots a recipe and each keeps the stamp under its own
// name: a cook session's `recipeUpdatedAtAtStart` (issue #556) and a guided plan's
// `recipeUpdatedAtAtSave` (issue #751). Each caller reads its own field and passes
// the string; the comparison itself exists once. It lives in the recipe module for
// the same reason — the question is about the RECIPE, not about either artefact.
//
// Absent inputs mean "nothing to compare yet" (still loading, or the recipe was
// deleted, or nothing has been snapshotted), which is NOT a change: the banner
// must not flash while the stores resolve.
export function hasRecipeChanged(
  stampedUpdatedAt: string | null | undefined,
  recipeUpdatedAt: string | null | undefined,
): boolean {
  // Presence, not truthiness, on BOTH sides: an empty `updatedAt` is a real (if
  // degenerate) value to compare, whereas null/undefined means there is nothing
  // on that side yet.
  if (stampedUpdatedAt === null || stampedUpdatedAt === undefined) return false;
  if (recipeUpdatedAt === null || recipeUpdatedAt === undefined) return false;
  return recipeUpdatedAt !== stampedUpdatedAt;
}
