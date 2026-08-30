import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { EmbedTextInputSchema, EmbedTextOutputSchema } from '@salt/domain/schemas';
import { setActiveSpanName } from '@salt/observability/server';
import { ai } from '../genkit.js';
import { resolveModel } from '../ai/resolveModel.js';
import { aiFakeEnabled } from '../ai/fakeModel.js';
import { fakeEmbedding } from '../ai/fakeEmbedding.js';
import { withAiTimeout } from '../adapters/withAiTimeout.js';

export const embedTextFlow = ai.defineFlow(
  {
    name: 'embedText',
    inputSchema: EmbedTextInputSchema,
    outputSchema: EmbedTextOutputSchema,
  },
  async ({ text }) => {
    setActiveSpanName(`embedText: ${text}`);
    // E2E fake seam: a real ai.embed() would run under FUNCTIONS_AI_FAKE against
    // the dummy emulator key. See ai/fakeEmbedding.ts for why the stand-in is
    // derived from the text. Unreachable in production, and it returns before
    // the timer below so the fake path is unchanged by it.
    if (aiFakeEnabled()) {
      return { values: fakeEmbedding(text) };
    }
    // The admin-configured model is free text (Phase 1), so it is wider than
    // the SDK's literal-union embedder param — launder it across the boundary.
    const embedder = googleAI.embedder(
      (await resolveModel('embedding', 'embedText')) as Parameters<typeof googleAI.embedder>[0],
    );
    // The deadline lives here rather than at the two adapters/triggers that used
    // to apply it (issue #915): `embedTextFlow` is also exported as its own
    // callable (index.ts), which a caller-side wrapper left unguarded. House
    // defaults (20s + 1 retry) — the values every caller was already passing.
    const embeddings = await withAiTimeout('embedText', () =>
      ai.embed({ embedder, content: text }),
    );
    return { values: embeddings[0]!.embedding };
  },
);
