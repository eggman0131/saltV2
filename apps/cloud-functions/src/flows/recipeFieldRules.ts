import { CATEGORY_TAG_RULES } from './categoryTags.js';
import { INGREDIENT_SUBSTITUTION_RULES } from './ingredientConversions.js';
import { STEP_RULES, FIRST_USE_ORDINAL_RULE } from './stepRules.js';

// THE field-rule policy for every recipe-AUTHORING path (issue #785): the URL
// import (extractRecipeFromUrl, both its JSON-LD and HTML prompts), the photo
// import (extractRecipeFromPhoto) and the librarian (authorRecipe, which covers
// create, edit and variation chats).
//
// It began as extraction-only (`recipeExtractionRules.ts`, two exported consts)
// while the librarian carried a hand-rolled twin of the same field list. Four of
// the five top-level bullets were byte-identical and the two blocks had drifted
// in BOTH directions, which is exactly what CATEGORY_TAG_RULES,
// INGREDIENT_SUBSTITUTION_RULES and STEP_RULES were each pulled out to prevent —
// the extraction just stopped one layer short of the block around them.
//
// ONE genuine difference survives, and it is a NAMED ARGUMENT rather than two
// prose blocks that happen to disagree:
//
//   measures: 'metricate' — the source is a finished recipe in someone else's
//     WORDING (a web page, a cookbook page). Rewriting the line into a clean,
//     British, metric one is the entire point.
//   measures: 'preserve' — the source is the conversation the user is looking
//     at. The chef just said "a teaspoon of cumin"; rewriting that inside the
//     same turn makes the saved recipe stop matching the words on screen, which
//     reads as the librarian ignoring them.
//
// NOTE what that argument does NOT decide any more: the UNITS. MEASURE_RULES is
// unconditional — every path emits grams, millilitres or a count, and every path
// keeps tsp/tbsp verbatim for the parse stage. `measures` now governs only how
// freely the LINE may be rewritten around those units.
//
// Everything else is unconditional, including the two ingredient-hygiene rules
// (commit to one ingredient, split a combined line) — a "salt and freshly ground
// black pepper" line off a website is exactly as unmatchable as one from a chat.
// They already reach both paths, because they live inside
// INGREDIENT_SUBSTITUTION_RULES.
//
// The result slots into a prompt as two whole sections, so the heading levels and
// the bullet indentation below are load-bearing. Pinned by
// recipeFieldRules.test.ts plus a per-flow test on each of the three paths.

export type MeasurePolicy = 'preserve' | 'metricate';

export function recipeFieldRules({ measures }: { measures: MeasurePolicy }): string {
  return `${conversionRules()}

${fields(measures)}`;
}

// The unit vocabulary, and it is UNCONDITIONAL — a recipe this app wrote is in
// grams, millilitres or counts whether it came off a web page or out of a chat.
//
// The spoon exception is the load-bearing half, and it is a PIPELINE fact rather
// than a preference. `assembleRecipeDraft` feeds the rawText emitted here into
// `parseRecipeIngredientsFlow`, which is what turns "1 tsp" into
// `quantity: 2, unit: 'g'` AND sets `displayText: '1 tsp'` — the bracketed form
// `IngredientText.svelte` renders as "2g whole black peppercorns (1 tsp)". Parse
// never sees the original source line, only this rawText, so a prompt that
// metricates the spoon itself here doesn't move the tsp into the bracket: it
// deletes it, and parse then correctly emits `displayText: null` because the line
// it was handed was already in grams. The instruction to convert tablespoons and
// teaspoons used to sit in the 'metricate' bullet for exactly that reason, and it
// is why imports lost their spoon measures while chat-authored recipes kept them.
const MEASURE_RULES = `- Metric or count values only: grams/kilograms for weight, millilitres/litres for liquid, or a plain \
count of the thing as it is bought ("2 cloves garlic", "1 tin chopped tomatoes", "3 eggs"). NEVER cups, \
sticks, pints, quarts, fluid ounces, ounces or pounds — convert them, and never introduce one the source \
did not use.
- tsp and tbsp are the ONE exception: leave a spoon measure EXACTLY as the source wrote it ("1 tsp \
ground cumin", "½ tbsp honey"). Do NOT convert it to grams or millilitres yourself. A later stage does \
that conversion and keeps the spoon as the bracketed form the cook reads — "2g whole black peppercorns \
(1 tsp)" — so converting it here is what DESTROYS it.`;

function conversionRules(): string {
  // None of these is a measure the chef chose, so preserving the source's wording
  // preserves nothing worth keeping — an app that writes recipes in British
  // English and metric writes them that way from a chat as much as from a URL.
  return `## Conversion rules (apply to EVERYTHING)
${MEASURE_RULES}
- Temperatures in °C only — never Fahrenheit; convert and round sensibly (e.g. 350°F → 180°C).
${INGREDIENT_SUBSTITUTION_RULES}
- Use British spelling everywhere (e.g. "flavour", "colour", "caramelise").`;
}

function fields(measures: MeasurePolicy): string {
  return `## Fields
- title: clear, concise recipe name.
- description: 1–2 sentence summary, or null.
- servings: integer portions, or null if not stated.
- totalTimeMinutes/prepTimeMinutes/cookTimeMinutes: integers in minutes, or null.
${CATEGORY_TAG_RULES}
- ingredientGroups: group ingredients by course/stage (null name = default group).
  Each ingredient: ${rawTextClause(measures)}, isOptional (true only if explicitly optional), \
${FIRST_USE_ORDINAL_RULE}
${STEP_RULES}
- notes: the author's overall notes/tips, or null.`;
}

// The one clause the source kind actually changes — how freely the LINE may be
// rewritten, not what units it lands in (MEASURE_RULES settles that for both).
// Under 'preserve' it also has to say which rules BEAT preservation: the measure
// and ingredient-hygiene rules above are unconditional, and without the
// precedence sentence "preserve the original wording" reads as a licence to keep
// "1 cup heavy cream" and "salt and pepper".
function rawTextClause(measures: MeasurePolicy): string {
  if (measures === 'metricate') {
    return `rawText (the ingredient line rewritten in British spelling/terms and the units the measure \
rules above allow — this is what the rest of the pipeline parses, so write a clean natural line e.g. \
"240ml whole milk", "2 cloves garlic, crushed" or "1 tsp ground cumin")`;
  }
  return `rawText (preserve the original wording and any tsp/tbsp measures the chef used, EXCEPT \
where the conversion rules above take precedence — always use the measure rules' units (never a cup, \
pint or ounce, however the chef phrased it), always use the British ingredient NAMES (e.g. "double \
cream" not "heavy cream"), commit to a single ingredient rather than an either-or choice, and split any \
line that combines two distinct ingredients into two separate ingredients ("Salt and freshly ground \
black pepper" → two ingredients). These override "preserve the original wording")`;
}
