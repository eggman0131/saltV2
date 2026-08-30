import { z } from 'zod';

// Input to the parseEntry flow. Lives here beside the output so a reader finds
// the whole wire contract in one place (issue #932, B3-010).
export const ParseEntryInputSchema = z.object({
  rawText: z.string(),
});

export type ParseEntryInput = z.infer<typeof ParseEntryInputSchema>;

// Shape returned by the Gemini model in the parseEntry flow.
export const ParseEntryAIOutputSchema = z.object({
  name: z.string(),
  context: z.string(),
  amount: z.number().optional(),
  unit: z.string().optional(),
});
