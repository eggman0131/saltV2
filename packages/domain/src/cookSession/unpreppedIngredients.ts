import { flattenIngredients } from '../recipe/index.js';
import type { Ingredient, Recipe } from '../recipe/index.js';
import type { GuidedPrepEntryDoc } from '../schemas/index.js';

// The ingredients a guided plan accounts for NOWHERE (issue #751, Phase 2) — what
// the guided prep screen lists under "Also get out".
//
// A plan is supposed to name every ingredient in exactly one prep job: in guided
// mode the prep list REPLACES the ingredient checklist, so an ingredient no job
// mentions is one the cook never sees. That invariant is ASKED FOR (the prompt
// demands it, the editor warns when it is broken) and nowhere ENFORCED — a recipe
// that gained an ingredient after its plan was written breaks it on its own, with
// nobody doing anything wrong. This is the remainder that falls out of it, and
// rendering it is what makes drift able to hide GUIDANCE but never an INGREDIENT.
//
// A SET DIFFERENCE OVER THE RECIPE, deliberately — the `miseProgress` direction.
// Iterating the plan instead would need the plan's ids to be unique and to still
// exist, and the schema guarantees neither: an entry may repeat an id another
// entry already claims, and may hold ids for ingredients edited out of the recipe
// long ago. Over the recipe, both fall out for free — a duplicate is just a
// second reason the same ingredient is accounted for, and a dangling id matches
// nothing and so removes nothing.
//
// Optional ingredients ARE included. Nothing in the plan schema says otherwise,
// and the section exists to be the floor that normal mise would have given: an
// optional ingredient appears in the ordinary ingredient checklist (`miseProgress`
// counts every item, optional or not), so it must appear here too. Whether to use
// it stays the cook's call, as it is on every other surface.
//
// Order is the recipe's own, so the remainder reads down the ingredient list.
//
// Takes the PREP LIST rather than the whole plan (issue #767): the step notes were
// never consulted, and `guidedPrepBoard` — which now owns this remainder as part
// of the screen it describes — is handed the prep list alone.
export function unpreppedIngredients(
  recipe: Recipe,
  prep: readonly GuidedPrepEntryDoc[],
): readonly Ingredient[] {
  const accountedFor = new Set(prep.flatMap((entry) => entry.ingredientIds));
  return flattenIngredients(recipe).filter((ingredient) => !accountedFor.has(ingredient.id));
}
