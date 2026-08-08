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
//
// The guided-plan rules (issue #751) live at the bottom of this file for the same
// no-forking reason — see the section header there.

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

// ─── The GUIDED layer (issue #751) ───────────────────────────────────────────
//
// The two constants below govern the guided PLAN — a separate document that adds
// lines UNDERNEATH a recipe without touching a word of it. They live in this file
// because they are step policy: they decide what a cook is told at each step, and
// the moment they drift from STEP_RULES the plan starts contradicting the method
// it annotates (a plan that re-times a step, or re-states its quantities, undoes
// the two rules above at exactly the point the cook is reading).
//
// GUIDED_PREP_RULES carries the same trap FIRST_USE_ORDINAL_RULE was written to
// close, one layer up. In guided mode the prep list REPLACES the ingredient
// checklist, so an ingredient named in no prep entry is one the cook never sees —
// the same silent disappearance, arrived at a different way. "Exactly once" is
// therefore not tidiness: once is a full account of the ingredient list, and it is
// also what stops the same 400g of passata being weighed into two bowls.
//
// Both slot in as bullets of the plan prompt's field list, so they start with `- `
// and use the same two-space indentation as STEP_RULES.

export const GUIDED_PREP_RULES = `- prep: the mise en place, as a list of JOBS to do before cooking starts. Each job:
  text: ONE instruction, in the imperative ("Dice the carrots, onion and celery into 5mm pieces"). Say the size, shape or state the method depends on. Ingredients that are used together in the same step are prepped TOGETHER as one job, into one container — that is the point of the list. NO QUANTITIES, exactly as in the method: the amounts are already shown beside the job. Never restate a method step here: prep is what happens before the heat goes on.
  container: what the result is set aside IN ("small bowl", "jug", "plate"), whenever the job produces something that waits. null when nothing is set aside — "Open the tin of tomatoes", "Take the butter out of the fridge".
  ingredientIds: the ids of the recipe ingredients this job prepares. EVERY ingredient id in the recipe must appear EXACTLY ONCE across the whole prep list — including ones that need no knife work at all (a tin, a jar, a splash of oil), which get a job of their own or join a related one. An ingredient named in no job is one the cook NEVER SEES: the prep list replaces the ingredient checklist, so a missing id silently removes the ingredient from the cook's world. An id in two jobs prepares the same thing twice.`;

export const GUIDED_STEP_NOTE_RULES = `- stepNotes: what to add UNDERNEATH the recipe's existing steps. NEVER rewrite, reword, re-time, split or merge a step — the step text is not yours to touch; you only add lines below it. Emit an entry only for a step that genuinely needs one, and leave any field you have nothing true to say in as null. Each entry:
  stepId: the id of the step, copied exactly from the step list you were given. Never invent one.
  container: the prepped container this step reaches for, named with the SAME words the prep job used ("the small bowl"). null when the step needs nothing from the prep list.
  setup: how the station is set, when the recipe assumes it — "small hob burner, medium-low", "oven shelf in the middle", "pan wide enough that the pieces don't touch". null when there is nothing to set.
  cue: the SENSORY test that says it is going right — what the cook should hear, see, smell or feel ("you should hear a very gentle sizzle, not a crackle"; "the edges should look lacy and set before you turn it"). null WHENEVER THERE IS NO GENUINE TEST. A made-up cue is worse than no cue: it is a confident instruction to wait for something that will never happen. Most steps have no cue; do not manufacture one to fill the field.
  checkIns: extra reminders partway through a step, ONLY on a step that already carries a timer, and only when something must actually be done mid-way ("stir it, or the bottom will catch"). atMinutes is minutes from the start of that step's timer and MUST BE LESS than the timer's own duration — a check-in at or after the end is the end, and the timer already covers it. Empty for almost every step.`;
