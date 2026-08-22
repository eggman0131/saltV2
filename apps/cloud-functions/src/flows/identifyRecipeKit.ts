import { googleAI } from '@genkit-ai/google-genai';
import {
  IdentifyRecipeKitInputSchema,
  IdentifyRecipeKitAIOutputSchema,
  IdentifyRecipeKitOutputSchema,
  type IdentifyRecipeKitInput,
  type RecipeKitEntryDoc,
} from '@salt/domain/schemas';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { ai } from '../genkit.js';
import { resolveModel } from '../ai/resolveModel.js';

// identifyRecipeKit (issue #882) — "what do I need to get out?", answered from the
// WHOLE stored recipe.
//
// A separate best-effort pass over what was SAVED, on the describeRecipeScene
// model, and that is a scope rule rather than a convenience. The librarian and the
// two extractors are temperature-0 TRANSCRIBERS (docs/ai-kitchen-assistant.md
// § Scope boundaries): handing them "and also work out what kit this needs" would
// license them to reason about a recipe they are meant to copy down. Kit is
// inference — a recipe that says "mash the potatoes" needs a masher it never names
// — so it runs afterwards, over the finished document, and cannot touch it.
//
// Labels are FREE TEXT and there is no enum over the drawn vocabulary anywhere in
// this file. See IdentifyRecipeKitInputSchema's header for why that is the whole
// point: a constrained list turns a potato masher into a fork.

const IDENTIFY_KIT_SYSTEM = `You are an experienced cook reading a recipe before starting, working out what to \
get out of the cupboards. You are given the recipe's title, description, ingredients and numbered method steps, \
each step with an id. Return the KIT the cook needs.

## What counts as kit
Things you take out and put on the worktop: pans, pots, trays, tins, bowls, boards, knives, colanders, sieves, \
whisks, graters, mashers, rolling pins, tongs, ladles, measuring jugs, thermometers, skewers, piping bags.

Do NOT return:
- ingredients, or anything you eat
- the oven, hob, grill or microwave — they are the kitchen, not something you get out
- consumables: foil, cling film, baking paper, kitchen roll, string
- appliances the household may or may not own: stand mixers, food processors, air fryers, blenders, pressure \
cookers. If the method genuinely cannot be done without one, say so as a tool ("food processor") — but never \
suggest one as a convenience for a job the method does by hand.

## How to name it
Name it the way a cook would say it out loud, and be specific enough that the right one comes out of the \
cupboard: "large frying pan", not "pan". "Box grater", not "grater". "Small saucepan", "baking tray", \
"large mixing bowl", "chopping board", "sharp knife", "wooden spoon", "fine sieve". Lowercase, singular, no \
quantities, no brand names, and no explanation — just the thing.

## Work it out, do not copy it out
Most of the kit is never named in the method. "Mash the potatoes" needs a potato masher. "Drain the pasta" \
needs a colander. "Whisk the eggs until pale" needs a whisk and a bowl. Read what the cook is DOING and name \
what they are doing it with. Equally, do not invent kit for work the recipe does not do.

## Which steps
For each piece of kit, list the ids of the steps that actually use it — every one of them, not just the first. \
A frying pan used at the start and returned to later belongs to both steps. Use ONLY step ids from the list you \
are given; never invent one, and never use a step number in place of an id.

Return one entry per distinct piece of kit — no duplicates. A short, honest list beats a long one: if a dish \
needs a pan and a spoon, return a pan and a spoon.`;

/**
 * Trim the model's answer down to something safe to write on a recipe.
 *
 * Pure, and separated from the flow so it can be tested without a model. Three
 * things it fixes, all of which a model does eventually:
 *   - a step id that is not a step on THIS recipe (a hallucinated or stale id) is
 *     dropped. An entry may legitimately end up with no steps at all — a mixing
 *     bowl the method never mentions is still real kit — so an emptied `stepIds`
 *     does not drop the entry.
 *   - an entry with a blank (or whitespace-only) label is dropped entirely: a
 *     picture-less, word-less chip is nothing at all.
 *   - two entries naming the same thing are collapsed into one, case- and
 *     whitespace-insensitively, keeping the FIRST label's spelling and merging
 *     both step lists. The model asked for "Large frying pan" and "large frying
 *     pan" means one pan, and the strip must not show it twice.
 */
export function sanitiseRecipeKit(
  kit: readonly RecipeKitEntryDoc[],
  stepIds: readonly string[],
): RecipeKitEntryDoc[] {
  const realSteps = new Set(stepIds);
  // Insertion-ordered, so the kit stays in the order the model listed it —
  // which, asked to read a method top to bottom, is roughly the order it is
  // needed in.
  const byKey = new Map<string, RecipeKitEntryDoc>();
  for (const entry of kit) {
    const label = entry.label.trim();
    if (!label) continue;
    const key = label.toLowerCase().replace(/\s+/g, ' ');
    const steps = entry.stepIds.filter((id) => realSteps.has(id));
    const existing = byKey.get(key);
    if (existing) {
      // Merge rather than replace: the two mentions may each know a different
      // half of where the thing is used.
      const merged = new Set([...existing.stepIds, ...steps]);
      byKey.set(key, { label: existing.label, stepIds: [...merged] });
    } else {
      byKey.set(key, { label, stepIds: [...new Set(steps)] });
    }
  }
  return [...byKey.values()];
}

export const identifyRecipeKitFlow = ai.defineFlow(
  {
    name: 'identifyRecipeKit',
    inputSchema: IdentifyRecipeKitInputSchema,
    outputSchema: IdentifyRecipeKitOutputSchema,
  },
  async ({ title, description, ingredients, steps }: IdentifyRecipeKitInput) => {
    const promptParts = [
      `Title: ${title}`,
      description ? `Description: ${description}` : null,
      ingredients.length > 0
        ? `Ingredients:\n${ingredients.map((i) => `- ${i}`).join('\n')}`
        : null,
      // The id travels WITH the step text rather than in a separate list, because
      // the model has to answer with ids and the cheapest way to make that reliable
      // is to never separate an id from the words it belongs to.
      steps.length > 0
        ? `Method (each step is "[id] text" — use these ids verbatim):\n${steps
            .map((s) => `[${s.id}] ${s.text}`)
            .join('\n')}`
        : null,
    ].filter((p): p is string => p !== null);

    // `fast` + temperature 0: the same posture as categoriseRecipe. Two cooks
    // reading the same recipe should reach for the same pans, and a kit list is
    // not a place for invention.
    const modelId = await resolveModel('fast', 'identifyRecipeKit');
    const model = googleAI.model(modelId);
    const result = await withAiTimeout(
      'identifyRecipeKit',
      () =>
        ai.generate({
          model,
          system: IDENTIFY_KIT_SYSTEM,
          prompt: promptParts.join('\n\n'),
          output: { schema: IdentifyRecipeKitAIOutputSchema },
          config: { temperature: 0 },
        }),
      // House text-flow values, as categoriseRecipe and describeRecipeScene. No
      // retry: the trigger treats a failure as "no kit yet" and leaves
      // `kitInferredAt` unstamped, so the redo action is the retry path and there
      // is nothing to gain from burning the timeout budget automatically.
      { timeoutMs: 55_000, retries: 0 },
    );

    // AI output is a trust boundary — validate before it leaves the flow.
    const parsed = IdentifyRecipeKitAIOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      throw new Error(`identifyRecipeKit returned invalid output: ${parsed.error.message}`);
    }

    return {
      kit: sanitiseRecipeKit(
        parsed.data.kit,
        steps.map((s) => s.id),
      ),
    };
  },
);
