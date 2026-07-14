import { z } from 'zod';

// Product-form arbitration (issue #500, Phase 3). When a recipe ingredient does
// NOT resolve to an existing product form and does NOT match a buyable canon item
// as itself, the canonicalise flow asks the model whether the ingredient is a
// non-buyable FORM of one of the existing buyable canon items (e.g. "grated
// nutmeg" → the buyable "Nutmeg", yielding ~12 g per whole nutmeg). A hit is
// written as a pending ProductForm for later human review. Mirrors the shape of
// canonArbitration.ts (request → AI output → mapped result).

export const ProductFormArbitrationRequestSchema = z.object({
  // The ingredient name that failed to resolve (already normalised upstream).
  ingredientName: z.string(),
  // Optional raw ingredient text for container/descriptor context ("2 tbsp …").
  rawText: z.string().optional(),
  // Existing buyable canon items the model may choose a parent from.
  candidates: z.array(z.object({ id: z.string(), name: z.string() })),
});

export type ProductFormArbitrationRequest = z.infer<typeof ProductFormArbitrationRequestSchema>;

// Flat shape the model returns. Schema is the source of truth; TS type derived.
export const ProductFormArbitrationAIOutputSchema = z.object({
  // True only when the ingredient is a non-buyable derived form of one candidate.
  is_form: z.boolean(),
  // Id of the chosen parent candidate; null when is_form is false or unsure.
  parent_id: z.string().nullable(),
  // The matcher phrase to key the form on, e.g. "grated nutmeg".
  matcher: z.string().nullable(),
  // Human-facing label for the form.
  label: z.string().nullable(),
  // Yield: how much of form_unit ONE parent produces.
  form_unit: z.enum(['g', 'ml', 'count']).nullable(),
  amount_per_parent: z.number().nullable(),
  reasoning: z.string(),
});

export type ProductFormArbitrationAIOutput = z.infer<typeof ProductFormArbitrationAIOutputSchema>;

// The mapped, validated proposal the flow returns to the caller. A discriminated
// result so a "not a form" answer is an explicit, non-throwing outcome (Rule 10).
export const ProductFormProposalSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('form'),
    parentCanonId: z.string(),
    matcher: z.string(),
    label: z.string(),
    formUnit: z.enum(['g', 'ml', 'count']),
    amountPerParent: z.number(),
  }),
  z.object({ kind: z.literal('none') }),
]);

export type ProductFormProposal = z.infer<typeof ProductFormProposalSchema>;
