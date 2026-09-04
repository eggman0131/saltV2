import {
  EstimateRecipeTimesInputSchema,
  EstimateRecipeTimesAIOutputSchema,
  EstimateRecipeTimesOutputSchema,
  type EstimateRecipeTimesAIOutput,
  type EstimateRecipeTimesInput,
  type EstimateRecipeTimesOutput,
} from '@salt/domain/schemas';
import { AI_TEXT_FLOW_TIMEOUT, withAiTimeout } from '../adapters/withAiTimeout.js';
import { PHASE_RULES } from './recipeFieldRules.js';
import { ai } from '../genkit.js';
import { flowModel } from '../ai/fakeModel.js';

// estimateRecipeTimes (issue #952, phase 2) — "how long does this ACTUALLY take?",
// asked of a recipe that is ALREADY in the library.
//
// Phase 1 defined the three time fields and made the three authoring paths ask for
// them properly. That fixes every recipe authored from now on and none of the ones
// already stored: their prep times were produced by the old one-line rule, which
// was a type declaration ("integers in minutes, or null") rather than a
// definition, so the model fell back on published-recipe convention — the
// already-weighed counter, and no washing up. This flow is what re-asks.
//
// ─── The FIELD DEFINITIONS are imported; the ESTIMATION HEURISTICS are not ────
//
// The system prompt below interpolates `PHASE_RULES` from recipeFieldRules — the
// very text the librarian and both extractors are given for what a recipe's timing
// MEANS. That half is shared, and it is the load-bearing choice in this file: a
// backfill that re-estimated against its own hand-written field definitions would
// leave the library split between two of them again, which is the exact failure
// this issue exists to end (and the #785 twin returning). If the definitions
// change, both the new recipes and the backfilled ones move together.
//
// The `## How to estimate` block below it is a SEPARATE, flow-local half: the
// heuristics that turn the definition into a strip — scale hands-on work with
// servings, a step timer is a floor, heat vs. unattended wait, overlapping work
// counts once, "a competent home cook doing only this", round to a human number.
// Those are NOT shared with `recipeFieldRules.ts` or with the three authoring
// paths, and the two texts can drift from each other independently. Precise
// claim, because it is easy to overstate from the import above: a
// chat-authored recipe and a backfilled one of the same dish are measured
// against the SAME field definitions, not against one shared estimation policy.
// Unifying the two is deliberately deferred, and the deferral now has a name:
// issue #1191, filed out of #934 for the purpose. It is not folded into #934
// because it is the one item of that sweep whose fix CHANGES WHAT THREE SHIPPED
// AUTHORING PATHS PRODUCE, is unvalidatable without AI keys, and carries the
// #785/#784 constraint in a new form — heuristics written for a backfill reading
// a stored recipe, applied to a path reading a photograph.
//
// ─── What it is NOT allowed to do ─────────────────────────────────────────────
//
// It returns TIMING: the ordered phase strip and its one sentence (issue #1122).
// It has no output field for anything else, so it cannot rewrite a title, an
// ingredient or a step even if asked — which is the structural half of the issue's
// "no re-authoring, no Refresh, no re-parse". The trigger writes exactly the
// `metadata.*` timing paths it returns and nothing else.
//
// ─── It is not shown the stored timing, deliberately ──────────────────────────
//
// The stored timing is the thing being replaced, and it is wrong in a KNOWN
// direction: low. Handing the model "this currently says 5 minutes" and asking it
// to reconsider is an anchor pulling towards the number we already decided is
// untrue — the same reason phase 1 relabelled a web page's own times as "a HINT,
// not a floor" rather than an input. What it gets instead is the evidence: the
// ingredient lines (most of the hands-on work) and the steps with their timers
// (fact, not estimate — a cook or the source set those).

