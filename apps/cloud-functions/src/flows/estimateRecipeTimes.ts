import { googleAI } from '@genkit-ai/google-genai';
import {
  EstimateRecipeTimesInputSchema,
  EstimateRecipeTimesAIOutputSchema,
  EstimateRecipeTimesOutputSchema,
  type EstimateRecipeTimesInput,
  type EstimateRecipeTimesOutput,
} from '@salt/domain/schemas';
import { reconcileRecipeTimes } from '@salt/domain';
import { AI_TEXT_FLOW_TIMEOUT, withAiTimeout } from '../adapters/withAiTimeout.js';
import { TIME_RULES } from './recipeFieldRules.js';
import { ai } from '../genkit.js';
import { resolveModel } from '../ai/resolveModel.js';

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
// The system prompt below interpolates `TIME_RULES` from recipeFieldRules — the
// very text the librarian and both extractors are given for what the three fields
// MEAN. That half is shared, and it is the load-bearing choice in this file: a
// backfill that re-estimated against its own hand-written field definitions would
// leave the library split between two of them again, which is the exact failure
// this issue exists to end (and the #785 twin returning). If the definitions
// change, both the new recipes and the backfilled ones move together.
//
// The `## How to estimate` block below TIME_RULES is a SEPARATE, flow-local half:
// the heuristics that turn the definitions into three numbers — scale prep with
// servings, a step timer is a floor, heat vs. unattended wait, overlapping work
// counts once, "a competent home cook doing only this", round to a human number.
// Those are NOT shared with `recipeFieldRules.ts` or with the three authoring
// paths, and the two texts can drift from each other independently. Precise
// claim, because it is easy to overstate from the TIME_RULES import above: a
// chat-authored recipe and a backfilled one of the same dish are measured
// against the SAME field definitions, not against one shared estimation policy.
// Unifying the two is deliberately deferred to its own follow-up issue.
//
// ─── What it is NOT allowed to do ─────────────────────────────────────────────
//
// It returns three numbers. It has no output field for anything else, so it
// cannot rewrite a title, an ingredient or a step even if asked — which is the
// structural half of the issue's "no re-authoring, no Refresh, no re-parse".
// The trigger writes exactly the three `metadata.*` paths it returns.
//
// ─── It is not shown the stored times, deliberately ───────────────────────────
//
// The stored triple is the thing being replaced, and it is wrong in a KNOWN
// direction: low. Handing the model "the current prep time is 5 minutes" and
// asking it to reconsider is an anchor pulling towards the number we already
// decided is untrue — the same reason phase 1 relabelled a web page's own times
// as "a HINT, not a floor" rather than an input. What it gets instead is the
// evidence: the ingredient lines (most of the prep) and the steps with their
// timers (fact, not estimate — a cook or the source set those).

const ESTIMATE_TIMES_SYSTEM = `You are an experienced cook reading a recipe that is already written, working out \
honestly how long it takes to make. You are given the recipe's title, description, servings, ingredient lines \
and numbered method steps, with each step's timer where it has one. Return ONLY the three time fields.

## What the three fields mean
${TIME_RULES}

## How to estimate
- Read the INGREDIENT LINES for the prep: "3 large potatoes, peeled and diced" is peeling and dicing whether or \
not a step says so, and "500g onions, finely sliced" is a good ten minutes with a knife. Count getting things \
out of the fridge and cupboards, weighing and measuring, and washing up the boards, pans and bowls at the end.
- Scale prep with the servings. Dicing two onions is not dicing six.
- The step TIMERS are facts, not guesses. A step with a timer takes at least that long. Decide for each whether \
it is time on heat (cookTimeMinutes) or an unattended wait — marinating, proving, chilling, resting — which \
belongs only in totalTimeMinutes.
- Overlapping work counts ONCE on the wall clock: chopping the onions while the oven heats is not two separate \
stretches of totalTimeMinutes.
- Be realistic, not generous and not heroic. Estimate for a competent home cook in a normal kitchen who is \
doing only this.
- Return whole minutes. Round to something a person would say: 5, 10, 15, 20, 25, 30, 45, 90 — not 37.

Do not comment, do not explain, and do not return anything about the recipe other than these three numbers.`;

/**
 * Impose the arithmetic contract on a model's three numbers, and fold the zeros.
 *
 * A thin wrapper over the ONE implementation of that arithmetic, in
 * `packages/domain` (issue #1116) — the rule, the reconcile-then-fold ordering and
 * the zero fold are all argued there. Kept as a named export because it is applied
 * INSIDE the flow rather than at the trigger, for the reason CLAUDE.md gives about
 * wrapping AI calls: the flow is the one place every caller passes through, so a
 * second caller cannot forget it.
 *
 * `deriveMissingTotal: true` — the opposite of what `assembleRecipeDraft` passes in
 * edit mode, and right here for a reason that does not apply there. This path
 * always runs against an ALREADY-STORED recipe, so refusing to derive would write
 * `null` over a perfectly good stored total. `floorTotalAtStoredWait` in
 * `onRecipeWritten` is what protects a stored total that recorded a real
 * unattended wait on this path; it does not cover the case where the stored total
 * recorded none, which is exactly the case "never derive" would erase.
 */
export function reconcileEstimatedTimes(
  raw: Readonly<{
    prepTimeMinutes: number | null;
    cookTimeMinutes: number | null;
    totalTimeMinutes: number | null;
  }>,
): EstimateRecipeTimesOutput {
  return reconcileRecipeTimes(raw, { deriveMissingTotal: true });
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
    const modelId = await resolveModel('fast', 'estimateRecipeTimes');
    const model = googleAI.model(modelId);
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
