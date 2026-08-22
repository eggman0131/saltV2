import { z } from 'zod';

// Input for the regenerateProductFormIcon callable (issue #871): clears the
// product form's icon so the onProductFormWritten trigger regenerates it. An
// optional `hint` is a one-shot, additive steer for the next generation (e.g.
// "show it as a bottle", "show it being squeezed").
//
// A SEPARATE schema from RegenerateCanonIconInputSchema rather than one widened
// with a `collection` discriminator: the two callables address two collections
// with two different id names, and a wire schema that could be pointed at either
// collection is a wire schema a caller can point at the wrong one. The shared
// part — the nonce/hint write semantics — is shared in the implementation
// (`requestIconRegeneration`), which is where sharing actually pays.
export const RegenerateProductFormIconInputSchema = z.object({
  formId: z.string().min(1),
  hint: z.string().trim().max(200).optional(),
});

export type RegenerateProductFormIconInput = z.infer<typeof RegenerateProductFormIconInputSchema>;
