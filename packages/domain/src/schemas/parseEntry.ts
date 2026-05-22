import { z } from 'zod';

// Shape returned by the Gemini model in the parseEntry flow.
export const ParseEntryAIOutputSchema = z.object({
  name: z.string(),
  context: z.string(),
  amount: z.number().optional(),
  unit: z.string().optional(),
});

export type ParseEntryAIOutput = z.infer<typeof ParseEntryAIOutputSchema>;
