import { googleAI } from '@genkit-ai/google-genai';
import {
  DescribeRecipeSceneInputSchema,
  DescribeRecipeSceneOutputSchema,
} from '@salt/domain/schemas';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { ai } from '../genkit.js';
import { resolveModel } from '../ai/resolveModel.js';

// describeRecipeScene — the cheap text step in front of the expensive image step.
//
// The hero prompt used to see only the title, description and tags, so it had to
// guess what the finished dish looked like ("First read the dish itself…"). This
// flow reads the WHOLE recipe — every ingredient, every step — and writes a short
// art-direction brief describing what the plated dish ACTUALLY looks like. The
// blistered top, the torn basil scattered at the end, the sauce that only exists
// in step 6: those live in the method, and this is the only thing that reads them.
// The brief then directs the image model in place of that guess-it-yourself clause.
//
// SCOPE — the dish-specific half ONLY. This flow describes THIS dish: appearance,
// plating, vessel, garnish, colour, texture, and the mood/season/cuisine it reads
// as. It must NOT author house style or prohibitions ("photoreal", "soft window
// light", "no text, no people"). Those are the ANCHORS — locked in code in
// generateRecipeImage.ts and appended AFTER the brief on every prompt precisely so
// that cross-recipe consistency cannot drift. A brief that re-authored them would
// be a per-recipe vote on the house style, which is exactly what the anchors exist
// to prevent (and, once a brief is human-editable, a way to talk the image model
// out of "no people").
const DESCRIBE_SCENE_SYSTEM = `You are a food photographer's art director. You are given one recipe — its title, \
description, tags, ingredients and method. Write a short art-direction brief for a photograph of the FINISHED dish.

Read the whole recipe, especially the METHOD and the INGREDIENTS: they carry what the dish actually looks like once \
it is cooked and plated. Cues like "grill until the top is blistered and golden" or "scatter with torn basil" decide \
the finished appearance, and they usually appear nowhere in the title or description. Describe the dish as it looks \
at the moment it is served.

Cover only what is specific to THIS dish:
- what the finished dish looks like — colour, texture, browning, sauce, steam, how it sits
- how it is plated and in what vessel, and any garnish or finishing touch the method calls for
- the mood, season and cuisine the dish reads as, and why the dish itself implies that

Do NOT write about photographic style, lighting, lens, framing, camera angle, or what must not appear in the shot — \
those are fixed elsewhere and anything you say about them is discarded. Do not restate the recipe, do not list \
quantities, and do not give instructions for cooking it.

Write ONE paragraph of plain prose, at most about 80 words. A brief, not an essay. Return only the brief.`;

export const describeRecipeSceneFlow = ai.defineFlow(
  {
    name: 'describeRecipeScene',
    inputSchema: DescribeRecipeSceneInputSchema,
    outputSchema: DescribeRecipeSceneOutputSchema,
  },
  async ({ title, description, ingredients, steps }) => {
    const promptParts = [
      `Title: ${title}`,
      description ? `Description: ${description}` : null,
      ingredients.length > 0
        ? `Ingredients:\n${ingredients.map((i) => `- ${i}`).join('\n')}`
        : null,
      steps.length > 0 ? `Method:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : null,
    ].filter((p): p is string => p !== null);

    const modelId = await resolveModel('fast', 'describeRecipeScene');
    const model = googleAI.model(modelId);
    const result = await withAiTimeout(
      'describeRecipeScene',
      () =>
        ai.generate({
          model,
          system: DESCRIBE_SCENE_SYSTEM,
          prompt: promptParts.join('\n\n'),
          output: { schema: DescribeRecipeSceneOutputSchema },
        }),
      // House text-flow values, as categoriseRecipe: the caller (the image branch)
      // treats a failure as "no brief" and falls back, so a retry buys nothing.
      { timeoutMs: 55_000, retries: 0 },
    );

    // AI output is a trust boundary — validate before it leaves the flow.
    const parsed = DescribeRecipeSceneOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      throw new Error(`describeRecipeScene returned invalid output: ${parsed.error.message}`);
    }

    return { brief: parsed.data.brief.trim() };
  },
);
