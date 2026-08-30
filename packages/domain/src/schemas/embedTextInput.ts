import { z } from 'zod';

export const EmbedTextInputSchema = z.object({
  text: z.string(),
});

// What the embedText flow returns: the single embedding vector for `text`.
export const EmbedTextOutputSchema = z.object({
  values: z.array(z.number()),
});
