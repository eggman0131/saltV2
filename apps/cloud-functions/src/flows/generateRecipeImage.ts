import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { setActiveSpanName } from '@salt/observability/server';
import { ai } from '../genkit.js';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { resolveModel } from '../ai/resolveModel.js';
import { parseDataUrl } from './dataUrl.js';

// Tier-2 recipe hero-image generation (issue #148). The counterpart to the
// Tier-1 canon pictogram (generateCanonIcon.ts): where that paints a flat cartoon
// icon, this paints a PHOTOREALISTIC "arty" photograph of the finished dish from
// the recipe's title + description, in a consistent warm cookbook style.
//
// Two-tier system (docs/canon-icons.md): Tier 1 and Tier 2 never share size or
// context, so the styles deliberately do NOT match — this is prompt-only, no
// reference seed. Photoreal food photography is far more forgiving of prompt
// drift than the tiny pictograms were, so a set of house-style ANCHORS holds the
// look together across recipes while the prompt lets each dish drive its own
// scene (season, setting, surface, props, angle, palette, light). A committed
// style seed can be added later (mirroring loadCanonIconSeed) if cross-recipe
// consistency ever needs tightening.

// Image generation is far slower than text (~5–8s, occasionally more). Give it a
// generous deadline; the trigger's function timeout is raised to match.
const IMAGE_GEN_TIMEOUT_MS = 60_000;

// House-style string (STYLE) — the warm, "arty" modern-British-cookbook look.
// This literal is load-bearing: it fixes the house-style ANCHORS (photoreal,
// appetising, single finished-dish hero shot with the FOOD filling the frame as
// the star, soft natural window light, shallow focus, rustic ceramic / worn
// crockery, warm home-cookbook feel) that must hold
// across every recipe, while deliberately handing the DISH the wheel for
// everything else — season, setting, surface, props, angle, palette and light are
// all dish-driven and are MEANT to vary photo to photo (that variation is the
// point, not drift). Do NOT paraphrase casually — reword it deliberately and
// review the output, exactly as with the canon-icon STYLE. The dish identity
// still comes from the recipe's title + description; this string tells the model
// how to READ that dish and stage a whole scene around it.
export const RECIPE_IMAGE_STYLE =
  'First read the dish itself — is it fresh and light or hearty and slow-cooked, what cuisine is it, and which season does it naturally belong to — then let that reading drive the season, setting, surface, props, colour palette and quality of light of the scene: a fresh salad calls for high summer — bright, sunny, airy, cool clear light, a breezy outdoor or sun-lit table; a cottage pie or a slow-cooked stew calls for autumn or winter — cosy and warm, low golden or soft overcast light, deeper earthy tones, a hearty indoor table. Make this seasonal and situational shift clearly legible at a glance — a deliberate, confident step, never a faint tint — so each dish feels like it lives in its own moment. But the FOOD is always the star of the shot: fill the frame with the dish, composing tight and close so the food is unmistakably the subject and takes up most of the image. The setting, surface, props and background are only supporting context glimpsed around and behind the food — never the main event; avoid wide or pulled-back shots where the tabletop, props or surroundings occupy more of the frame than the food itself. Vary the props, surface and angle to suit each dish; do NOT default to the same spoon, cloth, tabletop or camera position on every photo. Within that freedom, hold a recognisable house style: a photorealistic food photograph with the warm, unfussy, appetising feel of a modern British home-cookbook, shot with real affection. Always keep these anchors — the dish generously plated and filling most of the frame as the clear subject; soft natural window light; a shallow depth of field with the food in crisp focus and the surroundings falling softly out of focus; the food lovingly plated on rustic ceramic or worn crockery. Absolutely no text, no captions, no watermark, no logos, no hands, no people. A single, mouth-watering hero shot of one finished dish, framed large and close so the food fills the frame and makes you want to eat it.';

// Per-recipe generation prompt. The dish identity comes from the recipe title and
// (when present) its description; the recipe's own `tags` are fed in as a dish-type
// SIGNAL the model may use to judge mood/season/cuisine (issue #148, Phase 2); and
// an optional user `hint` is appended verbatim as additive guidance. Neither the
// tags nor the hint alter the locked house-style wording, and the hint is always
// appended last.
function buildRecipePrompt(
  title: string,
  description?: string | null,
  hint?: string,
  tags?: string[],
): string {
  const desc = description?.trim();
  const dish = desc
    ? `A beautiful, appetising photograph of the finished dish "${title}". ${desc}`
    : `A beautiful, appetising photograph of the finished dish "${title}".`;
  let prompt = `${dish} ${RECIPE_IMAGE_STYLE}`;

  // Recipe tags (e.g. #comfort-food, #slow-cooker, #salad, #summer) give the model
  // an explicit dish-type cue beyond the title/description: a plainly-named dish
  // tagged #comfort-food reads warmer/autumnal, one tagged #salad/#summer brighter.
  // They are cues for READING the dish's character only — never text to render, so
  // the clause explicitly forbids drawing or writing them (the style already bans
  // captions/text). Drop empty/whitespace tags; with none usable, add no clause.
  const cleanTags = tags?.map((t) => t.trim()).filter((t) => t.length > 0);
  if (cleanTags && cleanTags.length > 0) {
    prompt += ` This recipe is tagged: ${cleanTags.join(', ')}. Use these tags only as hints for reading the dish's mood, season and cuisine when you stage the scene — do NOT draw, write, label or otherwise show any of these words in the image.`;
  }

  const trimmedHint = hint?.trim();
  return trimmedHint ? `${prompt} Additional guidance for this photo: ${trimmedHint}` : prompt;
}

export const GenerateRecipeImageInputSchema = z.object({
  title: z.string().min(1),
  // The recipe description steers the composition; nullable/optional because a
  // recipe may have none (RecipeSchema.description is nullable).
  description: z.string().nullable().optional(),
  // Optional additive steer (issue #148) appended to the locked prompt.
  hint: z.string().optional(),
  // Optional dish-type signal (issue #148, Phase 2): the recipe's own tags, passed
  // to the model as cues for judging mood/season/cuisine — never rendered as text.
  tags: z.array(z.string()).optional(),
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
  async ({ title, description, hint, tags }) => {
    setActiveSpanName(`generateRecipeImage: ${title}`);

    const modelId = await resolveModel('image', 'generateRecipeImage');
    const imageModel = googleAI.model(modelId);
    const result = await withAiTimeout(
      'generateRecipeImage',
      () =>
        ai.generate({
          model: imageModel,
          prompt: buildRecipePrompt(title, description, hint, tags),
        }),
      { timeoutMs: IMAGE_GEN_TIMEOUT_MS, retries: 1 },
    );

    const media = result.media;
    if (!media?.url) {
      throw new Error('generateRecipeImage: model returned no image');
    }

    const { base64, contentType } = parseDataUrl(media.url, 'generateRecipeImage');
    return { imageBase64: base64, contentType };
  },
);
