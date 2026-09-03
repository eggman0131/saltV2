// Shared meal-components prompt fragment for every flow that renders a recipe
// into a prompt (issue #838). A meal is a recipe pointing at other recipes
// (`componentRecipeIds`, issue #752), and until this existed every AI surface
// read a meal as an empty recipe with a title: the chef answered "what's this
// missing?" from nothing, and the art director photographed "Sunday roast" with
// no idea a bird, potatoes and gravy were hanging off it. The component READ and
// its RENDERING live here once so the two prompts cannot drift apart.
//
// SCOPE: reading + rendering the attached dishes, plus the two framings that wrap
// them. The framings are deliberately NOT interchangeable and must not be merged
// — the asymmetry here is load-bearing in a way the equipment one is not:
//   - MEAL_CHEF_FRAMING shows WHOLE DISHES. Gap-spotting ("nothing green here",
//     "both of those want the oven at 200 °C at once") IS a reading of
//     ingredients and methods, so the chef cannot do the job without them. As of
//     #934 the chef's dish is `formatRecipeForPrompt` under a `Dish N:` heading
//     rather than a thinner copy of it — the copy omitted tags, step timers and
//     notes, which is precisely the hole #890 closed one layer up.
//   - MEAL_LIBRARIAN_FRAMING shows NAMES, DESCRIPTIONS AND TIMES ONLY. authorRecipe
//     returns a COMPLETE RecipeDoc that `mergeAmendedRecipe` spreads over the
//     stored recipe, so an ingredient line it copies from a dish lands on the
//     meal — and the planner writes `[mealId, ...componentRecipeIds]` into a day
//     (`expandForPlanner`), so that line is then SHOPPED TWICE for one dinner.
//     Withholding the ingredient lists makes that impossible by construction
//     rather than by prompt wording. The librarian does not need them anyway: the
//     meal's own method is timing ("chicken in at 4:00, potatoes at 4:45"), which
//     needs how long each dish takes, not potato quantities.
//
// The invariant this module must never break is the one the whole meals feature
// rests on (`docs/recipe-module.md`, `packages/domain/src/recipe/queries/components.ts`):
//
//   NOTHING AGGREGATES, NOTHING RECURSES.
//
// Nothing here writes a component's content onto the meal document, and
// components resolve exactly ONE level — a component that is itself a meal
// contributes its own content and not its components, which is what keeps a
// reference cycle (A→B→A) inert and the read O(1) in the depth of the graph.
//
// No schema change backs this: `componentRecipeIds` already exists and every
// recipe already carries it.

