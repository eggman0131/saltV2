import { z } from 'zod';

export const EquipmentCandidateSchema = z.object({
  name: z.string(),
  rationale: z.string(),
});

// Shape returned by the Gemini model in the identifyEquipment flow.
export const IdentifyEquipmentAIOutputSchema = z.object({
  candidates: z.array(EquipmentCandidateSchema),
});

export type EquipmentCandidate = z.infer<typeof EquipmentCandidateSchema>;
export type IdentifyEquipmentAIOutput = z.infer<typeof IdentifyEquipmentAIOutputSchema>;
