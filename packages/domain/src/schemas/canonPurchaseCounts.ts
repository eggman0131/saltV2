import { z } from 'zod';

// `canonData/purchaseCounts` — the household's tick-off history (issue #726).
//
// ONE shared document holding two maps keyed by canon id, not a
// `canonStats/{canonId}` collection: a 30-item bulk tick-off becomes a single
// write instead of 30 against the same hot path, reading it is one `getDoc`
// rather than a collection subscription, and `canonData/{document}` is already
// covered by an existing rule. The 1 MiB ceiling is thousands of canon items
// away from the ~220 that exist.
//
// Deliberately NOT fields on the `canonItems` doc: `upsertCanonItem` writes the
// whole document with `setDoc` from the domain `CanonItem`, so any field outside
// that type is wiped by every canon edit and every CF match write-back. That is
// deterministic, not a race — the same reasoning that moved embeddings out to
// `canonEmbeddings` in #410.
//
// New document, so nothing to migrate: an absent doc reads as empty maps.
export const CanonPurchaseCountsSchema = z.object({
  // Total tick-offs, all time. Counts only ever rise — unchecking an item is a
  // correction, not a return, so the write path is one-directional and the
  // counts cannot drift negative under offline replay.
  counts: z.record(z.string(), z.number()).default({}),
  // ISO timestamp of each item's most recent tick-off. Nothing reads this yet;
  // it is stored because it costs one extra field transform on a write that is
  // already happening and it is the one thing here that genuinely cannot be
  // reconstructed later (recency weighting is impossible to add retrospectively).
  lastAt: z.record(z.string(), z.string()).default({}),
});

export type CanonPurchaseCountsDoc = z.infer<typeof CanonPurchaseCountsSchema>;
