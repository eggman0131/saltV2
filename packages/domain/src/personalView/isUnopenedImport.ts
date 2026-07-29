import type { Recipe } from '../recipe/index.js';

/** How long a finished import stays worth surfacing. */
export const UNOPENED_IMPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

// "Finished importing, and nobody has touched it since" (issue #634, Phase 2).
//
// Since #616 a URL import is persisted server-side, but the client still holds
// the draft in module memory and routes you to the editor. Share a link into Salt,
// switch away while it runs, and the PWA gets killed: the recipe is safe in
// Firestore and every pointer to it is gone. This predicate is how it is found
// again — no event log, no read state, just a property of the document itself.
//
// Three conditions, each load-bearing:
//  - `source.type === 'url'` — only an IMPORT can be lost this way. A recipe typed
//    into the editor was, by definition, just looked at by the person who wrote it.
//  - `updatedAt === createdAt` — never edited since it landed. An editor save (the
//    normal end of the import flow) bumps `updatedAt` and retires the card. The
//    onRecipeWritten hero-image trigger deliberately does NOT stamp `updatedAt`,
//    so a generated image doesn't dismiss a recipe nobody has seen.
//  - inside the window — after a day it is no longer news; the recipe is simply in
//    the cookbook, findable the ordinary way.
//
// Pure — the clock is injected (CLAUDE.md Rule 1). A `createdAt` in the future
// (client clock skew) still counts as recent: `now - created` is negative, which
// is inside the window.
export function isUnopenedImport(
  recipe: Recipe,
  nowMs: number,
  windowMs: number = UNOPENED_IMPORT_WINDOW_MS,
): boolean {
  if (recipe.source?.type !== 'url') return false;
  if (recipe.updatedAt !== recipe.createdAt) return false;
  const createdMs = Date.parse(recipe.createdAt);
  if (Number.isNaN(createdMs)) return false;
  return nowMs - createdMs < windowMs;
}
