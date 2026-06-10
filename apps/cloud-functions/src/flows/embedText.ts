import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { EmbedTextInputSchema } from '@salt/domain/schemas';
import { setActiveSpanName } from '@salt/ld-observability/server';
import { ai } from '../genkit.js';

const EMBEDDING_MODEL = 'gemini-embedding-001';

export const embedTextFlow = ai.defineFlow(
  {
    name: 'embedText',
    inputSchema: EmbedTextInputSchema,
    outputSchema: z.object({ values: z.array(z.number()) }),
  },
  async ({ text }) => {
    setActiveSpanName(`embedText: ${text}`);
    const embeddings = await ai.embed({
      embedder: googleAI.embedder(EMBEDDING_MODEL),
      content: text,
    });
    return { values: embeddings[0]!.embedding };
  },
);
