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
  // Needs-review flag, mirroring canon's `needs_approval` (issue #500, Phase 3).
  // An AI-seeded proposal is written with this true; an admin confirms it (flips
  // false) after reviewing the suggested parent + yield. OPTIONAL: absent/false =
  // confirmed, so Phase-1/2-authored and admin-created forms stay valid on read
  // (back-compat — productForms is Firestore-master production data). NOT a gate
  // on resolution: a pending form resolves recipes live the moment it is written,
  // exactly like a `needs_approval` canon item is matched live. The flag only
  // drives the review badge + confirm affordance.
  needs_approval: z.boolean().optional(),
});

export type ProductFormDoc = z.infer<typeof ProductFormSchema>;
