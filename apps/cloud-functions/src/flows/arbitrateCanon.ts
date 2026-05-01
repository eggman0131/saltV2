import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { ai } from '../genkit.js';

const GENERATION_MODEL = googleAI.model('gemini-2.0-flash');

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

const ArbitrationResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('match'), itemId: z.string(), confidence: z.number() }),
  z.object({ kind: z.literal('new'), canonName: z.string(), aisleId: z.string().nullable() }),
  z.object({ kind: z.literal('no-match') }),
]);

export const arbitrateCanonFlow = ai.defineFlow(
  {
    name: 'arbitrateCanon',
    inputSchema: ArbitrationRequestSchema,
    outputSchema: ArbitrationResultSchema,
  },
  async (req) => {
    const result = await ai.generate({
      model: GENERATION_MODEL,
      prompt: buildPrompt(req),
      output: { schema: ArbitrationResultSchema },
      config: { temperature: 0 },
    });
    return result.output!;
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
