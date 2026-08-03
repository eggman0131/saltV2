import { isCookable } from '../recipe/index.js';
import type { Recipe } from '../recipe/index.js';

// "Nobody has saved this yet" (issues #634, #682) — the standing review queue
// behind /mine.
//
// It started life as `isUnopenedImport`: a 24-hour, URL-imports-only recovery
// path for the share-sheet hole (a link shared into Salt is persisted server-side,
// but the draft the client routes you to lives in module memory, so an Android
// kill loses every pointer to a recipe sitting safely in Firestore). That hole is
// still covered; the predicate is simply no longer restricted to it.
//
// Two conditions, both load-bearing:
//  - `updatedAt === createdAt` — the entry has never been saved since it landed.
//    An editor save (the normal end of an import, and the normal end of a review)
//    bumps `updatedAt` and clears it from the queue. The onRecipeWritten
//    hero-image trigger deliberately does NOT stamp `updatedAt`, so a generated
//    image can't clear something nobody has looked at.
//  - `isCookable(kind)` — the capability gate, and the only reason this list is
//    usable on day one. Placeholders (a stock photograph attached to a night
//    planned in a sentence) and outings are written once and never edited, so
//    every one of them would sit in the queue for ever with nothing to review.
//    Per CLAUDE.md this asks the CAPABILITY, not the kind, and it asks it HERE so
//    the `kind` branch stays inside packages/domain.
//
// Note what the signal can and cannot say. Viewing a recipe writes nothing, so
// this means "nobody has SAVED it", never "nobody has opened it" — copy at the
// call site must match, and the clearing action ("open it and save") has to be
// spelled out because it is not guessable.
//
// No window and no clock: this is a queue, not a notification. A recipe imported
// and forgotten three weeks ago is the case most worth catching, which is exactly
// the one a 24-hour window threw away.
export function needsReview(recipe: Recipe): boolean {
  if (!isCookable(recipe.kind)) return false;
  return recipe.updatedAt === recipe.createdAt;
}
