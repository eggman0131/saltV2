import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { ai } from '../genkit.js';

const GENERATION_MODEL = googleAI.model('gemini-3-flash-preview');

const PopulateEquipmentEntryRequestSchema = z.object({
  confirmedName: z.string(),
});

const AccessorySchema = z.object({
  name: z.string(),
  included: z.boolean(),
});

const PopulateEquipmentEntryResponseSchema = z.object({
  name: z.string(),
  accessories: z.array(AccessorySchema),
});

const AIOutputSchema = z.object({
  name: z.string(),
  accessories: z.array(AccessorySchema),
});

export const populateEquipmentEntryFlow = ai.defineFlow(
  {
    name: 'populateEquipmentEntry',
    inputSchema: PopulateEquipmentEntryRequestSchema,
    outputSchema: PopulateEquipmentEntryResponseSchema,
  },
  async ({ confirmedName }) => {
    const prompt = buildPrompt(confirmedName);
    const result = await ai.generate({
      model: GENERATION_MODEL,
      prompt,
      output: { schema: AIOutputSchema },
      config: { temperature: 0 },
    });
    const output = result.output!;
    return { name: output.name, accessories: output.accessories };
  },
);

function buildPrompt(confirmedName: string): string {
  return [
    `You are a UK kitchen equipment assistant. A user has confirmed they own the following piece of kitchen equipment:`,
    ``,
    `"${confirmedName}"`,
    ``,
    `Your task is to enumerate the first-party accessories that the manufacturer makes for this equipment.`,
    ``,
    `## Rules`,
    ``,
    `1. **First-party only.** List only accessories the original manufacturer makes. Do not list third-party or generic accessories.`,
    `2. **No capabilities or features.** Do not describe what the equipment can do — only list tangible, purchasable accessories and attachments.`,
    `3. **UK English.** Use UK spelling and terminology throughout.`,
    `4. **Short names.** Accessory names should be concise — 2–5 words, no model numbers.`,
    `5. **Canonical equipment name.** Return a clean, canonical UK English name for the equipment in the "name" field. You may correct minor variations from the user's input (e.g. normalise capitalisation), but do not substantially rename the device.`,
    `6. **included field.** Set included to true for accessories that come in the standard box. Set included to false for official manufacturer accessories sold separately.`,
    `7. **Empty list is valid.** If the equipment has no known first-party accessories, return an empty accessories array.`,
    ``,
    `Respond with JSON:`,
    `{`,
    `  "name": "<canonical UK equipment name>",`,
    `  "accessories": [`,
    `    { "name": "<accessory name>", "included": <true if in the standard box, false if sold separately> }`,
    `  ]`,
    `}`,
  ].join('\n');
}