const ESTIMATE_TIMES_SYSTEM = `You are an experienced cook reading a recipe that is already written, working out \
honestly how long it takes to make. You are given the recipe's title, description, servings, ingredient lines \
and numbered method steps, with each step's timer where it has one. Return ONLY the timing fields.

## What the timing means
${PHASE_RULES}

## How to estimate
- Read the INGREDIENT LINES for the hands-on work: "3 large potatoes, peeled and diced" is peeling and \
dicing whether or not a step says so, and "500g onions, finely sliced" is a good ten minutes with a knife. \
Count getting things out of the fridge and cupboards, weighing and measuring, and washing up the boards, \
pans and bowls at the end.
- Scale that work with the servings. Dicing two onions is not dicing six.
- The step TIMERS are facts, not guesses. A step with a timer takes at least that long, and it is \
hands-off minutes of the phase it happens in — whether it is time on heat or an unattended wait \
(marinating, proving, chilling, resting).
- Overlapping work counts ONCE on the wall clock: chopping the onions while the oven heats is one phase \
with the chopping as its hands-on minutes, not two stretches of time.
- Account for every minute the cook waits, including the untimed ones no step mentions — a pan coming to \
the boil, an oven heating, butter softening. A strip that sums to less than the real wall clock is the \
failure being fixed.
- Be realistic, not generous and not heroic. Estimate for a competent home cook in a normal kitchen who is \
doing only this.
- Return whole minutes. Round to something a person would say: 5, 10, 15, 20, 25, 30, 45, 90 — not 37.

Do not comment, do not explain, and do not return anything about the recipe other than its timing.`;

export const estimateRecipeTimesFlow = ai.defineFlow(
  {
    name: 'estimateRecipeTimes',
    inputSchema: EstimateRecipeTimesInputSchema,
    outputSchema: EstimateRecipeTimesOutputSchema,
  },
  async ({
    title,
    description,
    servings,
    ingredients,
    steps,
  }: EstimateRecipeTimesInput): Promise<EstimateRecipeTimesOutput> => {
    const promptParts = [
      `Title: ${title}`,
      description ? `Description: ${description}` : null,
      servings !== null ? `Servings: ${servings}` : null,
      ingredients.length > 0
        ? `Ingredients:\n${ingredients.map((i) => `- ${i}`).join('\n')}`
        : null,
      // The timer travels WITH the step text rather than in a separate list, for
      // the reason identifyRecipeKit keeps step ids beside their words: a number
      // separated from the sentence it belongs to is a number the model has to
      // re-associate, and it will sometimes get it wrong.
      steps.length > 0
        ? `Method:\n${steps
            .map(
              (s, i) =>
                `${i + 1}. ${s.text}${s.timerMinutes !== null ? ` [timer: ${s.timerMinutes} min]` : ''}`,
            )
            .join('\n')}`
        : null,
    ].filter((p): p is string => p !== null);

    // `fast` + temperature 0, the same posture as identifyRecipeKit.
    // Two cooks reading the same recipe should reach the same
    // half-hour, and a backfill that returns a different answer each time it is
    // re-run is not a backfill.
    const model = await flowModel('estimateRecipeTimes');
    const result = await withAiTimeout(
      'estimateRecipeTimes',
      () =>
        ai.generate({
          model,
          system: ESTIMATE_TIMES_SYSTEM,
          prompt: promptParts.join('\n\n'),
          output: { schema: EstimateRecipeTimesAIOutputSchema },
          config: { temperature: 0 },
        }),
      // No retry (the shared budget's): the trigger treats a failure as "not
      // estimated yet" and leaves `timesEstimatedAt` unstamped, so re-running the
      // backfill script IS the retry path and there is nothing to gain from
      // burning the budget automatically.
      AI_TEXT_FLOW_TIMEOUT,
    );

    // AI output is a trust boundary — validate before it leaves the flow.
    const parsed = EstimateRecipeTimesAIOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      throw new Error(`estimateRecipeTimes returned invalid output: ${parsed.error.message}`);
    }

    // The strip passes through untouched, and that is the whole of what is left
    // to do (issue #1233 retired `reconcileEstimatedTimes` with the three numbers
    // it reconciled): the phases carry their own arithmetic — elapsed is a sum,
    // computed where it is read — so there is nothing here to reconcile and
    // nothing to zero-fold. Absent becomes empty HERE, which is the one place
    // that conversion happens on this path; the trigger writes what this returns.
    return {
      phases: parsed.data.phases ?? [],
      timingSummary: parsed.data.timingSummary ?? null,
    };
  },
);
