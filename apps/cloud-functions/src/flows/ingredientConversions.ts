// Shared American→British ingredient-name substitution policy for every recipe-
// authoring path (issue: UK-locale ingredients). The librarian (authorRecipe) and
// URL-import (extractRecipeFromUrl) flows both ask the model to emit ingredient
// rawText, and the chef (chefChat) suggests ingredients conversationally, so the
// locale rule lives here once — a single source of truth that cannot drift
// between the prompts.
//
// SCOPE: ingredient NAMES only. This constant says nothing about units — but as of
// #934 that no longer means each prompt writes its own. Units are shared too, by
// TWO constants that are deliberately not one, because they answer at different
// boundaries:
//
//   * READER_UNIT_PRINCIPLE (`@salt/domain/prompts`) — what a PERSON READS.
//     Interpolated by chefChat's prose and by parseRecipeIngredients' displayText
//     rule: metric or a count, with a spoon measure of 3 tbsp or less permitted in
//     brackets after the metric value.
//   * MEASURE_RULES (`./recipeFieldRules.ts`) — what the librarian and the
//     extractors write into rawText for the pipeline to parse. It says the
//     opposite about a spoon measure (leave it verbatim, do not convert), and that
//     is correct there: parseRecipeIngredients is the stage that converts, and
//     converting early deletes the bracket instead of moving it.
//
// Temperature and British spelling of prose still live inline in each prompt
// (chefChat states °C; extractRecipeFromUrl keeps its metric + spelling bullets).

// Light, one-line locale principle. Safe to drop into a conversational prompt
// (chefChat) without stilting it, and reused as the catch-all at the foot of the
// heavy table below so the two phrasings never drift.
export const UK_INGREDIENT_PRINCIPLE =
  'Use ingredients a UK supermarket stocks and prefer British ingredient names — substitute the closest common UK equivalent for anything American (e.g. double cream not heavy cream, coriander not cilantro, aubergine not eggplant).';

// Heavy American→British ingredient-name substitution table for the STRUCTURED
// recipe-authoring prompts (authorRecipe's LIBRARIAN_SYSTEM and
// extractRecipeFromUrl's CONVERSION_RULES). It slots in as a bullet of each
// prompt's rule list, so it starts with `- ` and uses matching two-space-indented
// sub-bullets. Do NOT interpolate this into the conversational chef prompt — use
// UK_INGREDIENT_PRINCIPLE there instead.
export const INGREDIENT_SUBSTITUTION_RULES = `- British ingredient names throughout. Always translate American ingredient names and terms to their British equivalents:
  - cilantro (leaf) → coriander
  - eggplant → aubergine
  - zucchini → courgette
  - scallion / green onion → spring onion
  - arugula → rocket
  - shrimp → prawns
  - ground beef → beef mince (likewise ground pork/lamb → pork/lamb mince)
  - all-purpose flour → plain flour
  - self-rising flour → self-raising flour
  - confectioners' / powdered sugar → icing sugar
  - superfine sugar → caster sugar
  - granulated sugar → caster sugar (unless it must stay granulated)
  - light/dark brown sugar → light/dark soft brown sugar
  - heavy cream → double cream; half-and-half / light cream → single cream
  - whole milk stays whole milk; "milk" stays milk
  - beets → beetroot
  - rutabaga → swede
  - snow peas → mangetout
  - bell pepper → pepper (e.g. red pepper)
  - chickpeas / garbanzo beans → chickpeas
  - cornstarch → cornflour
  - molasses → treacle (black treacle for blackstrap)
  - golden raisins → sultanas
  - baking soda → bicarbonate of soda
  - shredded/desiccated coconut → desiccated coconut
  - graham crackers → digestive biscuits
  - saltines → cream crackers
  - jelly → jam; jello → jelly
  - skillet → frying pan; broil → grill; can → tin
  - paper towel → kitchen paper; plastic wrap → cling film; parchment paper → baking paper
  - Anything else American: ${UK_INGREDIENT_PRINCIPLE}
- Commit to a single ingredient — never emit an either-or choice like "Persian or Lebanese cucumbers" or "flaky sea salt or kosher salt". Pick ONE and name it in UK terms (e.g. just "cucumber", "sea salt"). This targets a CHOICE between distinct ingredients — do NOT break up a legitimate compound name that merely contains "or".
- One ingredient per line — never merge two distinct ingredients into a single line. "Salt and freshly ground black pepper" is TWO ingredients and must be emitted as two separate ingredients. This targets distinct ingredients joined by "and"; leave genuine compound names intact (e.g. "sweet and sour sauce", "half and half", "mac and cheese", "salt and vinegar").`;
