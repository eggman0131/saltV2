import type { CookSessionDoc } from '../schemas/index.js';

// Has the live recipe drifted from the snapshot taken when the session started?
// A plain string inequality on `updatedAt` — any write to the recipe counts,
// because the cook's copy of the instructions is now stale in a way this module
// cannot characterise.
//
// Absent inputs mean "nothing to compare yet" (still loading, or the recipe was
// deleted), which is NOT a change: the banner must not flash while the stores
// resolve.
export function hasRecipeChanged(
  session: CookSessionDoc | null | undefined,
  recipeUpdatedAt: string | null | undefined,
): boolean {
  if (!session) return false;
  // Presence, not truthiness: an empty `updatedAt` is a real (if degenerate)
  // value to compare, whereas null/undefined means there is no recipe yet.
  if (recipeUpdatedAt === null || recipeUpdatedAt === undefined) return false;
  return recipeUpdatedAt !== session.recipeUpdatedAtAtStart;
}
