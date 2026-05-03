import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { ai } from '../genkit.js';

const GENERATION_MODEL = googleAI.model('gemini-3-flash-preview');

const ArbitrationRequestSchema = z.object({
  normalisedName: z.string(),
  candidates: z.array(
    z.object({
      item: z.object({ id: z.string(), name: z.string() }),
      confidence: z.number(),
    }),
  ),
  aisles: z.array(z.object({ id: z.string(), name: z.string() })),
});

// AI output schema — what the model itself returns.
const AIOutputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('match'), itemId: z.string(), confidence: z.number() }),
  z.object({ kind: z.literal('new'), canonName: z.string(), aisleId: z.string().nullable() }),
  z.object({ kind: z.literal('no-match') }),
]);

// Flow output schema — includes the prompt and raw model response for observability.
const ArbitrationResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('match'),
    itemId: z.string(),
    confidence: z.number(),
    prompt: z.string(),
    rawResponse: z.string(),
  }),
  z.object({
    kind: z.literal('new'),
    canonName: z.string(),
    aisleId: z.string().nullable(),
    prompt: z.string(),
    rawResponse: z.string(),
  }),
  z.object({ kind: z.literal('no-match'), prompt: z.string(), rawResponse: z.string() }),
]);

export const arbitrateCanonFlow = ai.defineFlow(
  {
    name: 'arbitrateCanon',
    inputSchema: ArbitrationRequestSchema,
    outputSchema: ArbitrationResultSchema,
  },
  async (req) => {
    const builtPrompt = buildPrompt(req);
    const result = await ai.generate({
      model: GENERATION_MODEL,
      prompt: builtPrompt,
      output: { schema: AIOutputSchema },
      config: { temperature: 0 },
    });
    const output = result.output!;
    const rawResponse = result.text ?? JSON.stringify(output);
    return { ...output, prompt: builtPrompt, rawResponse };
  },
);

function buildPrompt(req: z.infer<typeof ArbitrationRequestSchema>): string {
  const candidateList = req.candidates.length
    ? req.candidates
        .map(
          (c) => `- id: "${c.item.id}", name: "${c.item.name}", score: ${c.confidence.toFixed(3)}`,
        )
        .join('\n')
    : '(none)';

  const aisleList = req.aisles.length
    ? req.aisles.map((a) => `- id: "${a.id}", name: "${a.name}"`).join('\n')
    : '(none)';

  return [
    `You are a grocery canon item matching assistant.`,
    ``,
    `Normalized ingredient name: "${req.normalisedName}"`,
    ``,
    `Candidate matches (id, name, similarity score 0–1):`,
    candidateList,
    ``,
    `Available aisles:`,
    aisleList,
    ``,
    `Respond with JSON in exactly one of these shapes:`,
    `  {"kind":"match","itemId":"<id>","confidence":<0-1>}`,
    `  {"kind":"new","canonName":"<canonical name>","aisleId":"<aisle id or null>"}`,
    `  {"kind":"no-match"}`,
  ].join('\n');
}
