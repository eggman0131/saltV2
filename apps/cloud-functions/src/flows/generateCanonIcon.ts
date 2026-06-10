import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { setActiveSpanName } from '@salt/ld-observability/server';
import { ai } from '../genkit.js';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { loadCanonIconSeed } from './assets/canonIconSeed.js';

// Tier-1 canon-item pictogram generation (issue #148).
//
// Reference-conditioned off the committed red-apple seed: the model copies ONLY
// the rendering style of the seed, not its subject. The prompt is reproduced
// VERBATIM from docs/canon-icons.md → "Proven prompt"; do NOT paraphrase —
// wording changes drift the house style. The negative clauses are keyed to the
// red-apple seed (see canonIconSeed.ts) — update them if the seed changes.

const IMAGE_MODEL = googleAI.model('gemini-2.5-flash-image');

// Image generation is far slower than text (~5–8s, occasionally more). Give it
// a generous deadline; the trigger's function timeout is raised to match.
const ICON_GEN_TIMEOUT_MS = 60_000;

// Shared style string (STYLE) — verbatim from docs/canon-icons.md.
const STYLE =
  'Flat vector cartoon illustration. A single centered subject filling most of the frame. Thick, uniform, rounded dark outline. Soft cheerful limited pastel colour palette. Simple minimal friendly shapes, low detail. Plain solid off-white background. No border or frame around the image; the subject sits directly on the plain background. No faces, no eyes, no facial expressions on any object. No text, no labels, no brand logos, no packaging branding. No drop shadows, no background gradients. Square composition, app sticker / emoji style.';

// UK steer string (UK) — verbatim from docs/canon-icons.md.
const UK = 'The item is as commonly sold in a UK supermarket.';

// Per-item generation prompt (Step 2) — verbatim from docs/canon-icons.md, with
// {ITEM}, {UK} and {STYLE} substituted. The apple/leaf/red negatives are keyed
// to the committed red-apple seed. An optional user `hint` is appended verbatim
// as additive guidance — it never alters the locked house-style wording.
function buildIconPrompt(item: string, hint?: string): string {
  const base = `Generate a cute cartoon icon of ${item}. ${UK} Copy ONLY the rendering STYLE of the reference image — its line weight, outline, colouring technique, palette and plain background. Do NOT copy the apple, and do NOT add any leaf, stem, sprig, red colouring or face that came from the reference. Draw only ${item} and nothing else. ${STYLE}`;
  const trimmed = hint?.trim();
  return trimmed ? `${base} Additional guidance for this item: ${trimmed}` : base;
}

function parseDataUrl(url: string): { contentType: string; base64: string } {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(url);
  if (!match) {
    throw new Error('generateCanonIcon: model media is not a base64 data URI');
  }
  return { contentType: match[1]!, base64: match[2]! };
}

export const GenerateCanonIconInputSchema = z.object({
  name: z.string().min(1),
  // Optional additive steer (issue #148) appended to the locked prompt.
  hint: z.string().optional(),
});

// Raw generated image bytes, base64-encoded (Genkit flow outputs must be
// JSON-serialisable). The caller decodes to a Buffer before background removal.
export const GenerateCanonIconOutputSchema = z.object({
  imageBase64: z.string(),
  contentType: z.string(),
});

export const generateCanonIconFlow = ai.defineFlow(
  {
    name: 'generateCanonIcon',
    inputSchema: GenerateCanonIconInputSchema,
    outputSchema: GenerateCanonIconOutputSchema,
  },
  async ({ name, hint }) => {
    setActiveSpanName(`generateCanonIcon: ${name}`);
    const seed = loadCanonIconSeed();

    const result = await withAiTimeout(
      'generateCanonIcon',
      () =>
        ai.generate({
          model: IMAGE_MODEL,
          prompt: [
            { media: { url: seed.url, contentType: seed.contentType } },
            { text: buildIconPrompt(name, hint) },
          ],
        }),
      { timeoutMs: ICON_GEN_TIMEOUT_MS, retries: 1 },
    );

    const media = result.media;
    if (!media?.url) {
      throw new Error('generateCanonIcon: model returned no image');
    }

    const { base64, contentType } = parseDataUrl(media.url);
    return { imageBase64: base64, contentType };
  },
);
