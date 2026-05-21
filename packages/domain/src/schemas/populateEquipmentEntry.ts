import { z } from 'zod';

export const EquipmentAccessorySchema = z.object({
  name: z.string(),
  included: z.boolean(),
});

// Shape returned by the Gemini model in the populateEquipmentEntry flow.
export const PopulateEquipmentEntryAIOutputSchema = z.object({
  name: z.string(),
  accessories: z.array(EquipmentAccessorySchema),
});

export type EquipmentAccessory = z.infer<typeof EquipmentAccessorySchema>;
export type PopulateEquipmentEntryAIOutput = z.infer<typeof PopulateEquipmentEntryAIOutputSchema>;

export const PopulateEquipmentEntryInputSchema = z.object({
  confirmedName: z.string(),
});

export type PopulateEquipmentEntryInput = z.infer<typeof PopulateEquipmentEntryInputSchema>;
