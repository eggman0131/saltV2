import { z } from 'zod';

// One Firestore document at `shoppingLists/{listId}`.
//
// EVERY FIELD IS REQUIRED, and that is a decision rather than an oversight
// (issue #1114). All five carried a `.default('')` until then, which meant a
// document missing pieces did not FAIL validation — it was filled in with
// blanks and delivered to the screen as a real list. The list read's contract is
// to SKIP an invalid document and log it (docs/data-model.md, "Adapter list
// reads & collection subscriptions"), and a schema that cannot fail is a
// contract that cannot run.
//
// Removing a default is a NARROWING over a collection holding real production
// data, so it was measured before it was made rather than argued from symmetry:
// scripts/audit-shopping-list-fields.mjs, run 2026-09-03, found 0 of 12 list
// documents across prod, staging and dev lacking any of these five, and 0
// carrying a value that would fail. Nothing is newly skipped.
//
// The honest limit of that measurement: it saw the documents that EXIST, not
// every document that ever has. That is the right basis for this change — what
// a required field can skip is what is in the collection when the code ships —
// but it is not a claim that no list ever lacked a field. Re-run the audit
// before adding a sixth.
//
// `id` is doubly covered: `shoppingListSubscription.ts` delivers the Firestore
// DOCUMENT id rather than this field, so a blank one cannot reach a read path
// even if one were written.
export const ShoppingListSchema = z.object({
  id: z.string(),
  name: z.string(),
  schemaVersion: z.literal(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ShoppingListDoc = z.infer<typeof ShoppingListSchema>;
