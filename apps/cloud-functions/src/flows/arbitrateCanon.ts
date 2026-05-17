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

// Flat schema returned by the model; the flow maps it to the domain result shape.
const AIOutputSchema = z.object({
  match_found: z.boolean(),
  match_id: z.string().nullable(),
  canonical_name: z.string().nullable(),
  aisle_name: z.string().nullable(),
  shoppingBehavior: z.enum(['stocked', 'check', 'needed']),
  largeQuantityThreshold: z.number().nullable(),
  unit: z.enum(['g', 'ml', 'count']).nullable(),
  reasoning: z.string(),
});

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
    const builtPrompt = buildPrompt(req);
    const result = await ai.generate({
      model: GENERATION_MODEL,
      prompt: builtPrompt,
      output: { schema: AIOutputSchema },
      config: { temperature: 0 },
    });
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

  return [
    `You are a UK grocery canon-matching assistant. Apply the four rules below and respond with a single JSON object matching the output schema exactly.`,
    ``,
    `Normalised input: "${req.normalisedName}"`,
    ``,
    `Candidate matches (id, name, similarity score 0–1):`,
    candidateList,
    ``,
    `Available aisles (use the exact name in your response):`,
    aisleList,
    ``,
    `## Rule 1 — Canonical matching`,
    `If any candidate is the same grocery item as the input (allowing for spelling variants, plurals, or minor descriptors), set match_found to true and match_id to that candidate's id. Choose the highest-scoring semantically equivalent candidate. If no candidate matches, set match_found to false and match_id to null.`,
    ``,
    `## Rule 2 — Canonical product name (UK conventions)`,
    `When match_found is false, set canonical_name to the product's identity only: the singular, title-case name a UK supermarket prints on the shelf label.`,
    `Keep a qualifier ONLY when it denotes a genuinely different product. "onion", "red onion", and "spring onion" are three distinct products; "Maris Piper potato" is distinct from a generic "potato". When unsure whether a qualifier changes the product, keep it.`,
    `Strip everything that does not change product identity: quantities and counts ("5 onions" → "Onion"), units and pack sizes ("2kg", "500ml"), size or grade words ("small", "large"), preparation or state ("chopped", "frozen"), brand names, and any parenthetical or trailing note ("(small)", "for the sauce").`,
    `Use standard UK supermarket naming: "courgette" not "zucchini", "aubergine" not "eggplant", "coriander" not "cilantro".`,
    `Examples: "5 onions (small)" → "Onion"; "2kg maris piper potatoes" → "Maris Piper Potato"; "red onion" → "Red Onion"; "spring onions, chopped" → "Spring Onion".`,
    `If match_found is true, set canonical_name to null — the existing item name stands.`,
    ``,
    `## Rule 3 — shoppingBehavior`,
    `Classify the item as one of:`,
    `  "stocked"  — kept in the store cupboard long-term (salt, olive oil, plain flour, dried pasta, spices)`,
    `  "check"    — perishable or semi-perishable; might already be in stock (eggs, butter, cheese, milk)`,
    `  "needed"   — typically bought fresh per shop (fresh vegetables, fresh meat, fresh fish, bread)`,
    ``,
    `## Rule 4 — largeQuantityThreshold`,
    `If the item is sold in a standard UK pack, set largeQuantityThreshold to the pack size number and unit to "g", "ml", or "count". For example: plain flour → 1000 g; semi-skimmed milk → 2272 ml (4 pints); eggs → 12 count. If there is no clear standard UK pack, set both to null.`,
    ``,
    `Respond with JSON:`,
    `{`,
    `  "match_found": <boolean>,`,
    `  "match_id": <string id or null>,`,
    `  "canonical_name": <canonical product name, identity only, or null when match_found is true>,`,
    `  "aisle_name": <exact name from the available aisles list, or null if none fits>,`,
    `  "shoppingBehavior": "stocked" | "check" | "needed",`,
    `  "largeQuantityThreshold": <number or null>,`,
    `  "unit": "g" | "ml" | "count" | null,`,
    `  "reasoning": <one sentence explaining your decision>`,
    `}`,
  ].join('\n');
}
