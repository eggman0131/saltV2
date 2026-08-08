// Shared method-step policy for every recipe-authoring path (issue: one coherent
// operation per step). The librarian (authorRecipe) and URL-import
// (extractRecipeFromUrl) flows both end by asking the model to emit `steps`, so the
// rules live here once — a single source of truth that cannot drift between the two
// prompts, exactly like CATEGORY_TAG_RULES and INGREDIENT_SUBSTITUTION_RULES.
//
// The rules below exist to serve cook mode's one-step-per-screen pager
// (`apps/web-pwa/src/routes/recipes/CookModePage.svelte`), not the read view:
//
//  1. ONE OPERATION PER STEP. A step is a screen the cook reads at arm's length and
//     then acts on, so a step bundling four operations is four screens of
//     instruction to hold in your head at once. This is about legibility, NOT
//     layout — `deriveStops` in `apps/web-pwa/src/lib/cookDeck.ts` already pages a
//     step taller than the viewport, so nothing breaks when the model ignores it.
//  2. NO QUANTITIES IN STEP TEXT. Amounts already reach the cook from the ingredient
//     list and from the first-use chips shown beside the step being cooked, so
//     repeating them inline is noise that pushes the actual instruction down the
//     screen.
//  3. A DURATION RANGE TIMES ITS LOWER BOUND. "Simmer for 10–15 minutes" is an
//     instruction to start checking at 10, so a 15-minute timer fires when the pan
//     is at best done and at worst burnt. The range is not stored anywhere — it
//     stays in the step's prose, which is what the cook is reading at that moment,
//     so the clause has to say so explicitly or the model "tidies" the text to
//     match the number it chose.
//
// Rule 2 makes `firstUsedInStepOrdinal` load-bearing, which is why
// FIRST_USE_ORDINAL_RULE is deliberately strict about null: `firstUseByStep` in
// `@salt/domain` drops an ingredient with no step id, so such an ingredient appears
// at mise en place and NOWHERE else — and with amounts gone from the prose, its
// quantity is then unreachable at the moment it is needed. The two rules must ship
// together for that reason; don't adopt one without the other.
//
// Both constants slot in as bullets of each prompt's field list, so they start with
// `- ` / mid-bullet text respectively and use matching two-space indentation.

export const STEP_RULES = `- steps: numbered method steps, in order. Each step:
  text: the instruction — British terms, temperatures in °C only, never Fahrenheit.
    ONE COHERENT OPERATION PER STEP. A step is one thing the cook does before looking back at the recipe. Actions that happen in a single go stay together ("add the garlic and fry until fragrant"); a change of station, a wait, or a distinct process starts a new step. SPLIT any instruction that bundles several operations into consecutive steps. Do NOT atomise trivia into steps of their own ("get out a bowl", "measure the flour"). One or two sentences — never a paragraph.
    NO QUANTITIES. Name ingredients, never their amounts: "stir in the flour", NOT "stir in the 200 g flour" and NOT "stir in the flour (200 g)". The cook is already shown the amounts alongside the step. Exceptions, because these appear nowhere in the ingredient list: a partial use of a listed ingredient ("add half the butter", "reserve a quarter of the sauce"), pan and tin sizes, oven/pan temperatures, and a quantity that IS the instruction ("top up with water to cover", "roll out to 5 mm").
  timerMinutes: integer, or null when the step has no wait worth timing. When the source gives a RANGE ("simmer for 10–15 minutes", "bake 40 to 45 mins"), take the LOWER bound — 10, not 15 — so the timer goes off when the cook should START CHECKING rather than when the dish is already done at best. Leave the range itself in text exactly as the source wrote it; do NOT rewrite it to the single number you used (the NO QUANTITIES rule above governs ingredient amounts and never strips a time from the prose).
  timerLabel: when timerMinutes is set, a SHORT imperative label for that timer (2–4 words, e.g. "Simmer the sauce", "Rest the dough", "Boil pasta"). Do NOT repeat the duration in it (the minutes are shown separately). null whenever timerMinutes is null.
  note: a genuine warning or non-obvious caveat only — something that would ruin the dish if missed (e.g. "don't let the heat exceed 80°C or the custard will scramble"). Leave null for routine instructions; most steps should have no note.`;

// The `firstUsedInStepOrdinal` clause of each prompt's ingredient bullet. Split out
// from STEP_RULES because it belongs to the INGREDIENT field, but kept in this file
// because it is the other half of the no-quantities rule (see above) — the two are
// only correct together.
export const FIRST_USE_ORDINAL_RULE = `firstUsedInStepOrdinal (0-based index into the steps array for the first step that uses this ingredient). Set it for EVERY ingredient that a step uses: while cooking, an ingredient with no ordinal is listed once at mise en place and never shown again, so its amount is unreachable at the moment it is needed. Use null ONLY when no step uses the ingredient at all.`;
