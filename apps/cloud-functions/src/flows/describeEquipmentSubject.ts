import { googleAI } from '@genkit-ai/google-genai';
import {
  DescribeEquipmentSubjectInputSchema,
  DescribeEquipmentSubjectOutputSchema,
} from '@salt/domain/schemas';
import { setActiveSpanName } from '@salt/observability/server';
import { ai } from '../genkit.js';
import { AI_TEXT_FLOW_TIMEOUT, withAiTimeout } from '../adapters/withAiTimeout.js';
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
// Since #885 it is ALSO a callable, run from the item page's Revise and Start
// over buttons. Two shapes, one flow: `currentBrief` + `hint` REVISES the
// sentence per the correction; neither authors from scratch, which is what the
// manifest trigger sends and what "Start over" deliberately sends too. The
// callable PERSISTS NOTHING — `drawEquipmentIcon` remains the only writer of
// `subjectBrief` — so iterating the words is free and only the picture costs.
// Its schemas therefore live in `@salt/domain/schemas` (a callable input is a
// trust boundary), mirroring describeRecipeScene.
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

// The two binding scope rules, hoisted into constants because EVERY system prompt
// here — authoring and revising — must say them identically. A paraphrase in the
// revision prompt would be a loophole in exactly the place it matters most: a
// steer is user text, so "make it black, flat vector with a drop shadow and the
// logo on the front" must not become a per-item vote on the house style.
const SUBJECT_TEXT_RULE = `Never mention the brand name, the model number, a logo, a badge, a wordmark, or any \
lettering, writing or numbers on the item. The illustration carries no text of any kind, so anything you say about \
text is discarded — describe shape, colour, finish and controls instead.`;

const SUBJECT_SCOPE_RULE = `Do NOT write about illustration style, line weight, colour palette, outlines, shading, \
framing, background, or what must not appear in the picture — those are fixed elsewhere and anything you say about \
them is discarded.`;

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

${SUBJECT_TEXT_RULE}

${SUBJECT_SCOPE_RULE}

Write ONE sentence of plain prose, at most about 45 words, beginning with the kind of thing it is ("a tilt-head stand \
mixer with…"). A brief, not a spec sheet. Return only the brief.`;

// REVISION MODE (issue #885) — "it's matte black, not cream" applied to a
// description that already exists, rather than a fresh authoring pass.
//
// The failure this prompt exists to prevent is the cheap one: bolting the
// correction on as a trailing clause and leaving the rest of the sentence
// contradicting it — "a cream enamel stand mixer with a chrome bowl, but matte
// black" describes nothing an illustrator can draw. So the instruction is to fold
// the correction THROUGH the sentence, and to leave everything it does not touch
// exactly as it was: the user chose to keep the parts they did not mention.
//
// The NAME goes in here too, not just the sentence. Revising prose about an
// appliance without knowing which appliance drifts away from the actual device —
// the same failure the brief step exists to fix.
//
// SCOPE is identical to authoring, via the same two constants: this describes
// what the thing IS. The anchors stay locked in equipmentIconPrompt.ts and are
// appended after the brief, and the last clause below says so even when the
// correction itself asks otherwise.
const REVISE_EQUIPMENT_SYSTEM = `You are an illustrator's art director. You are given the name of one piece of \
kitchen equipment, an existing visual brief describing what it looks like, and a correction from the person who owns \
it. Rewrite the brief so it incorporates the correction.

Fold the correction THROUGH the whole brief. If the correction is "it's matte black, not cream", then the body \
colour and the finish move together — do NOT keep a cream body in the sentence and staple "but black" on the end. \
The result must read as one coherent brief that was always written that way.

Keep everything the correction does not touch. Anything the brief already says that still holds should survive the \
rewrite — this is a revision, not a fresh start.

The person correcting it is looking at the actual item, so prefer what they say over what you know about the model. \
If they add a feature you did not mention — a water tank down one side, a second dial — work it into the silhouette \
and the control layout rather than appending it.

${SUBJECT_TEXT_RULE}

${SUBJECT_SCOPE_RULE} That holds even if the correction asks for it.

Write ONE sentence of plain prose, at most about 45 words, beginning with the kind of thing it is ("a tilt-head stand \
mixer with…"). A brief, not a spec sheet. Return only the revised brief.`;

export const describeEquipmentSubjectFlow = ai.defineFlow(
  {
    name: 'describeEquipmentSubject',
    inputSchema: DescribeEquipmentSubjectInputSchema,
    outputSchema: DescribeEquipmentSubjectOutputSchema,
  },
  async ({ name, currentBrief, hint }) => {
    setActiveSpanName(`describeEquipmentSubject: ${name}`);

    const trimmedHint = hint?.trim();
    const trimmedBrief = currentBrief?.trim();
    // Revision needs BOTH halves: a sentence to revise and a correction to revise
    // it by. With either missing there is nothing to fold through anything, so we
    // author from scratch — which is also, deliberately, what "Start over" sends
    // (neither), so a description edited into a corner can be thrown away for a
    // fresh reading of the item's name.
    const revising = Boolean(trimmedBrief && trimmedHint);

    const promptParts = [
      // The name stays FIRST on a revision too: the device is the anchor, and the
      // brief and the correction are the edit applied on top of it.
      `Equipment name: ${name}`,
      revising ? `Current brief:\n${trimmedBrief}` : null,
      revising ? `Requested change: ${trimmedHint}` : null,
      // Authoring keeps its original shape: a steer with no brief to revise is
      // still an additive nudge on a fresh description.
      !revising && trimmedHint ? `Additional guidance: ${trimmedHint}` : null,
    ].filter((p): p is string => p !== null);

    const modelId = await resolveModel('fast', 'describeEquipmentSubject');
    const model = googleAI.model(modelId);

    const result = await withAiTimeout(
      'describeEquipmentSubject',
      () =>
        ai.generate({
          model,
          system: revising ? REVISE_EQUIPMENT_SYSTEM : DESCRIBE_EQUIPMENT_SYSTEM,
          prompt: promptParts.join('\n\n'),
          output: { schema: DescribeEquipmentSubjectOutputSchema },
        }),
      // No retry (the shared budget's): the trigger
      // treats a failure as "no brief" and the item simply waits for the next
      // manifest write, and a human pressing a button can press it again —
      // neither gains from burning the budget on an automatic second attempt.
      AI_TEXT_FLOW_TIMEOUT,
    );

    // AI output is a trust boundary — validate before it leaves the flow.
    const parsed = DescribeEquipmentSubjectOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      throw new Error(`describeEquipmentSubject returned invalid output: ${parsed.error.message}`);
    }

    return { brief: parsed.data.brief.trim() };
  },
);
