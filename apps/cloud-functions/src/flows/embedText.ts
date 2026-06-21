import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { EmbedTextInputSchema } from '@salt/domain/schemas';
import { setActiveSpanName } from '@salt/ld-observability/server';
import { ai } from '../genkit.js';
import { resolveModel } from '../ai/resolveModel.js';

export const embedTextFlow = ai.defineFlow(
  {
    name: 'embedText',
    inputSchema: EmbedTextInputSchema,
    outputSchema: z.object({ values: z.array(z.number()) }),
  },
  async ({ text }) => {
    setActiveSpanName(`embedText: ${text}`);
    // The admin-configured model is free text (Phase 1), so it is wider than
    // the SDK's literal-union embedder param — launder it across the boundary.
    const embedder = googleAI.embedder(
      (await resolveModel('embedding', 'embedText')) as Parameters<typeof googleAI.embedder>[0],
    );
    const embeddings = await ai.embed({ embedder, content: text });
    return { values: embeddings[0]!.embedding };
  },
);
