import {
  EstimateRecipeTimesInputSchema,
  EstimateRecipeTimesAIOutputSchema,
  EstimateRecipeTimesOutputSchema,
  type EstimateRecipeTimesAIOutput,
  type EstimateRecipeTimesInput,
  type EstimateRecipeTimesOutput,
} from '@salt/domain/schemas';
import { AI_TEXT_FLOW_TIMEOUT, withAiTimeout } from '../adapters/withAiTimeout.js';
import { TIME_RULES } from './recipeFieldRules.js';
import { ai } from '../genkit.js';
import { flowModel } from '../ai/fakeModel.js';

// estimateRecipeTimes (issue #952, phase 2) — "how long does this ACTUALLY take?",
// asked of a recipe that is ALREADY in the library.
//
// It exists because a recipe already in the library has whatever timing the
// authoring path of the day gave it, and that answer is wrong in a KNOWN
// direction: low. This flow is what re-asks, against the current definition.
//
// ─── The FIELD DEFINITIONS are imported; the ESTIMATION HEURISTICS are not ────
//
// The system prompt below interpolates `TIME_RULES` from recipeFieldRules — the
// very text the librarian and both extractors are given for what a phase MEANS.
// That half is shared, and it is the load-bearing choice in this file: a
// backfill that re-estimated against its own hand-written field definitions would
// leave the library split between two of them again, which is the exact failure
// this issue exists to end (and the #785 twin returning). If the definitions
// change, both the new recipes and the backfilled ones move together.
//
// The `## How to estimate` block below TIME_RULES is a SEPARATE, flow-local half:
// the heuristics that turn the definitions into minutes — scale the knife work
// with the servings, a step timer is a floor, heat vs. unattended wait,
// overlapping work counts once, "a competent home cook doing only this", round to
// a human number.
// Those are NOT shared with `recipeFieldRules.ts` or with the three authoring
// paths, and the two texts can drift from each other independently. Precise
// claim, because it is easy to overstate from the TIME_RULES import above: a
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
// It returns TIMING: the ordered phase strip and its one sentence (issues #1122,
// #1213). It has no output field for anything else, so it cannot rewrite a title,
// an ingredient or a step even if asked — which is the structural half of the
// issue's "no re-authoring, no Refresh, no re-parse". The trigger writes exactly
// the `metadata.*` timing paths it returns and nothing else.
//
// ─── It is not shown the stored times, deliberately ───────────────────────────
//
// The stored strip is the thing being replaced. Handing the model "this currently
// says 5 minutes" and asking it to reconsider is an anchor pulling towards the
// number we already decided is untrue — the same reason a web page's own times
// are labelled "a HINT, not a floor" rather than given as an input. What it gets
// instead is the evidence: the ingredient lines (most of the knife work) and the
// steps with their timers (fact, not estimate — a cook or the source set those).

const ESTIMATE_TIMES_SYSTEM = `You are an experienced cook reading a recipe that is already written, working out \
honestly how long it takes to make. You are given the recipe's title, description, servings, ingredient lines \
and numbered method steps, with each step's timer where it has one. Return ONLY the timing fields.

## What the timing fields mean
${TIME_RULES}

## How to estimate
- Read the INGREDIENT LINES for the hands-on work: "3 large potatoes, peeled and diced" is peeling and \
dicing whether or not a step says so, and "500g onions, finely sliced" is a good ten minutes with a knife. \
Count getting things out of the fridge and cupboards, weighing and measuring, and washing up the boards, \
pans and bowls at the end. That work is hands-on minutes of whichever phase it happens in.
- Scale the knife work with the servings. Dicing two onions is not dicing six.
- The step TIMERS are facts, not guesses. A step with a timer takes at least that long. Time on heat and \
an unattended wait — marinating, proving, chilling, resting — are both hands-off minutes of the phase \
they fall in.
- Overlapping work counts ONCE on the wall clock: chopping the onions while the oven heats is one phase, \
not two stretches of time.
- Account for the waits no step bothers to time — a pan coming to the boil, an oven heating, butter \
softening. Every real minute between walking into the kitchen and the dish being ready has to land in \
some phase.
- Be realistic, not generous and not heroic. Estimate for a competent home cook in a normal kitchen who is \
doing only this.
- Return whole minutes. Round to something a person would say: 5, 10, 15, 20, 25, 30, 45, 90 — not 37.

Do not comment, do not explain, and do not return anything about the recipe other than its timing.`;

/**
 * Absent → empty, and nothing else.
 *
 * There is nothing left to reconcile (issue #1213). While the flow also returned
 * prep / cook / total this imposed `total >= prep + cook` on them, via the one
 * shared implementation of that arithmetic in `packages/domain` (issue #1116);
 * both went with the fields, because elapsed time is now the sum of a phase's two
 * numbers by construction and an invariant that cannot be violated is not one
 * worth defending.
 *
 * Kept as a named export, and as a step of its own, because it is applied INSIDE
 * the flow rather than at the trigger: the flow is the one place every caller
 * passes through, so a second caller cannot forget it. The phases themselves pass
 * through UNTOUCHED — their arithmetic is a sum computed where it is read.
 */
export function reconcileEstimatedTimes(
  raw: Readonly<EstimateRecipeTimesAIOutput>,
): EstimateRecipeTimesOutput {
  // Absent becomes empty here, which is the ONE place that conversion happens on
  // this path — the trigger writes what this returns.
  return {
    phases: raw.phases ?? [],
    timingSummary: raw.timingSummary ?? null,
  };
}

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

    // `fast` + temperature 0, the same posture as identifyRecipeKit and
    // categoriseRecipe. Two cooks reading the same recipe should reach the same
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

    return reconcileEstimatedTimes(parsed.data);
  },
);
