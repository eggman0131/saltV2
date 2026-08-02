import { CATEGORY_TAG_RULES } from './categoryTags.js';
import { INGREDIENT_SUBSTITUTION_RULES } from './ingredientConversions.js';
import { STEP_RULES, FIRST_USE_ORDINAL_RULE } from './stepRules.js';

// Shared conversion + field rules for every recipe EXTRACTION path — the URL
// import (extractRecipeFromUrl, both its JSON-LD and HTML prompts) and the photo
// import (extractRecipeFromPhoto).
//
// They lived as module-private consts in extractRecipeFromUrl.ts until the photo
// import needed the same wording. Copying them would have been the exact drift
// CATEGORY_TAG_RULES, INGREDIENT_SUBSTITUTION_RULES and STEP_RULES were each
// pulled out to prevent: the whole point of these two blocks is that a recipe
// converts to metric and British spelling identically whichever way it entered
// the app, and two copies is one edit away from that stopping being true.
//
// Both slot into a prompt as sections, so the heading levels and the bullet
// indentation below are load-bearing.

export const CONVERSION_RULES = `## Conversion rules (apply to EVERYTHING)
- Metric only: convert all quantities to metric. Volumes in millilitres/litres, weights in grams/kilograms. \
Convert cups, sticks, ounces, pounds, fluid ounces, tablespoons and teaspoons. Temperatures in °C only — \
never Fahrenheit; convert and round sensibly (e.g. 350°F → 180°C).
${INGREDIENT_SUBSTITUTION_RULES}
- Use British spelling everywhere (e.g. "flavour", "colour", "caramelise").`;

export const FIELD_RULES = `## Fields
- title: clear, concise recipe name.
- description: 1–2 sentence summary, or null.
- servings: integer portions, or null if not stated.
- totalTimeMinutes/prepTimeMinutes/cookTimeMinutes: integers in minutes, or null.
${CATEGORY_TAG_RULES}
- ingredientGroups: group ingredients by course/stage (null name = default group).
  Each ingredient: rawText (the ingredient line, already converted to metric + British spelling/terms — \
this is what the rest of the pipeline parses, so write a clean natural line e.g. "240ml whole milk" or \
"2 cloves garlic, crushed"), isOptional (true only if explicitly optional), \
${FIRST_USE_ORDINAL_RULE}
${STEP_RULES}
- notes: the author's overall notes/tips, or null.`;
