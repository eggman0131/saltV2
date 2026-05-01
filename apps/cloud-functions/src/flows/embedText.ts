import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { ai } from '../genkit.js';

const EMBEDDING_MODEL = 'gemini-embedding-001';

export const embedTextFlow = ai.defineFlow(
  {
    name: 'embedText',
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ values: z.array(z.number()) }),
  },
  async ({ text }) => {
    const embeddings = await ai.embed({
      embedder: googleAI.embedder(EMBEDDING_MODEL),
      content: text,
    });
    return { values: embeddings[0]!.embedding };
  },
);
