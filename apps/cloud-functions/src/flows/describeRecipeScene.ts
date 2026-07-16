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

// REVISION MODE (issue #522, Phase 3) — "make it summery" applied to a brief that
// already exists, rather than a fresh authoring pass.
//
// The failure this prompt exists to prevent is the cheap one: bolting the steer on
// as a final sentence and leaving the rest of the paragraph contradicting it — a
// brief that says "autumnal, dark wood, low amber light" and then "make it summery"
// directs an incoherent image, which is exactly the render the user pays for and
// throws away. So the instruction is to fold the steer THROUGH the brief: light,
// props, surface and palette all move together, and everything the steer does not
// touch stays as it was (a revision is not a re-roll — the user chose to keep the
// parts they did not ask about).
//
// The recipe goes in here too, not just the paragraph. Revising prose about a dish
// without seeing the dish drifts away from the food — the same failure the whole
// feature fixes. The steer re-directs the SHOT; it must never rewrite what is on
// the plate into something the recipe does not cook.
//
// SCOPE is identical to authoring: the dish-specific half ONLY. The anchors stay
// locked in generateRecipeImage.ts and appended after the brief. This matters more
// here than in authoring — a steer is user text, so "make it summery, and photoreal
// with no people" must not become a per-recipe vote on the house style.
const REVISE_SCENE_SYSTEM = `You are a food photographer's art director. You are given one recipe, an existing \
art-direction brief for a photograph of the finished dish, and a requested change from the person who will use it. \
Rewrite the brief so it incorporates the requested change.

Fold the change THROUGH the whole brief. If the change is "make it summery", then the light, the surface, the props, \
the palette and the mood all move together to become summery — do NOT keep an autumnal brief and staple "make it \
summery" on the end. The result must read as one coherent brief that was always written that way, never as an edit \
with a contradiction left in it.

Keep everything the requested change does not touch. Anything the brief already says that still holds should survive \
the rewrite — this is a revision, not a fresh start.

Stay true to the recipe. The change re-directs how the dish is SHOT and styled; it must not turn the dish into food \
this recipe does not make. The finished dish's own colour, texture and garnish are set by the method and ingredients.

Cover only what is specific to THIS dish: its appearance, plating, vessel, garnish, and the mood/season/cuisine it \
reads as. Do NOT write about photographic style, lighting equipment, lens, framing, camera angle, or what must not \
appear in the shot — those are fixed elsewhere and anything you say about them is discarded, even if the requested \
change asks for it.

Write ONE paragraph of plain prose, at most about 80 words. Return only the revised brief.`;

export const describeRecipeSceneFlow = ai.defineFlow(
  {
    name: 'describeRecipeScene',
    inputSchema: DescribeRecipeSceneInputSchema,
    outputSchema: DescribeRecipeSceneOutputSchema,
  },
  async ({ title, description, ingredients, steps, currentBrief, hint }) => {
    // Revision needs BOTH halves: a paragraph to revise and a steer to revise it
    // by. With either missing there is nothing to fold through anything, so we
    // author from scratch — which is also, deliberately, what "start over" sends
    // (neither), so a rewritten recipe stops inheriting art direction for the dish
    // it used to be.
    const revising = Boolean(currentBrief && hint);

    const promptParts = [
      `Title: ${title}`,
      description ? `Description: ${description}` : null,
      ingredients.length > 0
        ? `Ingredients:\n${ingredients.map((i) => `- ${i}`).join('\n')}`
        : null,
      steps.length > 0 ? `Method:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : null,
      // The recipe stays FIRST on a revision too: the dish is the anchor, and the
      // brief and steer are the edit applied on top of it.
      revising ? `Current brief:\n${currentBrief}` : null,
      revising ? `Requested change: ${hint}` : null,
    ].filter((p): p is string => p !== null);

    const modelId = await resolveModel('fast', 'describeRecipeScene');
    const model = googleAI.model(modelId);
    const result = await withAiTimeout(
      'describeRecipeScene',
      () =>
        ai.generate({
          model,
          system: revising ? REVISE_SCENE_SYSTEM : DESCRIBE_SCENE_SYSTEM,
          prompt: promptParts.join('\n\n'),
          output: { schema: DescribeRecipeSceneOutputSchema },
        }),
      // House text-flow values, as categoriseRecipe. No retry: the trigger treats a
      // failure as "no brief" and falls back, and the callable's caller is a human
      // sitting in front of the dialog who can press the button again — neither
      // gains anything from burning the timeout budget on an automatic retry.
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
