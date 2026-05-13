import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { ai } from '../genkit.js';

const GENERATION_MODEL = googleAI.model('gemini-3-flash-preview');

const IdentifyEquipmentRequestSchema = z.object({
  rawName: z.string(),
});

const CandidateSchema = z.object({
  name: z.string(),
  rationale: z.string(),
});

const IdentifyEquipmentResponseSchema = z.object({
  candidates: z.array(CandidateSchema),
});

const AIOutputSchema = z.object({
  candidates: z.array(CandidateSchema),
});

export const identifyEquipmentFlow = ai.defineFlow(
  {
    name: 'identifyEquipment',
    inputSchema: IdentifyEquipmentRequestSchema,
    outputSchema: IdentifyEquipmentResponseSchema,
  },
  async ({ rawName }) => {
    const prompt = buildPrompt(rawName);
    const result = await ai.generate({
      model: GENERATION_MODEL,
      prompt,
      output: { schema: AIOutputSchema },
      config: { temperature: 0 },
    });
    return { candidates: result.output!.candidates };
  },
);

function buildPrompt(rawName: string): string {
  return [
    `You are a UK kitchen equipment assistant. A user has typed the following equipment name:`,
    ``,
    `"${rawName}"`,
    ``,
    `Your task is to identify what kitchen equipment or appliance this refers to, using UK English naming conventions. Produce a list of 1–4 canonical candidate names that could represent what the user intended.`,
    ``,
    `## Rules`,
    ``,
    `1. **Collapse cosmetic variants.** If the input is a specific model number or variant (e.g. "KitchenAid Artisan 5KSM175"), collapse it to the canonical appliance name ("KitchenAid stand mixer"). The user's list tracks capability, not model numbers.`,
    `2. **UK English.** Use UK spelling and terminology throughout (e.g. "grill" not "broiler", "hob" not "stovetop", "food processor" not "blender/processor combo").`,
    `3. **First-party focus.** Accessories and attachments that ship with a main appliance should be listed as accessories of that appliance, not as separate equipment candidates.`,
    `4. **Distinct candidates.** Each candidate must represent a genuinely different piece of equipment. Do not list the same appliance under multiple names.`,
    `5. **Short names.** Names should be concise — 2–5 words, no model numbers, no brand names unless the brand is inseparable from the product (e.g. "Thermomix").`,
    `6. **Rationale.** For each candidate, provide a single sentence explaining why this name is a plausible interpretation.`,
    ``,
    `Respond with JSON:`,
    `{`,
    `  "candidates": [`,
    `    { "name": "<canonical UK equipment name>", "rationale": "<one sentence>" }`,
    `  ]`,
    `}`,
  ].join('\n');
}
