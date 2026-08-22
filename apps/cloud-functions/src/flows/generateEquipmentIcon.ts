import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { setActiveSpanName } from '@salt/observability/server';
import { ai } from '../genkit.js';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { loadCanonIconSeed } from './assets/canonIconSeed.js';
import { resolveModel } from '../ai/resolveModel.js';
import { parseDataUrl } from './dataUrl.js';
import { buildEquipmentIconPrompt } from './equipmentIconPrompt.js';

// Equipment-pictogram generation (issue #877) — the expensive IMAGE step, second
// half of the pair whose first half is describeEquipmentSubject.
//
// Reference-conditioned off the same committed red-apple seed as the canon and
// weather families, by the same mechanism: the model copies ONLY the rendering
// style of the seed, never its subject. The prompt is built in
// equipmentIconPrompt.ts, which imports the locked canon `STYLE` verbatim and
// appends the equipment prohibitions last.
//
// generateCanonIconFlow is deliberately NOT reused. It hardcodes the UK-supermarket
// steer ("The item is as commonly sold in a UK supermarket.") into every prompt,
// which is the wrong direction for an appliance, and its name-only prompt cannot
// render a specific model anyway — which is the entire premise of this feature.

// Image generation is far slower than text (~5–8s, occasionally more). The canon
// icon budget, matched deliberately rather than inherited: this is the same model
// doing the same job at the same size. The caller is the Draw callable, whose
// function timeout is raised to suit — it is the ONLY wrapper around this call,
// so there is no outer race that can pre-empt this budget (the canon path's
// nested-budget disagreement is not copied here).
const ICON_GEN_TIMEOUT_MS = 60_000;

export const GenerateEquipmentIconInputSchema = z.object({
  // The item's name. Used for the span label and as the degraded fallback
  // subject; when `brief` is present the name does NOT reach the image model —
  // see buildEquipmentIconPrompt for why.
  name: z.string().min(1),
  // The per-item visual brief from describeEquipmentSubject, possibly corrected
  // by the user. Optional so a failed describe step degrades to a genre-level
  // drawing rather than no drawing at all.
  brief: z.string().optional(),
});

// Raw generated image bytes, base64-encoded (Genkit flow outputs must be
// JSON-serialisable). The caller decodes to a Buffer before background removal.
export const GenerateEquipmentIconOutputSchema = z.object({
  imageBase64: z.string(),
  contentType: z.string(),
});

export const generateEquipmentIconFlow = ai.defineFlow(
  {
    name: 'generateEquipmentIcon',
    inputSchema: GenerateEquipmentIconInputSchema,
    outputSchema: GenerateEquipmentIconOutputSchema,
  },
  async ({ name, brief }) => {
    setActiveSpanName(`generateEquipmentIcon: ${name}`);
    const seed = loadCanonIconSeed();

    // No per-flow override id, for the same reason as describeEquipmentSubject:
    // registering one means editing AI_FLOW_ROLES, which Phase 1 must not touch.
    const modelId = await resolveModel('image');
    const imageModel = googleAI.model(modelId);

    const result = await withAiTimeout(
      'generateEquipmentIcon',
      () =>
        ai.generate({
          model: imageModel,
          prompt: [
            { media: { url: seed.url, contentType: seed.contentType } },
            { text: buildEquipmentIconPrompt(name, brief) },
          ],
        }),
      { timeoutMs: ICON_GEN_TIMEOUT_MS, retries: 1 },
    );

    const media = result.media;
    if (!media?.url) {
      throw new Error('generateEquipmentIcon: model returned no image');
    }

    const { base64, contentType } = parseDataUrl(media.url, 'generateEquipmentIcon');
    return { imageBase64: base64, contentType };
  },
);
