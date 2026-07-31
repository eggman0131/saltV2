import { googleAI } from '@genkit-ai/google-genai';
import {
  DescribeRecipeSceneInputSchema,
  DescribeRecipeSceneOutputSchema,
  type DescribeRecipeSceneInput,
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
//
// The scope rule itself is hoisted into ONE constant because every system prompt
// here — recipe, outing, cocktail and placeholder, authoring and revising — must
// say it identically. It
// is the sentence that keeps the brief on the dish-specific half; a per-kind
// paraphrase of it is a per-kind loophole in the house style.
const SCENE_SCOPE_RULE = `Do NOT write about photographic style, lighting, lens, framing, camera angle, or what must not appear in the shot — those are fixed elsewhere and anything you say about them is discarded.`;

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

${SCENE_SCOPE_RULE} Do not restate the recipe, do not list \
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

// ─── OUTINGS (issue #637) ────────────────────────────────────────────────────
// An outing is a takeaway, a picnic or a meal out. The recipe prompt above is
// built on a premise an outing cannot satisfy — "read the whole recipe, especially
// the METHOD and the INGREDIENTS" — because an outing has neither. All the model
// gets is a title and a hand-written description, and asked the recipe question it
// invents a plated, cooked-from-scratch dish: exactly the picture an outing is not.
//
// So the question changes. Not "what does this look like once it is cooked and
// plated" but "what does this look like as it ARRIVES" — in the box, the tray, the
// wrapping, the spread on the blanket, the plate the restaurant sent out.
//
// SCOPE is identical to the recipe prompts and inherits the same rule verbatim:
// the subject half ONLY. The anchors stay locked in generateRecipeImage.ts and are
// appended after the brief. This matters MORE here than for recipes: with no
// method for the model to read, editing the brief by hand is the stated primary way
// a user gets an outing's hero right, so the brief is user text far more often.
const DESCRIBE_OUTING_SCENE_SYSTEM = `You are a food photographer's art director. You are given one OUTING — a takeaway, \
a picnic, a chippy tea, a street-food stop or a meal out — with its title, description and tags. Write a short \
art-direction brief for a photograph of that food.

This food was not cooked here. There is no method and no ingredient list, and there is no plating up to describe. \
Describe the food AS IT ARRIVES: what it comes in and what it looks like when it is opened out in front of you. \
Read the title and description for what kind of outing it is and what cuisine it is, and let that decide everything \
else.

Cover only what is specific to THIS outing:
- what the food itself looks like — colour, texture, char, glaze, sauce, steam, how it is piled or laid out
- the vessel and packaging it arrives in — the foil tray, the carton, the pizza box, the paper wrapping, the tub, \
the restaurant's own plate — and how it is opened out or spread
- where it is eaten and what it is set down on, and the mood, occasion and cuisine the outing reads as

${SCENE_SCOPE_RULE} Do not describe cooking it, do not invent a method or an ingredient list, and do not turn it into \
a home-cooked dish plated onto crockery.

Write ONE paragraph of plain prose, at most about 80 words. A brief, not an essay. Return only the brief.`;

// The outing counterpart to REVISE_SCENE_SYSTEM. Same failure it exists to prevent
// (a steer stapled on the end, contradicting the paragraph it was added to), same
// "keep what the change does not touch" rule — but anchored to the outing rather
// than to a recipe the model could otherwise drift into inventing.
const REVISE_OUTING_SCENE_SYSTEM = `You are a food photographer's art director. You are given one OUTING — a \
takeaway, a picnic or a meal out — an existing art-direction brief for a photograph of that food, and a requested \
change from the person who will use it. Rewrite the brief so it incorporates the requested change.

Fold the change THROUGH the whole brief. If the change is "make it a picnic", then the vessel, the setting, the \
surface, the light and the mood all move together — do NOT keep an indoor-takeaway brief and staple "make it a \
picnic" on the end. The result must read as one coherent brief that was always written that way, never as an edit \
with a contradiction left in it.

Keep everything the requested change does not touch. Anything the brief already says that still holds should survive \
the rewrite — this is a revision, not a fresh start.

Stay true to the outing. The change re-directs how the food is SHOT and styled; it must not turn it into food this \
outing does not serve, and it must never turn it into a home-cooked dish plated onto crockery.

Cover only what is specific to THIS outing: the food's appearance, the vessel and packaging it arrives in, where it \
is eaten, and the mood, occasion and cuisine it reads as. ${SCENE_SCOPE_RULE} That holds even if the requested \
change asks for it.

Write ONE paragraph of plain prose, at most about 80 words. Return only the revised brief.`;

// ─── COCKTAILS (issue #637) ──────────────────────────────────────────────────
// A cocktail sits on the opposite side of the outing from a recipe. An outing had
// to lose the "read the method" premise because it has no method; a cocktail keeps
// it in full — 50ml gin, 25ml Campari, stir over ice, strain, orange twist is an
// ingredient list and a method, and it is where every visual fact about the drink
// lives. What has to change is the SUBJECT the model is asked to describe: the
// recipe prompt asks what the dish looks like "once it is cooked and plated", and
// there is no plating up a Negroni. Asked the recipe question, the model reaches
// for crockery and a garnish it can serve with a fork.
//
// So this prompt asks the same reading question against the glass: the spirits set
// the colour, the technique (stirred vs shaken vs built) sets the clarity and the
// texture, and the serve (straight up vs on the rocks, the ice, the garnish) IMPLIES
// the glassware. All four are things only the method knows.
//
// SCOPE is identical to the other prompts and inherits the same rule verbatim.
const DESCRIBE_COCKTAIL_SCENE_SYSTEM = `You are a drinks photographer's art director. You are given one COCKTAIL — its \
title, description, tags, ingredients and method. Write a short art-direction brief for a photograph of the FINISHED \
drink in its glass.

Read the whole recipe, especially the METHOD and the INGREDIENTS: they carry everything the drink actually looks like \
once it is made. The spirits, liqueurs, juices and bitters set the colour and the clarity — water-clear, blush pink, \
deep amber, cloudy, layered. The technique sets the texture: stirred is silky and crystal clear, shaken is livelier \
and often carries a fine pale foam, a build over ice is bright and beaded. And the serve the method calls for — \
straight up or over ice, the ice cubed or cracked or crushed, the twist or the wedge or the sprig placed at the end — \
is what implies the glass it belongs in. None of this is in the title.

Cover only what is specific to THIS drink:
- what is in the glass — colour, clarity, foam or crema, layers, bubbles, the ice and how it sits
- the glassware the serve implies, and the garnish and finishing touch the method calls for
- the bar surface it stands on, and the hour, mood and character the drink reads as, and why the drink implies that

${SCENE_SCOPE_RULE} Do not restate the recipe, do not list \
quantities or measures, and do not give instructions for making it.

Write ONE paragraph of plain prose, at most about 80 words. A brief, not an essay. Return only the brief.`;

// The cocktail counterpart to REVISE_SCENE_SYSTEM. Same failure it exists to
// prevent (a steer stapled on the end, contradicting the paragraph it was added
// to), same "keep what the change does not touch" rule — but anchored to the drink,
// so a steer re-directs the SHOT and never quietly re-pours what is in the glass.
const REVISE_COCKTAIL_SCENE_SYSTEM = `You are a drinks photographer's art director. You are given one COCKTAIL, an \
existing art-direction brief for a photograph of the finished drink, and a requested change from the person who will \
use it. Rewrite the brief so it incorporates the requested change.

Fold the change THROUGH the whole brief. If the change is "make it a summer afternoon", then the light, the bar \
surface, the props, the palette and the mood all move together — do NOT keep a late-night brief and staple "make it a \
summer afternoon" on the end. The result must read as one coherent brief that was always written that way, never as \
an edit with a contradiction left in it.

Keep everything the requested change does not touch. Anything the brief already says that still holds should survive \
the rewrite — this is a revision, not a fresh start.

Stay true to the recipe. The change re-directs how the drink is SHOT and styled; it must not turn it into a drink \
this recipe does not make. What is in the glass — its colour, clarity, ice, foam and garnish — and the glassware the \
serve implies are set by the method and the ingredients, not by the requested change.

Cover only what is specific to THIS drink: what is in the glass, the glassware, the garnish, the bar surface, and the \
hour and mood it reads as. ${SCENE_SCOPE_RULE} That holds even if the requested change asks for it.

Write ONE paragraph of plain prose, at most about 80 words. Return only the revised brief.`;

// ─── PLACEHOLDERS (issue #652) ───────────────────────────────────────────────
// A placeholder goes further than an outing did. An outing lost the method and
// the ingredients but kept a subject — a curry, a chippy tea, something the model
// can picture. A placeholder has no subject at all: it is the picture a night
// gets when the plan was a sentence, and it is attached to many different
// evenings, so naming a dish is the one thing it must never do.
//
// So the reading question, which all three other prompts ask of the thing, has
// nothing to ask it of. What is left to read is the MOOD — the entry is tagged
// `bright` or `comfort` — and the brief's job is to turn that into a scene: which
// lead the picture takes, what light it is in, what it is set on.
//
// The illegibility rule is NOT trusted to this prompt. It lives in the locked
// anchors in generateRecipeImage.ts, appended after every brief, precisely
// because a brief is editable and this rule is the feature. Saying it here too is
// belt and braces on the authoring pass — the braces are the anchors.
//
// SCOPE is identical to the other prompts and inherits the same rule verbatim.
const DESCRIBE_PLACEHOLDER_SCENE_SYSTEM = `You are a food photographer's art director. You are given one PLACEHOLDER — a \
stock photograph that stands in for dinner on an evening someone planned in a sentence. Write a short art-direction \
brief for it.

There is no dish here, and there must not be one. This picture says "a good dinner is planned" and never says what \
dinner is. Do not invent a meal, do not name one, and do not describe a plate of anything recognisable: any food in \
the frame stays generic, or is lost to steam, to focus, to a lid, to the edge of the shot.

What you read instead is the MOOD, which the tags carry: "bright" is cool daylight, pale crockery, clear glass, a \
sunlit table, air and space; "comfort" is lamplight, steam, warm ceramics, deep colours, a dark evening indoors. Let \
the mood decide the scene.

Cover only what is specific to THIS placeholder:
- what LEADS the picture — it need not be food: a glass of wine mid-pour, a cloche waiting to be lifted, steam rising \
off a bowl, a serving dish so close and so soft that only warmth and colour survive
- what sits behind and around the lead, unresolved — the table, the surface, the props, the light in the room
- the mood, the hour and the season it reads as, and why the tags imply that

${SCENE_SCOPE_RULE} It must read warm and appetising — an evening someone is about to enjoy — and never a cold, empty \
table or a styled still life with nothing about to be eaten.

Write ONE paragraph of plain prose, at most about 80 words. A brief, not an essay. Return only the brief.`;

// The placeholder counterpart to REVISE_SCENE_SYSTEM. Same failure it exists to
// prevent (a steer stapled on the end, contradicting the paragraph it was added
// to), same "keep what the change does not touch" rule — but with one extra
// guard the other three do not need: the steer here is the primary way these ten
// pictures get good, so "make it a roast dinner" is a plausible thing to type,
// and it is the one change this brief must not fold in.
const REVISE_PLACEHOLDER_SCENE_SYSTEM = `You are a food photographer's art director. You are given one PLACEHOLDER — a \
stock photograph that stands in for dinner on an evening planned in a sentence — an existing art-direction brief for \
it, and a requested change from the person who will use it. Rewrite the brief so it incorporates the requested change.

Fold the change THROUGH the whole brief. If the change is "make it a winter evening", then the light, the surface, \
the props, the palette and the lead all move together — do NOT keep a bright summer brief and staple "make it a \
winter evening" on the end. The result must read as one coherent brief that was always written that way, never as an \
edit with a contradiction left in it.

Keep everything the requested change does not touch. Anything the brief already says that still holds should survive \
the rewrite — this is a revision, not a fresh start.

There is still no dish, whatever the change asks for. If the requested change names a meal, take from it only the \
mood, the season, the colour and the light, and never the dish itself: any food in the frame stays generic or lost to \
steam, focus, a lid or the edge of the shot. This picture must never become one anyone could name.

Cover only what is specific to THIS placeholder: what leads the picture, what sits unresolved behind it, and the \
mood, hour and season it reads as. ${SCENE_SCOPE_RULE} That holds even if the requested change asks for it.

Write ONE paragraph of plain prose, at most about 80 words. Return only the revised brief.`;

// The kind switch. 'recipe' is the DEFAULT arm, so an absent kind (an older
// caller, a doc written before #637) and any kind with no prompts of its own get
// exactly today's prompts rather than nothing.
function systemFor(kind: DescribeRecipeSceneInput['kind'], revising: boolean): string {
  switch (kind) {
    case 'outing':
      return revising ? REVISE_OUTING_SCENE_SYSTEM : DESCRIBE_OUTING_SCENE_SYSTEM;
    case 'cocktail':
      return revising ? REVISE_COCKTAIL_SCENE_SYSTEM : DESCRIBE_COCKTAIL_SCENE_SYSTEM;
    case 'placeholder':
      return revising ? REVISE_PLACEHOLDER_SCENE_SYSTEM : DESCRIBE_PLACEHOLDER_SCENE_SYSTEM;
    default:
      return revising ? REVISE_SCENE_SYSTEM : DESCRIBE_SCENE_SYSTEM;
  }
}

export const describeRecipeSceneFlow = ai.defineFlow(
  {
    name: 'describeRecipeScene',
    inputSchema: DescribeRecipeSceneInputSchema,
    outputSchema: DescribeRecipeSceneOutputSchema,
  },
  async ({ title, description, ingredients, steps, currentBrief, hint, kind }) => {
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
          system: systemFor(kind, revising),
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
