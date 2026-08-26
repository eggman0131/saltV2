import { STYLE } from './generateCanonIcon.js';

// Kitchen-tool pictogram prompt builder (issue #882).
//
// FOURTH subject family on the Tier-1 canon pictogram system
// (docs/canon-icons.md, issue #148), after groceries (generateCanonIcon.ts),
// weather (#387) and equipment (#877). Product forms (#871) are not a fifth: they
// reuse the grocery prompt unchanged, because a form IS a grocery. The house style is
// IMPORTED verbatim, never copied or re-authored: `STYLE` comes straight from
// generateCanonIcon.ts so a whisk and a lemon share one rendering language.
//
// Three differences from the families it sits between:
//
//   1. `STYLE` is kept WHOLE, as equipment keeps it. Weather strips canon's
//      "A single centered subject filling most of the frame." clause because a
//      weather pictogram is a composite scene (sun behind a cloud). A rolling pin
//      IS a single centred subject, so there is no clause surgery to do and none
//      is done — no `.replace()`, nothing to drift out of sync if the canon
//      wording is ever edited.
//   2. The UK-supermarket steer is OMITTED. Canon carries it because a canon item
//      is a thing you buy in a shop and the UK form is the one the family will
//      recognise on a shelf. A whisk is not a supermarket product; steering the
//      model toward retail packaging for a hand tool is at best noise and at
//      worst a drawing of a boxed whisk on a shelf.
//   3. The no-lettering prohibition is an ADDITION, not an edit — the same gap
//      equipment closes, for the same reason. `STYLE` bans lettering *added*
//      around the subject but explicitly permits text that is physically part of
//      the depicted item ("wording printed on a tin or jar"), which is exactly
//      where a brand stamped on a pan handle or a scale's display sits. At a 32px
//      mise-card tile a wordmark is an illegible smudge, and misspelt text is the
//      classic image-model failure. So KIT_STYLE_ANCHORS closes the gap below;
//      `STYLE`'s own wording is untouched, because groceries genuinely want the
//      wording on the tin.
//
// ─── The #671 rule this file exists to obey ─────────────────────────────────
// The anchors are LOCKED IN CODE and appended LAST on every prompt, and they
// carry STYLE AND PROHIBITIONS ONLY — never a subject noun. Anything concrete
// enumerated in a block that is byte-identical across every document outranks
// everything the per-item wording says, and every picture comes back the same
// (generateRecipeImage.ts:96-108 is the post-mortem). So there is no "a tool on a
// worktop" here: what the thing IS comes from the tool's own label, which is
// curated by hand and is the one part a person reads and corrects.

// House-style additions for the kitchen-tool family. Prohibitions only — nothing
// here names or implies a subject. Appended AFTER `STYLE`, and nothing may be
// appended after this.
//
// PAIRED with EQUIPMENT_STYLE_ANCHORS (equipmentIconPrompt.ts). The shared
// skeleton — "Absolutely no lettering anywhere… no brand name, no wordmark, no
// logo, no model number… Draw the object alone… and nothing beside it for
// scale" — is deliberately the same wording in both. What differs is the part
// enumerations, and that differs on purpose: a hand tool bans measurement
// markings and keeps its handle, body, blade and rim blank, where an
// appliance's list runs body/lid/controls/dials/cables instead. The divergence
// is per-family tailoring, not drift (#894 B4-008) — do not converge the two
// wordings.
export const KIT_STYLE_ANCHORS =
  'Absolutely no lettering anywhere in the picture, including on the object itself: no brand name, no wordmark, no logo, no model number, no measurement markings, no letters, digits or symbols on the handle, the body, the blade, the rim or any display panel — leave every badge, panel and screen blank. Draw the object alone: no hands, no people, no food, no ingredients, no liquid, no worktop, no chopping surface, no kitchen scene, and nothing beside it for scale.';

/**
 * Builds the text prompt for one kitchen-tool pictogram.
 *
 * `label` is the whole subject and is meant to be generic — "Mixing bowl",
 * "Balloon whisk". That genericness is the feature, not a limitation: this family
 * draws the tool a recipe MEANS when it says "a large bowl", not the particular
 * bowl anybody owns. (Equipment is the family that draws a specific appliance,
 * and it needs a per-item brief precisely because it does.)
 *
 * `hint` is the optional one-shot steer written onto the document by a person
 * whose last drawing came back wrong. It is appended VERBATIM as additive
 * guidance, exactly as the canon prompt does it, and never alters the locked
 * wording ahead of it.
 *
 * The seed-conditioning negatives are keyed to the committed red-apple seed
 * (flows/assets/canonIconSeed.ts) and carry over from the canon prompt unchanged.
 */
export function buildKitchenToolIconPrompt(label: string, hint?: string): string {
  const base = `Generate a cute cartoon icon of ${label}, one generic piece of kitchen equipment as found in a home kitchen. Copy ONLY the rendering STYLE of the reference image — its line weight, outline, colouring technique, palette and plain background. Do NOT copy the apple, and do NOT add any leaf, stem, sprig, red colouring or face that came from the reference. Draw only ${label} and nothing else. ${STYLE} ${KIT_STYLE_ANCHORS}`;
  const trimmed = hint?.trim();
  return trimmed ? `${base} Additional guidance for this item: ${trimmed}` : base;
}
