import { STYLE } from './generateCanonIcon.js';

// Equipment-pictogram prompt builder (issue #877).
//
// Third subject family on the Tier-1 canon pictogram system (docs/canon-icons.md,
// issue #148), after groceries (generateCanonIcon.ts) and weather (#387). The
// house style is IMPORTED verbatim, never copied or re-authored: `STYLE` comes
// straight from generateCanonIcon.ts so a Kenwood pictogram and a milk pictogram
// share one rendering language.
//
// Two differences from the weather case, which is otherwise the precedent this
// file follows:
//
//   1. `STYLE` is kept WHOLE. Weather strips canon's "A single centered subject
//      filling most of the frame." clause because a weather pictogram is a
//      composite scene (sun behind a cloud). A kettle IS a single centred
//      subject, so there is no surgery to do and none is done — no `.replace()`,
//      nothing to drift out of sync if the canon wording is ever edited.
//   2. The no-lettering prohibition is an ADDITION, not an edit. `STYLE` bans
//      lettering *added* around the subject but explicitly permits text that is
//      physically part of the depicted item ("wording printed on a tin or jar").
//      A brand wordmark on an appliance body sits exactly in that gap, and this
//      family must never render one — at a 40px row tile a wordmark is an
//      illegible smudge, misspelt text is the classic image-model failure, and
//      the feature deliberately takes its likeness from silhouette, colour and
//      control layout instead. So EQUIPMENT_STYLE_ANCHORS closes the gap below;
//      `STYLE`'s own wording is untouched.
//
// ─── The #671 rule this file exists to obey ─────────────────────────────────
// The anchors are LOCKED IN CODE and appended LAST on every prompt, and they
// carry STYLE AND PROHIBITIONS ONLY — never a subject noun. Anything concrete
// enumerated in a block that is byte-identical across every document outranks
// everything the per-item brief says, and every picture comes back the same
// (generateRecipeImage.ts:96-108 is the post-mortem). So there is no "an
// appliance on a worktop" here: what the thing IS belongs to the brief, which is
// authored per item by describeEquipmentSubject and is the one part the user can
// read and correct.

// House-style additions for the equipment family. Prohibitions only — nothing
// here names or implies a subject. Appended AFTER `STYLE`, and nothing may be
// appended after this.
export const EQUIPMENT_STYLE_ANCHORS =
  'Absolutely no lettering anywhere in the picture, including on the object itself: no brand name, no wordmark, no logo, no model number, no letters, digits or symbols on the body, the lid, the controls, the dials, the buttons or any display panel — leave every panel, badge and screen blank. Draw the object alone: no hands, no people, no food, no ingredients, no worktop, no wall, no kitchen scene, no cable trailing off the frame, and nothing beside it for scale.';

/**
 * Builds the text prompt for one equipment pictogram.
 *
 * `brief` is the per-item visual description authored by
 * `describeEquipmentSubject` (and, in the running app, read and possibly
 * corrected by the user before it gets here). When present it IS the subject:
 * the make and model are deliberately NOT passed through to the image model,
 * because the brief already carries the likeness in brand-free words — shape,
 * colour, finish, control layout — and putting "Kenwood Chef KVC3100S" in front
 * of an image model is the single strongest pull toward painting a wordmark the
 * anchors then have to fight.
 *
 * With no brief (the degraded path — the describe step failed) the name is the
 * only thing left, so it is used and the result lands at genre level. That is
 * the accepted degradation, not the target.
 *
 * The seed-conditioning negatives are keyed to the committed red-apple seed
 * (flows/assets/canonIconSeed.ts) and carry over from the canon prompt unchanged.
 */
export function buildEquipmentIconPrompt(name: string, brief?: string): string {
  const trimmedBrief = brief?.trim();
  const subject = trimmedBrief
    ? `Generate a cute cartoon icon of one piece of kitchen equipment. Draw exactly this: ${trimmedBrief}`
    : `Generate a cute cartoon icon of ${name}, one piece of kitchen equipment.`;

  return `${subject} Copy ONLY the rendering STYLE of the reference image — its line weight, outline, colouring technique, palette and plain background. Do NOT copy the apple, and do NOT add any leaf, stem, sprig, red colouring or face that came from the reference. Draw only this one item and nothing else. ${STYLE} ${EQUIPMENT_STYLE_ANCHORS}`;
}
