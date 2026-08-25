import { z } from 'genkit';
import { defineIconFlow } from './defineIconFlow.js';

// Tier-1 canon-item pictogram generation (issue #148).
//
// The generation body lives in defineIconFlow.ts, shared with the equipment and
// kitchen-tool families (issue #989). What stays here is what is genuinely
// canon's: the locked house-style wording, the UK steer, and the prompt builder.
//
// The prompt is reproduced VERBATIM from docs/canon-icons.md → "Proven prompt";
// do NOT paraphrase — wording changes drift the house style. The negative
// clauses are keyed to the red-apple seed (see canonIconSeed.ts) — update them if
// the seed changes.

// Shared style string (STYLE) — verbatim from docs/canon-icons.md. Exported so
// the weather-icon generator (issue #387), the equipment builder (#877) and the
// kitchen-tool builder (#882) reuse the locked house style WITHOUT copying the
// wording; do not change this literal's text.
export const STYLE =
  'Flat vector cartoon illustration. A single centered subject filling most of the frame. Thick, uniform, rounded dark outline. Soft cheerful limited pastel colour palette. Simple minimal friendly shapes, low detail. Plain solid off-white background. No border or frame around the image; the subject sits directly on the plain background. No faces, no eyes, no facial expressions on any object. No caption text, no separate labels, and no lettering added under, beside, or around the subject; any text must be part of the depicted item itself (such as wording printed on a tin or jar). No drop shadows, no background gradients. Square composition, app sticker / emoji style.';

// UK steer string (UK) — verbatim from docs/canon-icons.md.
const UK = 'The item is as commonly sold in a UK supermarket.';

// Per-item generation prompt (Step 2) — verbatim from docs/canon-icons.md, with
// {ITEM}, {UK} and {STYLE} substituted. The apple/leaf/red negatives are keyed
// to the committed red-apple seed. An optional user `hint` is appended verbatim
// as additive guidance — it never alters the locked house-style wording.
//
// Exported so getImagePrompt (issue #892) can show a person the exact words that
// draw their picture by CALLING this builder. A second copy of the wording is the
// failure mode docs/canon-icons.md warns about and placeholderVocabulary.ts exists
// to undo, so the read-only view shares the builder rather than restating it.
export function buildIconPrompt(item: string, hint?: string): string {
  const base = `Generate a cute cartoon icon of ${item}. ${UK} Copy ONLY the rendering STYLE of the reference image — its line weight, outline, colouring technique, palette and plain background. Do NOT copy the apple, and do NOT add any leaf, stem, sprig, red colouring or face that came from the reference. Draw only ${item} and nothing else. ${STYLE}`;
  const trimmed = hint?.trim();
  return trimmed ? `${base} Additional guidance for this item: ${trimmed}` : base;
}

export const GenerateCanonIconInputSchema = z.object({
  name: z.string().min(1),
  // Optional additive steer (issue #148) appended to the locked prompt.
  hint: z.string().optional(),
});

export const generateCanonIconFlow = defineIconFlow({
  name: 'generateCanonIcon',
  inputSchema: GenerateCanonIconInputSchema,
  subjectOf: ({ name }) => name,
  promptOf: ({ name, hint }) => buildIconPrompt(name, hint),
});
