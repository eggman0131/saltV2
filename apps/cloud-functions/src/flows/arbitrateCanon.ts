import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { ArbitrationRequestSchema, CanonArbitrationAIOutputSchema } from '@salt/domain/schemas';
import { setActiveSpanName } from '@salt/observability/server';
import { ai } from '../genkit.js';
import { resolveModel } from '../ai/resolveModel.js';
import { tracedGenerate } from '../ai/aiGenerationTelemetry.js';

// Flow output — discriminated union matching ArbitrationResult; includes prompt and rawResponse.
const ArbitrationResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('match'),
    itemId: z.string(),
    confidence: z.number(),
    shoppingBehavior: z.enum(['stocked', 'check', 'needed']),
    largeQuantityThreshold: z.number().optional(),
    unit: z.enum(['g', 'ml', 'count']).optional(),
    reasoning: z.string().optional(),
    prompt: z.string(),
    rawResponse: z.string(),
  }),
  z.object({
    kind: z.literal('new'),
    canonName: z.string(),
    aisleId: z.string().nullable(),
    shoppingBehavior: z.enum(['stocked', 'check', 'needed']),
    largeQuantityThreshold: z.number().optional(),
    unit: z.enum(['g', 'ml', 'count']).optional(),
    reasoning: z.string().optional(),
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
    setActiveSpanName(`arbitrateCanon: ${req.normalisedName}`);
    const builtPrompt = buildPrompt(req);
    const model = await resolveModel('lite', 'arbitrateCanon');
    const result = await tracedGenerate('arbitrateCanon', model, () =>
      ai.generate({
        model: googleAI.model(model),
        prompt: builtPrompt,
        output: { schema: CanonArbitrationAIOutputSchema },
        config: { temperature: 0 },
      }),
    );
    const output = result.output!;
    const rawResponse = result.text ?? JSON.stringify(output);

    // Map aisle name → id (first match wins; null if name not found in list).
    const aisleId =
      output.aisle_name != null
        ? (req.aisles.find((a) => a.name === output.aisle_name)?.id ?? null)
        : null;

    const optionalFields = {
      ...(output.largeQuantityThreshold != null
        ? { largeQuantityThreshold: output.largeQuantityThreshold }
        : {}),
      ...(output.unit != null ? { unit: output.unit } : {}),
      reasoning: output.reasoning,
    };

    if (output.match_found && output.match_id != null) {
      const confidence =
        req.candidates.find((c) => c.item.id === output.match_id)?.confidence ?? 1.0;
      return {
        kind: 'match' as const,
        itemId: output.match_id,
        confidence,
        shoppingBehavior: output.shoppingBehavior,
        ...optionalFields,
        prompt: builtPrompt,
        rawResponse,
      };
    }

    if (output.canonical_name != null) {
      return {
        kind: 'new' as const,
        canonName: output.canonical_name,
        aisleId,
        shoppingBehavior: output.shoppingBehavior,
        ...optionalFields,
        prompt: builtPrompt,
        rawResponse,
      };
    }

    return { kind: 'no-match' as const, prompt: builtPrompt, rawResponse };
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
    ? req.aisles.map((a) => `- "${a.name}"`).join('\n')
    : '(none)';

  const rawInputLine =
    req.rawText !== undefined && req.rawText !== req.normalisedName
      ? `Raw input (context only — use container/descriptor words like "tin of", "smoked", "fresh" to resolve ambiguity, but match on the normalised name above): "${req.rawText}"`
      : null;

  return [
    `You are a UK supermarket canon-matching assistant. Apply the four rules below and respond with a single JSON object matching the output schema exactly.`,
    ``,
    `Normalised input: "${req.normalisedName}"`,
    ...(rawInputLine ? [rawInputLine] : []),
    ``,
    `Candidate matches (id, name, similarity score 0–1):`,
    candidateList,
    ``,
    `Available aisles (use the exact name in your response):`,
    aisleList,
    ``,
    `## Rule 1 — Canonical Matching`,
    `If any candidate is semantically the same grocery item as the input, set \`match_found\` to true and \`match_id\` to that candidate's id.`,
    `- Allow for plurals, minor spelling variants, or superficial size/pack modifiers (e.g., "big onion" is a semantic match for "onions"; "large loose box tomatoes" is a match for "tomatoes").`,
    `- If multiple candidates match, choose the one with the highest similarity score.`,
    `- If no candidate is a semantic match, set \`match_found\` to false and \`match_id\` to null.`,
    ``,
    `## Rule 2 — Canonical Product Name (UK Conventions)`,
    `If \`match_found\` is false, determine the \`canonical_name\`. This must be the singular, Title-Case name a UK supermarket (like Tesco or Sainsbury's) prints on a shelf edge label.`,
    `- Strip away size, weight, pack, or quality modifiers (e.g., "big onion" becomes "Onion").`,
    `- Retain a modifier ONLY when it denotes a fundamentally distinct product type or botanical variety sold separately in the UK (e.g., "Red Onion", "Spring Onion", and "Onion" are distinct; "Maris Piper Potato" is distinct from a generic "Potato").`,
    `- If \`match_found\` is true, set \`canonical_name\` to null.`,
    ``,
    `## Rule 3 — shoppingBehavior`,
    `Classify the item as one of:`,
    `  "stocked"  — kept in the store cupboard long-term (salt, olive oil, plain flour, dried pasta, spices)`,
    `  "check"    — perishable or semi-perishable; might already be in stock (eggs, butter, cheese, milk)`,
    `  "needed"   — typically bought fresh per shop (fresh vegetables, fresh meat, fresh fish, bread)`,
    ``,
    `## Rule 4 — largeQuantityThreshold`,
    `If the item is sold in a standard UK pack, set largeQuantityThreshold to 60% of the pack size and unit to "g", "ml", or "count". For example: plain flour → 600 g; eggs → 8 count. If there is no clear standard UK pack, set both to null.`,
    ``,
  ].join('\n');
}
