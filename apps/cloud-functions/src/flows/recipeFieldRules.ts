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
//     units (a web page, a cookbook page). Converting is the entire point, and
//     `ParsedIngredient.displayText` keeps "½ tsp" readable after the amount is
//     metricated.
//   measures: 'preserve' — the source is the conversation the user is looking
//     at. The chef just said "a teaspoon of cumin"; metricating that to 5g inside
//     the same turn makes the saved recipe stop matching the words on screen,
//     which reads as the librarian ignoring them.
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
  return `${conversionRules(measures)}

${fields(measures)}`;
}

function conversionRules(measures: MeasurePolicy): string {
  // Temperature, ingredient names and spelling convert on EVERY path — none of
  // them is a measure the chef chose, so preserving their wording preserves
  // nothing worth keeping. Only the quantity bullet is conditional.
  const metric =
    measures === 'metricate'
      ? `\n- Metric only: convert all quantities to metric. Volumes in millilitres/litres, weights in \
grams/kilograms. Convert cups, sticks, ounces, pounds, fluid ounces, tablespoons and teaspoons.`
      : '';

  return `## Conversion rules (apply to EVERYTHING)${metric}
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

// The one clause the source kind actually changes. Under 'preserve' it also has
// to say which rules BEAT preservation: the ingredient-hygiene rules above are
// unconditional, and without the precedence sentence "preserve the original
// wording" reads as a licence to keep "heavy cream" and "salt and pepper".
function rawTextClause(measures: MeasurePolicy): string {
  if (measures === 'metricate') {
    return `rawText (the ingredient line, already converted to metric + British spelling/terms — \
this is what the rest of the pipeline parses, so write a clean natural line e.g. "240ml whole milk" or \
"2 cloves garlic, crushed")`;
  }
  return `rawText (preserve the original wording and any tsp/tbsp/cup measures the chef used, EXCEPT \
where the conversion rules above take precedence — always use the British ingredient NAMES (e.g. \
"double cream" not "heavy cream"), commit to a single ingredient rather than an either-or choice, and \
split any line that combines two distinct ingredients into two separate ingredients ("Salt and freshly \
ground black pepper" → two ingredients). These override "preserve the original wording")`;
}
