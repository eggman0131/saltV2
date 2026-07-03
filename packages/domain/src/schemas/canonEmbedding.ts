import { z } from 'zod';

/**
 * Server-only companion doc holding a canon item's name embedding, keyed by the
 * canon id in the `canonEmbeddings/{canonId}` collection (issue #410).
 *
 * WHY A SEPARATE COLLECTION — the embedding (gemini-embedding-001, ~3072 floats)
 * used to live inline on the `canonItems` doc that every client subscribes to
 * wholesale. The browser never reads it, yet paid to first-sync and re-download
 * it on every canon write. Relocating it here keeps vectors off the subscribed
 * doc: only the Cloud Functions match path (Admin SDK) reads this collection, and
 * `firestore.rules` denies clients access entirely. Domain purity is preserved —
 * the pure `CanonItem` still carries `embedding`; the firestoreCanonStore adapter
 * reassembles it from this collection on read and strips it on write.
 */
export const CanonEmbeddingSchema = z.object({
  embedding: z.array(z.number()),
  // Stamp of when the vector was (re)generated. Optional/additive — a future
  // warm-instance cache can invalidate on this watermark (issue #410 step 2/3);
  // absent on rows written before it was added, and never consumed by matching.
  updatedAt: z.string().optional(),
});

export type CanonEmbeddingDoc = z.infer<typeof CanonEmbeddingSchema>;
