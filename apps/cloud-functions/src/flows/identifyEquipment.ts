import { googleAI } from '@genkit-ai/google-genai';
import {
  IdentifyEquipmentAIOutputSchema,
  IdentifyEquipmentInputSchema,
} from '@salt/domain/schemas';
import { setActiveSpanName } from '@salt/ld-observability/server';
import { ai } from '../genkit.js';
import { resolveModel } from '../ai/resolveModel.js';

export const identifyEquipmentFlow = ai.defineFlow(
  {
    name: 'identifyEquipment',
    inputSchema: IdentifyEquipmentInputSchema,
    outputSchema: IdentifyEquipmentAIOutputSchema,
  },
  async ({ rawName }) => {
    setActiveSpanName(`identifyEquipment: ${rawName}`);
    const result = await ai.generate({
      model: googleAI.model(await resolveModel('fast', 'identifyEquipment')),
      system: SYSTEM_INSTRUCTIONS,
      prompt: `"${rawName}"`,
      output: { schema: IdentifyEquipmentAIOutputSchema },
      config: { temperature: 0 },
    });
    return { candidates: result.output!.candidates };
  },
);

const SYSTEM_INSTRUCTIONS = [
  `You are a UK kitchen equipment assistant. The user provides a raw equipment name and you identify what kitchen equipment or appliance it refers to, using UK English naming conventions. Produce a list of 1–4 canonical candidate names that could represent what the user intended.`,
  ``,
  `## Rules`,
  ``,
  `1. **Identify make and model.** Downstream systems use the candidate name to determine which accessories ship with the appliance and what cooking capabilities it has, so each candidate should name the specific make and model where identifiable (e.g. "KitchenAid Artisan 5KSM175", "Thermomix TM6", "Ninja Foodi OP500"). If the input already specifies a make/model or variant, preserve it. If the input is generic (e.g. "stand mixer"), list the most likely specific make/model candidates the user might mean rather than a generic appliance name.`,
  `2. **UK English.** Use UK spelling and terminology throughout (e.g. "grill" not "broiler", "hob" not "stovetop", "food processor" not "blender/processor combo").`,
  `3. **First-party focus.** Accessories and attachments that ship with a main appliance should be listed as accessories of that appliance, not as separate equipment candidates.`,
  `4. **Distinct candidates.** Each candidate must represent a genuinely different piece of equipment (different make or different model line). Do not list the same appliance under multiple names.`,
  `5. **Fall back gracefully.** If a make/model genuinely cannot be inferred (e.g. truly generic, unbranded items like "wooden spoon" or "saucepan"), use the canonical UK appliance name on its own. Do not invent a brand or model.`,
  `6. **Rationale.** For each candidate, provide a single sentence explaining why this make/model is a plausible interpretation of the user's input.`,
].join('\n');
