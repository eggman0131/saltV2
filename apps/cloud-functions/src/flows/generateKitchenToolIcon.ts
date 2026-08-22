import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { setActiveSpanName } from '@salt/observability/server';
import { ai } from '../genkit.js';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { loadCanonIconSeed } from './assets/canonIconSeed.js';
import { resolveModel } from '../ai/resolveModel.js';
import { parseDataUrl } from './dataUrl.js';
import { buildKitchenToolIconPrompt } from './kitchenToolIconPrompt.js';

// Kitchen-tool pictogram generation (issue #882) — the fourth subject family on
// the Tier-1 pipeline.
//
// Reference-conditioned off the same committed red-apple seed as the canon,
// weather and equipment families, by the same mechanism: the model copies ONLY
// the rendering style of the seed, never its subject. The prompt is built in
// kitchenToolIconPrompt.ts, which imports the locked canon `STYLE` verbatim and
// appends the kit prohibitions last.
//
// generateCanonIconFlow is deliberately NOT reused. It hardcodes the
// UK-supermarket steer ("The item is as commonly sold in a UK supermarket.") into
// every prompt, which points a hand tool at retail packaging, and it carries none
// of the no-lettering-on-the-object prohibition a branded pan handle needs.

// Image generation is far slower than text (~5–8s, occasionally more). The canon
// icon budget, matched deliberately rather than inherited: the same model doing
// the same job at the same size. The trigger's function timeout is raised to suit.
const ICON_GEN_TIMEOUT_MS = 60_000;

export const GenerateKitchenToolIconInputSchema = z.object({
  // The tool's curated label — "Mixing bowl", "Balloon whisk". It IS the subject:
  // this family draws the generic tool a recipe means, so there is no per-item
  // brief step in front of it the way equipment has one.
  label: z.string().min(1),
  // Optional additive steer, written onto the document by whoever judged the last
  // drawing wrong. Appended to the locked prompt, never replacing any of it.
  hint: z.string().optional(),
});

// Raw generated image bytes, base64-encoded (Genkit flow outputs must be
// JSON-serialisable). The caller decodes to a Buffer before background removal.
export const GenerateKitchenToolIconOutputSchema = z.object({
  imageBase64: z.string(),
  contentType: z.string(),
});

export const generateKitchenToolIconFlow = ai.defineFlow(
  {
    name: 'generateKitchenToolIcon',
    inputSchema: GenerateKitchenToolIconInputSchema,
    outputSchema: GenerateKitchenToolIconOutputSchema,
  },
  async ({ label, hint }) => {
    setActiveSpanName(`generateKitchenToolIcon: ${label}`);
    const seed = loadCanonIconSeed();

    const modelId = await resolveModel('image', 'generateKitchenToolIcon');
    const imageModel = googleAI.model(modelId);

    const result = await withAiTimeout(
      'generateKitchenToolIcon',
      () =>
        ai.generate({
          model: imageModel,
          prompt: [
            { media: { url: seed.url, contentType: seed.contentType } },
            { text: buildKitchenToolIconPrompt(label, hint) },
          ],
        }),
      { timeoutMs: ICON_GEN_TIMEOUT_MS, retries: 1 },
    );

    const media = result.media;
    if (!media?.url) {
      throw new Error('generateKitchenToolIcon: model returned no image');
    }

    const { base64, contentType } = parseDataUrl(media.url, 'generateKitchenToolIcon');
    return { imageBase64: base64, contentType };
  },
);
