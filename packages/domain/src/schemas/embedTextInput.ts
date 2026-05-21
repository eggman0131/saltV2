import { z } from 'zod';

export const EmbedTextInputSchema = z.object({
  text: z.string(),
});

export type EmbedTextInput = z.infer<typeof EmbedTextInputSchema>;
