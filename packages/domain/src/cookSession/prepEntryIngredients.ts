import { flattenIngredients } from '../recipe/index.js';
import type { Ingredient, Recipe } from '../recipe/index.js';
import type { GuidedPrepEntryDoc } from '../schemas/index.js';

// The recipe ingredients one prep job actually prepares (issue #761, Phase 1) —
// what turns "finely slice the red onion" into "finely slice the red onion / 1 red
// onion", and what fills in the contents of a bowl a step names.
//
// The whole defect this answers is that guided mode was the one surface in Salt
// that never said HOW MUCH. The plan's job text deliberately carries no
// quantities (the prompt strips them, and rightly: an amount baked into a
// sentence cannot be re-scaled or corrected), so the amount has to come from the
// recipe. `ingredientIds` is the link, and it has been there since the plan
// schema shipped — this is a rendering that was missing, not data that was.
//
// A SET OVER THE RECIPE, deliberately — the same direction, and for the same
// three reasons, as `unpreppedIngredients`. Iterating the entry's ids instead
// would need them to be unique and to still exist, and the schema guarantees
// neither: an entry may list the same id twice, and may hold ids for ingredients
// edited out of the recipe long ago. Over the recipe, both fall out for free — a
// duplicate id matches the one ingredient once, and a dangling id matches nothing
// and so contributes nothing. It also hands back RECIPE ORDER rather than the
// order the model happened to write the ids in, so a job's ingredients read down
// the page in the same sequence the cook meets them everywhere else.
//
// The entry is NULLABLE so the call can be chained straight off
// `prepEntryForContainer` — "the contents of the bowl this step names" is one
// expression, and a step that names a bowl no job fills has empty contents rather
// than a branch at every call site.
export function prepEntryIngredients(
  recipe: Recipe,
  entry: GuidedPrepEntryDoc | null,
): readonly Ingredient[] {
  if (entry === null) return [];
  const wanted = new Set(entry.ingredientIds);
  if (wanted.size === 0) return [];
  return flattenIngredients(recipe).filter((ingredient) => wanted.has(ingredient.id));
}
