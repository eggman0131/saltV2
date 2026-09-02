import { z } from 'zod';
import { CANON_ITEM_UNITS } from '@salt/shared-types';

// A product-form mapping: an alternate form of an ingredient (e.g. "lime juice")
// that resolves to a parent canon item (e.g. the canon "lime") with a yield that
// says how much of the form one parent produces. Family-shared, no per-user
// scoping, no soft-delete (Firestore is master; delete means delete).
export const ProductFormSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  // EXTRA phrasings that identify this form in an ingredient name, beyond the
  // label itself, e.g. "dark meat" on a form labelled "Chicken Legs". Saved
  // verbatim as typed; folding happens at match time (`resolveProductForm`).
  matchers: z.array(z.string()),
  // The canonical parent this form resolves to — a CanonItem id.
  parentCanonId: z.string(),
  // Human-facing label for the form, e.g. "freshly squeezed lime juice".
  // NOT display-only: `resolveProductForm` matches the label on equal terms with
  // `matchers`, so a form never needs to repeat its own name there (issue #818).
  label: z.string(),
  // Yield: how much of `formUnit` a single parent produces. e.g. one lime yields
  // 30 ml of lime juice → { formUnit: 'ml', amountPerParent: 30 }.
  yield: z.object({
    formUnit: z.enum(CANON_ITEM_UNITS),
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
  // ─── Icon (Tier-1 pictogram, issue #871) ──────────────────────────────────
  // The same tri-state contract as `CanonItemSchema.thumbnail` (issue #148),
  // field-for-field: `null` = not generated yet, an https URL = a real icon,
  // `CANON_ICON_HIDDEN` = the user opted out and the trigger skips it forever.
  // A form gets its OWN pictogram rather than borrowing its parent's, because a
  // form exists precisely when the thing you buy looks different from the parent
  // (lime juice vs. a whole lime).
  //
  // `.default(null)` rather than canon's bare `.nullable()`: productForms is live
  // production data (issue #512), and every form written before this shipped has
  // no `thumbnail` key at all. The default makes those docs parse as "not
  // generated yet" — which is exactly what they are — instead of failing
  // validation and being skipped by the realtime subscription.
  thumbnail: z.string().nullable().default(null),
  // Transient one-shot steer for the next icon (re)generation. Written by the
  // regenerateProductFormIcon callable, consumed and cleared by the
  // onProductFormWritten icon branch.
  iconHint: z.string().optional(),
  // Regenerate nonce (epoch ms), load-bearing for the same reason as canon's: a
  // no-op `.update()` emits no Firestore write event, so re-requesting an icon
  // for a form whose thumbnail is ALREADY null would never re-fire the trigger
  // without a field that actually changes.
  iconRequestedAt: z.number().optional(),
});

export type ProductFormDoc = z.infer<typeof ProductFormSchema>;

// The yield sub-object, reached through the parent doc: it is declared inline on
// ProductFormSchema, so there is no standalone schema value to infer from.
export type ProductFormYieldDoc = ProductFormDoc['yield'];
