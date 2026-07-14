import { z } from 'zod';

// A product-form mapping: an alternate form of an ingredient (e.g. "lime juice")
// that resolves to a parent canon item (e.g. the canon "lime") with a yield that
// says how much of the form one parent produces. Family-shared, no per-user
// scoping, no soft-delete (Firestore is master; delete means delete).
export const ProductFormSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  // Matcher strings that identify this form in an ingredient name, e.g. "lime juice".
  matchers: z.array(z.string()),
  // The canonical parent this form resolves to — a CanonItem id.
  parentCanonId: z.string(),
  // Human-facing label for the form, e.g. "freshly squeezed lime juice".
  label: z.string(),
  // Yield: how much of `formUnit` a single parent produces. e.g. one lime yields
  // 30 ml of lime juice → { formUnit: 'ml', amountPerParent: 30 }.
  yield: z.object({
    formUnit: z.enum(['g', 'ml', 'count']),
    amountPerParent: z.number(),
  }),
  // Sync field — parity with canon; stamped on write (LWW, full-doc setDoc).
  updatedAt: z.string(),
});

export type ProductFormDoc = z.infer<typeof ProductFormSchema>;
