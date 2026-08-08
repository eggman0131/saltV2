import { prepEntryForContainer } from './prepEntryForContainer.js';
import type { GuidedPrepEntryDoc, GuidedStepNoteDoc, IngredientDoc } from '../schemas/index.js';

// The ingredients a guided step introduces that came out of NO bowl it names
// (issue #761, Phase 1) — the "➕ 100ml red wine" line, sitting beside the bowl
// the step reaches for.
//
// Plain cook mode reprints every ingredient at the step that first uses it, and
// the governing rule of this issue is that guided mode never shows less. Guided
// mode's version of that list is not simply the first-use list, because the bowl
// row above it is already showing part of it: an ingredient that went into the
// container this step is reaching for would otherwise be printed twice on the
// same screen, once as "in the onion bowl" and once loose. This is the first-use
// list with exactly that overlap removed.
//
// EXACTLY ONE ENTRY IS SUBTRACTED — the one this step's own note names. Not every
// prep entry in the plan, which would be the easy over-reach and would silently
// re-introduce the very defect: an ingredient prepped into a DIFFERENT container,
// or into no container at all (`container: null` — "open the tin of tomatoes"),
// is not on this screen anywhere else, and plain cook mode prints it here. Being
// prepped is not the same as being visible.
//
// Takes the step's ALREADY-GROUPED first-use list rather than the recipe, because
// the caller holds `firstUseByStep(...)` as one map for the whole cook — that is
// the only first-use calculation there is, and re-deriving it per step would be
// both waste and a second answer to the same question waiting to disagree.
//
// It resolves the container entry ITSELF rather than taking one, which is what
// collapses the three "subtract nothing" cases — no note at all, a note naming no
// container, a container no job fills — into a single `null` from
// `prepEntryForContainer`, and guarantees the name is normalised once, by the one
// function that owns that decision.
export function looseIngredientsForStep(
  firstUseAtStep: readonly IngredientDoc[],
  prep: readonly GuidedPrepEntryDoc[],
  note: GuidedStepNoteDoc | null,
): readonly IngredientDoc[] {
  const entry = prepEntryForContainer(prep, note?.container ?? null);
  if (entry === null) return firstUseAtStep;
  const inTheBowl = new Set(entry.ingredientIds);
  return firstUseAtStep.filter((ingredient) => !inTheBowl.has(ingredient.id));
}
