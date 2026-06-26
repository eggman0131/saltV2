import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { EmbedTextInputSchema } from '@salt/domain/schemas';
import { setActiveSpanName } from '@salt/observability/server';
import { ai } from '../genkit.js';
import { resolveModel } from '../ai/resolveModel.js';
import { aiFakeEnabled } from '../ai/fakeModel.js';

// Deterministic stand-in returned under the e2e fake flag. Any length is
// schema-valid (CanonItemSchema.embedding is z.array(number).nullable) and the
// e2e suite never compares embeddings (it matches at stage-1 exact), so the
// values only need to be present and stable.
const FAKE_EMBEDDING = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];

export const embedTextFlow = ai.defineFlow(
  {
    name: 'embedText',
    inputSchema: EmbedTextInputSchema,
    outputSchema: z.object({ values: z.array(z.number()) }),
  },
  async ({ text }) => {
    setActiveSpanName(`embedText: ${text}`);
    // E2E fake seam: the Genkit embedder has no flowModel-style fake (that seam
    // swaps chat models only), so a real ai.embed() would run under
    // FUNCTIONS_AI_FAKE, ECONNRESET against the fake key, and — called without
    // withAiTimeout from onCanonItemWritten — hang the trigger. Return a canned
    // vector so the embedding write-back path stays exercised, deterministically
    // and offline. Unreachable in production (the flag is never set there).
    if (aiFakeEnabled()) {
      return { values: [...FAKE_EMBEDDING] };
    }
    // The admin-configured model is free text (Phase 1), so it is wider than
    // the SDK's literal-union embedder param — launder it across the boundary.
    const embedder = googleAI.embedder(
      (await resolveModel('embedding', 'embedText')) as Parameters<typeof googleAI.embedder>[0],
    );
    const embeddings = await ai.embed({ embedder, content: text });
    return { values: embeddings[0]!.embedding };
  },
);
