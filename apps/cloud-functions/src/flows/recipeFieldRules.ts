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

// The PHASES half of the same definition (issue #1122), and it lives inside
// TIME_RULES rather than beside it for exactly the reason TIME_RULES itself was
// exported: every authoring path — both extractors, the librarian and the
// re-estimator — must ask for phases against ONE text. A second copy anywhere is
// the #785 twin, and this time it would leave half the library's timelines drawn
// to one definition of "hands-on" and half to another.
//
// The three numbers above are still asked for and still stored while this ships
// (issue #1122 phase 1); phase 4 removes them and leaves this block alone.
//
// TWO numbers per phase, never a third. Elapsed time is derived from them, and
// asking the model for it as well is asking for a number that can contradict the
// two it was added to.
//
// OVERLAP is the sharpened half. "Counts ONCE" already sat in the estimator's own
// heuristics; what it never said was WHERE the overlapped work goes, which is why
// a pan of water coming to the boil landed nowhere at all. It goes in the phase
// that contains it, as hands-off minutes, and the attended work happening across
// it is that same phase's hands-on minutes.
const PHASE_RULES = `- phases: the recipe's timing as an ORDERED list of 3–6 named blocks, in the order the \
cook does them, covering the whole process from walking into the kitchen to the dish being ready. \
Name each one for what it IS in a couple of words — "Mix & knead", "First rise", "Roast cauliflower \
& make sauce", "Bake", "Cool", "Prep", "Cook". A simple dish may need only two or three; never more \
than six.
  Each phase carries exactly two numbers, both whole non-negative minutes:
  - handsOnMinutes: minutes the cook is actively working during that block.
  - handsOffMinutes: minutes of that block that pass WITHOUT the cook — heat, a prove, a chill, a \
rest, a pan coming to the boil, an oven heating.
  The block's elapsed time is those two added, so do NOT return a total for a phase.
- Phases are NOT steps. Several steps collapse into one phase, and a phase is named for what it is, \
not for the steps inside it. Do not emit one phase per step.
- Work that OVERLAPS goes in ONE phase, never two. Roasting the cauliflower while you make the \
sauce is a single 20-minute phase with 15 minutes hands-on inside it. Where several things share a \
window and no single name fits, give the phase a general name ("Cook").
- Account for EVERY minute the cook waits, including the ones no step bothers to time: bringing a \
pan of water to the boil, heating the oven, waiting for butter to soften. Those are hands-off \
minutes of the phase they happen in. A recipe whose phases sum to less than the real wall clock is \
the failure being fixed.
- Overestimate rather than underestimate a phase, but assume a competent cook who overlaps what any \
competent cook would overlap. Round to numbers a person would say: 5, 10, 15, 20, 30, 45, 90.
- timingSummary: ONE short plain sentence over the strip, saying how much of it is the cook and how \
long the whole thing spans — "About 40 minutes of you, spread over 2¼ hours — start it the night \
before." Null only when you have no phases.`;

// What the three time fields MEAN, and it is unconditional — a recipe off a web
// page and one out of a chat have to be comparable, or the list's "quickest
// first" sort and the cook plan are sorting on three different units (issue
// #952).
//
// The old rule was one line — "integers in minutes, or null" — which is a TYPE
// declaration, not a definition. With nothing else to go on (there are no
// `.describe()` calls in the schemas, so Genkit sends the model only names and
// types) the model fell back on published-recipe convention, where "prep: 5 min"
// conventionally starts from an already-weighed counter and ends before the
// washing up. That is the kitchen nobody cooks in, and it is why every recipe in
// the library reads optimistic.
//
// The arithmetic bullet is stated here AND enforced in assembleRecipeDraft. Both
// are needed: the prompt is what makes the model's own three numbers coherent,
// the assembler is what guarantees the stored document is, whatever the model
// returns. Asking without enforcing is how `total: 35` came to sit on a recipe
// whose own prep + cook is 45.

// Exported (issue #952, phase 2) so the estimateRecipeTimes flow asks its question
// against THIS text and not a paraphrase of it. A backfill that re-estimates
// against a second, hand-copied definition would put the library back where it
// started — half the recipes on one definition and half on another — which is the
// #785 twin in a new place.
export const TIME_RULES = `- prepTimeMinutes: every minute the cook actively spends that is NOT time on heat — \
fetching the ingredients and equipment out, weighing and measuring, peeling, chopping, mixing, \
and clearing down afterwards. Estimate it for a cook starting with nothing out and finishing with a \
clean kitchen, NOT for the already-weighed counter a published "prep: 5 minutes" assumes.
- cookTimeMinutes: time the food spends cooking — on the hob, in the oven, under the grill.
- totalTimeMinutes: wall-clock from starting to serving, INCLUDING unattended waits that are neither \
prep nor cook (marinating, proving, chilling, resting).
- The three MUST reconcile: totalTimeMinutes >= prepTimeMinutes + cookTimeMinutes. Estimate the \
numbers yourself when the source states none, or states ones that break that rule — an honest \
estimate is worth more than a copied figure. Integers in minutes; null only when you genuinely \
cannot estimate.
${PHASE_RULES}`;

function fields(measures: MeasurePolicy): string {
  return `## Fields
- title: clear, concise recipe name.
- description: 1–2 sentence summary, or null.
- servings: integer portions, or null if not stated.
${TIME_RULES}
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
//
// The bracket clause added under 'preserve' (#934) is the other half of the chef
// flipping to metric-first. The chef now writes "3 g salt (½ tsp)", so a chat line
// reaches `parseRecipeIngredients` ALREADY IN GRAMS — and that flow correctly
// emits `displayText: null` for an already-metric source. Left alone, the flip
// would silently strip the spoon measure from every chat-authored recipe. The
// bracket has to survive this transcription for the parser to have anything to
// lift, which is why the two changes could not ship apart. The parser's matching
// half is its "already reads metric-first with a spoon measure in brackets"
// bullet; the two are pinned together in
// `apps/cloud-functions/tests/flows/unitPolicy.test.ts`.
function rawTextClause(measures: MeasurePolicy): string {
  if (measures === 'metricate') {
    return `rawText (the ingredient line rewritten in British spelling/terms and the units the measure \
rules above allow — this is what the rest of the pipeline parses, so write a clean natural line e.g. \
"240ml whole milk", "2 cloves garlic, crushed" or "1 tsp ground cumin")`;
  }
  return `rawText (preserve the original wording and any tsp/tbsp measures the chef used — INCLUDING \
a spoon measure the chef wrote in brackets AFTER a metric amount ("3 g salt (½ tsp)", "15 ml oil \
(1 tbsp)"): copy that bracket through exactly as written, because a later stage lifts it out as the \
form the cook reads and dropping it here loses it for good — EXCEPT \
where the conversion rules above take precedence — always use the measure rules' units (never a cup, \
pint or ounce, however the chef phrased it), always use the British ingredient NAMES (e.g. "double \
cream" not "heavy cream"), commit to a single ingredient rather than an either-or choice, and split any \
line that combines two distinct ingredients into two separate ingredients ("Salt and freshly ground \
black pepper" → two ingredients). These override "preserve the original wording")`;
}
