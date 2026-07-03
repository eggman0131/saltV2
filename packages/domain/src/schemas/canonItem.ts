import { z } from 'zod';

export const CanonItemSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(5),
  name: z.string(),
  synonyms: z.array(z.string()),
  aisleId: z.string().nullable(),
  thumbnail: z.string().nullable(),
  // Transient one-shot steer for the next icon (re)generation (issue #148).
  // Written by the regenerateCanonIcon callable alongside thumbnail: null;
  // consumed and cleared by the onCanonItemWritten icon branch.
  iconHint: z.string().optional(),
  // Regenerate nonce (epoch ms): the regenerateCanonIcon callable stamps this on
  // every request so the write always mutates the doc — even when thumbnail is
  // already null — which is what re-fires the onCanonItemWritten icon branch
  // (Firestore emits no write event for a no-op update). Number, not a Firestore
  // Timestamp, so both the trigger and the client subscription parse it cleanly.
  iconRequestedAt: z.number().optional(),
  // RELOCATED (issue #410): the name embedding now lives in the server-only
  // `canonEmbeddings/{id}` collection (see CanonEmbeddingSchema), not on this
  // client-subscribed doc. Kept OPTIONAL — not removed — purely for back-compat
  // on read: docs written before the migration still carry an inline vector and
  // must stay valid, and the firestoreCanonStore adapter reads it as a fallback
  // until the one-off migration relocates it. New writes never set it here (the
  // adapter strips it; the CF embedding branch writes canonEmbeddings). Do NOT
  // reintroduce writes to this field.
  embedding: z.array(z.number()).nullable().optional(),
  needs_approval: z.boolean(),
  shoppingBehavior: z.enum(['stocked', 'check', 'needed']),
  largeQuantityThreshold: z.number().optional(),
  unit: z.enum(['g', 'ml', 'count']).optional(),
  reasoning: z.string().optional(),
  updatedAt: z.string(),
  // Distributed-trace correlation field (issue #362, Phase 5). A W3C
  // `traceparent` string the onShoppingListItemWrite trigger stamps onto the
  // canon doc at match write-back, so the onCanonItemWritten icon/embedding
  // trigger can continue the same browser-rooted trace. TRANSPORT ONLY — domain
  // logic must never branch on it, and the pure domain CanonItem never carries
  // it: the firestoreCanonStore adapter adds the field at write time. Optional
  // and additive: old docs lack it and stay valid (back-compat on read). A bare
  // traceContext-only write is a no-op for the icon/embedding idempotency guards
  // (they key off thumbnail/iconRequestedAt/embedding, never this field), so
  // stamping it cannot loop the trigger.
  traceContext: z.string().optional(),
});

export type CanonItemDoc = z.infer<typeof CanonItemSchema>;
