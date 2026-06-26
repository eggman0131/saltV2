import {
  PopulateEquipmentEntryAIOutputSchema,
  PopulateEquipmentEntryInputSchema,
} from '@salt/domain/schemas';
import { setActiveSpanName } from '@salt/observability/server';
import { ai } from '../genkit.js';
import { flowModel, aiModelLabel } from '../ai/fakeModel.js';
import { tracedGenerate } from '../ai/aiGenerationTelemetry.js';

export const populateEquipmentEntryFlow = ai.defineFlow(
  {
    name: 'populateEquipmentEntry',
    inputSchema: PopulateEquipmentEntryInputSchema,
    outputSchema: PopulateEquipmentEntryAIOutputSchema,
  },
  async ({ confirmedName }) => {
    setActiveSpanName(`populateEquipmentEntry: ${confirmedName}`);
    // Production: googleAI.model(resolveModel('lite', 'populateEquipmentEntry')).
    // Under FUNCTIONS_AI_FAKE=1 (emulator e2e only) flowModel returns the
    // deterministic fake model instead; byte-identical otherwise. See
    // ../ai/fakeModel.ts for the cross-process stub contract.
    const model = await flowModel('lite', 'populateEquipmentEntry');
    const result = await tracedGenerate(
      'populateEquipmentEntry',
      await aiModelLabel('lite', 'populateEquipmentEntry'),
      () =>
        ai.generate({
          model,
          system: SYSTEM_INSTRUCTIONS,
          prompt: `"${confirmedName}"`,
          output: { schema: PopulateEquipmentEntryAIOutputSchema },
          config: { temperature: 0 },
        }),
    );
    const output = result.output!;
    return { name: output.name, accessories: output.accessories };
  },
);

const SYSTEM_INSTRUCTIONS = [
  `You are a UK kitchen equipment assistant. The user provides the name of a piece of kitchen equipment they own. Your task is to enumerate the first-party accessories that the manufacturer makes for this equipment.`,
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
].join('\n');