import type { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { RecipeSchema } from '@salt/domain/schemas';
import type { RecipeDoc } from '@salt/domain/schemas';
import { recipePhaseTotals } from '@salt/domain';
import { formatRecipeForPrompt } from './recipeText.js';

/**
 * The component recipes of `recipe`, in stored order.
 *
 * Reproduces `resolveComponents` (`packages/domain/src/recipe/queries/components.ts`)
 * against Firestore. Cloud Functions have no in-memory recipes store, so the pure
 * helper — which takes an `allRecipes` array — cannot be reused without reading
 * the whole collection; this reproduces its three semantics directly instead:
 *
 *   - STORED ORDER IS PRESERVED. It is the user's drag order and the running order.
 *   - A MISSING OR INVALID DOC IS SKIPPED SILENTLY (the dangling-id contract). One
 *     dish fewer in a prompt, never a failed turn.
 *   - EXACTLY ONE LEVEL. A component's own `componentRecipeIds` are never followed.
 *
 * One batched `db.getAll`, and only when there is something to fetch — never a
 * per-component round trip and never a collection scan. Degrades to `[]` on any
 * failure at all (Rule 10), which leaves the caller with today's prompt.
 *
 * `flow` only labels the warn logs so the callers stay distinguishable.
 */
export async function readComponentContext(
  db: ReturnType<typeof getFirestore>,
  recipe: Pick<RecipeDoc, 'componentRecipeIds'>,
  flow: string,
): Promise<RecipeDoc[]> {
  const ids = recipe.componentRecipeIds;
  if (ids.length === 0) return [];
  try {
    const snaps = await db.getAll(...ids.map((id) => db.collection('recipes').doc(id)));
    const byId = new Map<string, RecipeDoc>();
    for (const doc of snaps) {
      if (!doc.exists) continue;
      const parsed = RecipeSchema.safeParse(doc.data());
      // A list read: skip the invalid doc rather than losing every dish.
      if (!parsed.success) continue;
      byId.set(doc.id, parsed.data);
    }
    // Re-index rather than trusting getAll's ordering, and drop the ids that
    // resolved to nothing — same outcome as the pure helper's find + filter.
    return ids.map((id) => byId.get(id)).filter((r): r is RecipeDoc => r !== undefined);
  } catch (err) {
    logger.warn(`${flow}: failed to read component recipes`, { err });
    return [];
  }
}

/**
 * One attached dish as the librarian may see it: what it is called, what it is,
 * and how long it takes. NEVER its ingredients and NEVER its steps — see the
 * header comment for why that omission is structural rather than stylistic.
 *
 * The timing earns its place because the meal's own method is a timing plan. It is
 * the dish's ELAPSED time, from the phase strip — the whole process, start to
 * serve, which is the same figure the cook plan's start clock is worked back from
 * (issue #1233). A dish with no strip contributes no timing line rather than a
 * fabricated one.
 */
function renderComponentForLibrarian(r: RecipeDoc, ordinal: number): string {
  const parts = [`Dish ${ordinal}: ${r.title}`];
  if (r.description) parts.push(`Description: ${r.description}`);
  const totals = recipePhaseTotals(r.metadata.phases);
  if (totals.hasPhases) parts.push(`takes: ${totals.elapsedMinutes} min start to serve`);
  return parts.join('\n');
}

// ─── Chef framing (chefChat) ─────────────────────────────────────────────────
//
// The chef sees whole dishes and is asked for the two things the user cannot get
// by looking at the cards themselves: what the dinner is MISSING, and the
// COORDINATION that belongs to no single dish. Listing what is attached is worth
// nothing — they are looking at the same list.
//
// A `###` heading, not `##`: this section is appended to the recipe body inside
// chefChat's `## Current recipe` / `## Starting point for a NEW dish` section, so
// it must nest under the dish it belongs to rather than break out of it.
const MEAL_CHEF_FRAMING = `### The dishes this meal is made of
This recipe is a MEAL: a single dinner built from the separate dishes below, each of which is \
its own recipe with its own page, its own shopping and its own cooking. They are listed in the \
order the user arranged them, which is roughly the order things start.

Read them TOGETHER, as one dinner rather than a list, and use them for two things:

1. WHAT IS MISSING. Judge the meal as a whole plate and say plainly what it wants. Chicken and \
potatoes and nothing green. Three dishes that all want the oven at a different temperature at \
the same time. A dry cut with no sauce. A rich plate with nothing sharp to cut through it. A \
pudding that repeats the flavour of the main. Name the gap, say why it matters, and suggest \
what would fill it.
2. THE COORDINATION. A dinner needs a method no single dish holds: what goes in when so \
everything lands together, what rests while what finishes, what can be done the morning of, \
what gets made in the tin something else has just come out of, and where the oven or the hob is \
genuinely double-booked. Work it out from the times and methods below and write it as a plan \
with actual clock offsets ("chicken in at 4:00, potatoes at 4:45"), not a vague ordering.

The meal's OWN ingredients and steps are for what belongs to the dinner as a whole — the gravy \
made from the roasting juices, the timing plan that runs the dishes together. They are NEVER a \
copy of a dish's own ingredients or steps: each dish is already shopped and cooked from its own \
page, so repeating its lines here would buy and cook it twice. If the meal needs something none \
of the dishes provide, that is a new ingredient of the meal's own and belongs to it.`;

// ─── Librarian framing (authorRecipe) ────────────────────────────────────────
//
// The librarian gets names, descriptions and times ONLY, and this framing is
// deliberately the opposite shape to the chef's: recognition and preservation,
// never licence to fold a dish into the meal. authorRecipe is a temperature-0
// transcriber returning a complete RecipeDoc that is spread over the stored
// recipe, so copying a component's ingredient line onto the meal double-shops the
// dinner (see the header comment). Not showing it the lists is the guard; this
// wording is the belt to that braces.
// The heading deliberately avoids the equipment framing's "RECOGNITION ONLY"
// wording: both sections can be in the same prompt at once, and two headings
// sharing a phrase makes every prompt assertion about either one ambiguous.
const MEAL_LIBRARIAN_FRAMING = `### Dishes attached to this recipe (NAMES AND TIMES ONLY)
This recipe is a MEAL: a dinner made of the separate dishes below. Each one is its own recipe \
with its own page — they are listed for ONE reason, so you recognise their names when they \
appear in the conversation and can write about the dinner as a whole. Their ingredients and \
steps are deliberately NOT shown to you.

- NEVER copy a dish's ingredients or steps into this recipe, and never invent them. Each dish is \
shopped and cooked from its own page, and a planned dinner attaches the meal AND its dishes — so \
an ingredient line copied here is bought TWICE for one meal.
- This recipe's OWN ingredients and steps are only what belongs to the meal as a whole: something \
made from what the dishes leave behind, or the timing plan that runs them together. If the \
conversation gives this recipe a method of clock times and running order, that IS its method — \
transcribe it as written.
- PRESERVE the dish names exactly as they appear here when the conversation refers to them.`;

/**
 * The chef's meal section, or '' when there are no components to show — so a
 * recipe that is not a meal produces a byte-for-byte unchanged prompt.
 */
export function componentSectionForChef(components: readonly RecipeDoc[]): string {
  if (components.length === 0) return '';
  // `formatRecipeForPrompt` under a `Dish N:` heading, NOT a rendering of its own
  // (issue #934, finding A5-007). There used to be a thinner copy here — no tags,
  // no step timers, no notes — which is the exact hole #890 closed one layer up
  // and re-opened one layer down: a chef shown no timer on a component dish hands
  // back a meal whose dishes have lost their timings, and nothing notices.
  //
  // The heading carries the ordinal AND the title, the same shape the librarian's
  // section uses: the dishes are in the meal's stored order, which is roughly the
  // order things start. Only the librarian framing tells the model to "PRESERVE
  // the dish names exactly as they appear here" as an explicit instruction — the
  // chef framing carries no such sentence — so here it is the repeated heading
  // itself, not a matching instruction, that states the ordinal-to-name binding
  // in one line rather than leaving it to be inferred from the `Title:` line the
  // shared rendering opens with.
  //
  // The librarian's rendering below deliberately does NOT converge on this one;
  // its omission of ingredients and steps is structural. See its docstring.
  const dishes = components
    .map((r, i) => `Dish ${i + 1}: ${r.title}\n${formatRecipeForPrompt(r)}`)
    .join('\n\n');
  return `${MEAL_CHEF_FRAMING}\n\n${dishes}`;
}

/**
 * The librarian's meal section, or '' when there are no components to show.
 */
export function componentSectionForLibrarian(components: readonly RecipeDoc[]): string {
  if (components.length === 0) return '';
  const dishes = components.map((r, i) => renderComponentForLibrarian(r, i + 1)).join('\n\n');
  return `${MEAL_LIBRARIAN_FRAMING}\n\n${dishes}`;
}
