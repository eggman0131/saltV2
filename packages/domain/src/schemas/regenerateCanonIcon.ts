import { z } from 'zod';

// Input for the regenerateCanonIcon callable (issue #148): clears the canon
// item's icon so the onCanonItemWritten trigger regenerates it. An optional
// `hint` is a one-shot, additive steer for the next generation (e.g. "show it
// as a tin", "make it greener").
export const RegenerateCanonIconInputSchema = z.object({
  canonId: z.string().min(1),
  hint: z.string().trim().max(200).optional(),
});

export type RegenerateCanonIconInput = z.infer<typeof RegenerateCanonIconInputSchema>;
