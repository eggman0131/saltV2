import { z } from 'genkit';
import { HttpsError, type CallableRequest } from 'firebase-functions/https';
import { logger } from 'firebase-functions';
import { googleAI } from '@genkit-ai/google-genai';
import { AI_MODEL_ROLES, type AiModelRole } from '@salt/domain/schemas';
import { ai } from '../genkit.js';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { requireAdmin } from './requireAdmin.js';

// Admin-only callable that probes a single model with the cheapest possible
// request and reports whether it works (Phase 3). The operator clicks "Test"
// next to a chosen/typed model; this fires one tiny `generateContent` (or
// `embedContent` for the embedding role) ping against Gemini, wrapped in
// withAiTimeout so a hung model surfaces as a clean failure rather than holding
// the function open. The API key stays server-side; the browser only gets
// `{ ok }` / `{ ok, error }`.
//
// onCall (NOT onCallGenkit): not a Genkit flow. App Check enforcement + the AI
// secret are wired at the export site in index.ts.

const TestModelInputSchema = z.object({
  model: z.string().min(1),
  // The role the model is being tested for — decides the probe method
  // (embedding → embedContent, everything else → generateContent). Optional;
  // defaults to a generate ping, which works for fast/pro/image-capable models.
  role: z.enum(AI_MODEL_ROLES).optional(),
});

export interface TestModelResult {
  readonly ok: boolean;
  readonly error?: string;
}

async function probe(model: string, role: AiModelRole | undefined): Promise<void> {
  if (role === 'embedding') {
    const embedder = googleAI.embedder(model as Parameters<typeof googleAI.embedder>[0]);
    await ai.embed({ embedder, content: 'ping' });
    return;
  }
  // Cheap generate ping for fast/pro/image (and the unspecified case). A 1-token
  // budget keeps it as cheap as the provider allows.
  await ai.generate({
    model: googleAI.model(model),
    prompt: 'ping',
    config: { maxOutputTokens: 1, temperature: 0 },
  });
}

export async function handleTestModel(request: CallableRequest): Promise<TestModelResult> {
  await requireAdmin(request);
  const input = TestModelInputSchema.safeParse(request.data);
  if (!input.success) {
    throw new HttpsError('invalid-argument', 'Invalid request payload.');
  }
  const { model, role } = input.data;

  try {
    await withAiTimeout('testModel', () => probe(model, role));
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.info('testModel: probe failed', { model, role, message });
    // A failed probe is an expected outcome, not a function error — return it so
    // the UI can show "this model doesn't work" without a thrown HttpsError.
    return { ok: false, error: message };
  }
}
