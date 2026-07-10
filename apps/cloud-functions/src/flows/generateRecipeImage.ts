import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { setActiveSpanName } from '@salt/observability/server';
import { ai } from '../genkit.js';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { resolveModel } from '../ai/resolveModel.js';

// Tier-2 recipe hero-image generation (issue #148). The counterpart to the
// Tier-1 canon pictogram (generateCanonIcon.ts): where that paints a flat cartoon
// icon, this paints a PHOTOREALISTIC "arty" photograph of the finished dish from
// the recipe's title + description, in a consistent warm cookbook style.
//
// Two-tier system (docs/canon-icons.md): Tier 1 and Tier 2 never share size or
// context, so the styles deliberately do NOT match — this is prompt-only, no
// reference seed. Photoreal food photography is far more forgiving of prompt
// drift than the tiny pictograms were, so a single locked house-style prompt
// holds the look together across recipes. A committed style seed can be added
// later (mirroring loadCanonIconSeed) if cross-recipe consistency needs tightening.

// Image generation is far slower than text (~5–8s, occasionally more). Give it a
// generous deadline; the trigger's function timeout is raised to match.
const IMAGE_GEN_TIMEOUT_MS = 60_000;

// Locked house-style string (STYLE) — the "arty Nigella Lawson cookbook" look.
// This literal is load-bearing for cross-recipe consistency: do NOT paraphrase
// casually — reword it deliberately and review the output, exactly as with the
// canon-icon STYLE. Describes only the RENDERING (light, palette, styling, lens),
// never the dish itself — the dish comes from the recipe's title + description.
export const RECIPE_IMAGE_STYLE =
  'Style: a warm, intimate, photorealistic food photograph in the manner of a modern British home-cookbook — think generous, homely, unfussy comfort food shot with real affection. Soft natural window light from one side, gentle diffused shadows, a shallow depth of field with the dish in crisp focus and the surroundings falling softly out of focus. Rich, warm, slightly moody colour grade; earthy, appetising tones. The food is abundant and lovingly plated on rustic ceramic or worn crockery, set on a textured surface — aged wood, stone, or a crumpled linen cloth — with a few casual, lived-in props (a spoon, scattered herbs, a folded napkin) that feel real rather than styled to perfection. A three-quarter or gentle overhead angle. Absolutely no text, no captions, no watermark, no logos, no hands, no people. A single, mouth-watering hero shot of the finished dish that makes you want to eat it.';

// Per-recipe generation prompt. The dish identity comes from the recipe title and
// (when present) its description; an optional user `hint` is appended verbatim as
// additive guidance and never alters the locked house-style wording.
function buildRecipePrompt(title: string, description?: string | null, hint?: string): string {
  const desc = description?.trim();
  const dish = desc
    ? `A beautiful, appetising photograph of the finished dish "${title}". ${desc}`
    : `A beautiful, appetising photograph of the finished dish "${title}".`;
  const base = `${dish} ${RECIPE_IMAGE_STYLE}`;
  const trimmedHint = hint?.trim();
  return trimmedHint ? `${base} Additional guidance for this photo: ${trimmedHint}` : base;
}

function parseDataUrl(url: string): { contentType: string; base64: string } {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(url);
  if (!match) {
    throw new Error('generateRecipeImage: model media is not a base64 data URI');
  }
  return { contentType: match[1]!, base64: match[2]! };
}

export const GenerateRecipeImageInputSchema = z.object({
  title: z.string().min(1),
  // The recipe description steers the composition; nullable/optional because a
  // recipe may have none (RecipeSchema.description is nullable).
  description: z.string().nullable().optional(),
  // Optional additive steer (issue #148) appended to the locked prompt.
  hint: z.string().optional(),
});

// Raw generated image bytes, base64-encoded (Genkit flow outputs must be
// JSON-serialisable). The caller decodes to a Buffer before hero encoding.
export const GenerateRecipeImageOutputSchema = z.object({
  imageBase64: z.string(),
  contentType: z.string(),
});

export const generateRecipeImageFlow = ai.defineFlow(
  {
    name: 'generateRecipeImage',
    inputSchema: GenerateRecipeImageInputSchema,
    outputSchema: GenerateRecipeImageOutputSchema,
  },
  async ({ title, description, hint }) => {
    setActiveSpanName(`generateRecipeImage: ${title}`);

    const modelId = await resolveModel('image', 'generateRecipeImage');
    const imageModel = googleAI.model(modelId);
    const result = await withAiTimeout(
      'generateRecipeImage',
      () =>
        ai.generate({
          model: imageModel,
          prompt: buildRecipePrompt(title, description, hint),
        }),
      { timeoutMs: IMAGE_GEN_TIMEOUT_MS, retries: 1 },
    );

    const media = result.media;
    if (!media?.url) {
      throw new Error('generateRecipeImage: model returned no image');
    }

    const { base64, contentType } = parseDataUrl(media.url);
    return { imageBase64: base64, contentType };
  },
);
