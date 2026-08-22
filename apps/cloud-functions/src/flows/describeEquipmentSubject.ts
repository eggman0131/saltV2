import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { setActiveSpanName } from '@salt/observability/server';
import { ai } from '../genkit.js';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { resolveModel } from '../ai/resolveModel.js';

// describeEquipmentSubject — the cheap TEXT step in front of the expensive image
// step (issue #877). The equipment counterpart of describeRecipeScene, and it
// exists for the same reason: an image model has to be told what it is looking at.
//
// The house style is deliberately low-detail ("simple minimal friendly shapes,
// low detail"). Handed the bare string "Kenwood Chef KVC3100S Mary Berry Special
// Edition", an image model draws a generic cartoon stand mixer — it has no
// reliable idea what a KVC3100S looks like, and the style leaves it no room to
// bluff with detail. A TEXT model does know, and turning the make and model into
// words — cream body, chrome bowl, tilt head, one round dial on the right of the
// base — is the whole of what makes the drawing specific rather than decorative.
//
// The two steps are also separated by a user gate in the running app: this flow
// runs automatically on a manifest write, the image flow runs only when someone
// presses Draw. That is why the brief must read as a plain, correctable English
// sentence — it is shown to the user, and correcting it is how a wrong picture
// gets fixed at the cause instead of being re-rolled.
//
// ─── SCOPE — the subject half ONLY ──────────────────────────────────────────
// This flow describes what the THING IS. It must not author house style or
// prohibitions ("flat vector", "thick dark outline", "no drop shadows"). Those
// are the ANCHORS — locked in equipmentIconPrompt.ts and appended AFTER the
// brief on every prompt, precisely so a per-item brief cannot vote on the house
// style. Once a brief is human-editable that stops being a tidiness rule and
// becomes the thing standing between "correct the description" and "talk the
// image model out of the house style". Same rule, same reason, as
// describeRecipeScene.ts's SCENE_SCOPE_RULE.
//
// It must also not name the brand. The brief is fed to the image model verbatim,
// and no Salt pictogram carries lettering (see EQUIPMENT_STYLE_ANCHORS): a brief
// that says "the Kenwood logo on the front" is a request for the one thing the
// anchors then have to fight. Likeness comes from silhouette, colour and control
// layout, so those are what the brief is asked for.

const DESCRIBE_EQUIPMENT_SYSTEM = `You are an illustrator's art director. You are given the name of one piece of \
kitchen equipment — usually a make and model, sometimes a plain generic name. Write a short visual brief describing \
what that specific item LOOKS LIKE, for an illustrator who has never seen it.

Use what you know about the actual make and model. The point of this brief is that the drawing is recognisably THIS \
device rather than a generic one of its type, and the only way that happens is if you say what makes it distinctive.

Cover, in this order and only as far as the item warrants:
- the form factor and overall silhouette, and the rough proportions (squat and wide, tall and narrow, and so on)
- the body colour and finish — cream enamel, brushed stainless, matte black plastic, clear glass
- the control layout as it reads at a glance: how many dials, knobs, levers or buttons and roughly where they sit
- the one or two features that identify it — a tilt-back head, a domed lid, a spouted jug, a chrome bowl

If the name is generic and brandless, or you genuinely do not know the model, describe the typical form of that kind \
of equipment. Say so plainly in ordinary description; do NOT invent a brand, a model, or a distinctive feature you \
are not confident about. A sensible generic description is a good outcome, not a failure.

Never mention the brand name, the model number, a logo, a badge, a wordmark, or any lettering, writing or numbers on \
the item. The illustration carries no text of any kind, so anything you say about text is discarded — describe shape, \
colour, finish and controls instead.

Do NOT write about illustration style, line weight, colour palette, outlines, shading, framing, background, or what \
must not appear in the picture — those are fixed elsewhere and anything you say about them is discarded.

Write ONE sentence of plain prose, at most about 45 words, beginning with the kind of thing it is ("a tilt-head stand \
mixer with…"). A brief, not a spec sheet. Return only the brief.`;

export const DescribeEquipmentSubjectInputSchema = z.object({
  // The equipment item's name, verbatim from the manifest. By contract this
  // already carries the make and model (identifyEquipment.ts's system rule 1),
  // so there is no separate make/model field to read and none should be added.
  name: z.string().min(1),
  // Optional additive steer, appended verbatim after the name. Never alters the
  // scope rules above.
  hint: z.string().optional(),
});

export const DescribeEquipmentSubjectOutputSchema = z.object({
  brief: z.string().min(1),
});

export const describeEquipmentSubjectFlow = ai.defineFlow(
  {
    name: 'describeEquipmentSubject',
    inputSchema: DescribeEquipmentSubjectInputSchema,
    outputSchema: DescribeEquipmentSubjectOutputSchema,
  },
  async ({ name, hint }) => {
    setActiveSpanName(`describeEquipmentSubject: ${name}`);

    const trimmedHint = hint?.trim();
    const promptParts = [
      `Equipment name: ${name}`,
      trimmedHint ? `Additional guidance: ${trimmedHint}` : null,
    ].filter((p): p is string => p !== null);

    // No per-flow override id is passed: registering one means editing
    // AI_FLOW_ROLES in @salt/domain/schemas, which Phase 1 must not touch. Role
    // resolution ('fast') is the documented behaviour when flowId is omitted.
    const modelId = await resolveModel('fast');
    const model = googleAI.model(modelId);

    const result = await withAiTimeout(
      'describeEquipmentSubject',
      () =>
        ai.generate({
          model,
          system: DESCRIBE_EQUIPMENT_SYSTEM,
          prompt: promptParts.join('\n\n'),
          output: { schema: DescribeEquipmentSubjectOutputSchema },
        }),
      // House text-flow values, as describeRecipeScene. No retry: the trigger
      // treats a failure as "no brief" and the item simply waits for the next
      // manifest write, and a human pressing a button can press it again —
      // neither gains from burning the budget on an automatic second attempt.
      { timeoutMs: 55_000, retries: 0 },
    );

    // AI output is a trust boundary — validate before it leaves the flow.
    const parsed = DescribeEquipmentSubjectOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      throw new Error(`describeEquipmentSubject returned invalid output: ${parsed.error.message}`);
    }

    return { brief: parsed.data.brief.trim() };
  },
);
