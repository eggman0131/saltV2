import { z } from 'zod';

export const EmbedTextInputSchema = z.object({
  text: z.string(),
});
