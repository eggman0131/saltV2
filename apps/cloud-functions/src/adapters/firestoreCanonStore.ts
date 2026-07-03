import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import type { CanonItem, CanonLocalStorePort } from '@salt/domain';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import { CanonItemSchema, CanonEmbeddingSchema, type CanonItemDoc } from '@salt/domain/schemas';
import { startSpan, type ObservabilitySpan } from '@salt/observability/server';

const COLLECTION = 'canonItems';
// Server-only companion collection holding name embeddings, keyed by canon id
// (issue #410). Relocated off the client-subscribed canonItems doc; read here via
// the Admin SDK, denied to clients by firestore.rules. See CanonEmbeddingSchema.
const EMBEDDING_COLLECTION = 'canonEmbeddings';

function classify(_err: unknown): DomainError {
  return { kind: 'StorageError', reason: 'unavailable' };
}

/**
 * Reassemble the pure-domain `CanonItem` (which still carries `embedding`) from a
 * parsed canon doc plus the relocated vectors. Domain purity is preserved: the
 * split storage layout is an adapter concern, invisible to the matcher.
 *
 * Precedence: the relocated `canonEmbeddings` vector wins; if absent (an
 * un-migrated doc), fall back to any inline vector still on the canon doc; else
 * null (an un-embedded item — stage 5 simply skips it). The inline fallback is
 * what makes this back-compatible with zero degradation window regardless of
 * when the one-off migration runs.
 */
function mergeEmbedding(
  parsed: CanonItemDoc,
  embeddings: ReadonlyMap<string, readonly number[]>,
): CanonItem {
  const embedding = embeddings.get(parsed.id) ?? parsed.embedding ?? null;
  // exactOptionalPropertyTypes: zod's optional fields emit T | undefined while
  // CanonItem uses bare optional properties; cast is load-bearing (as elsewhere).
  return { ...parsed, embedding } as CanonItem;
}

export function createFirestoreCanonStore(
  db: Firestore,
  parentSpan?: ObservabilitySpan,
  // Distributed-trace correlation (issue #362, Phase 5). When the shopping-list
  // trigger ran its match within a browser-rooted trace, it threads that W3C
  // `traceparent` here so the written canon doc carries it as `traceContext`,
  // letting onCanonItemWritten continue the SAME trace for icon/embedding work.
  // CRITICAL — DOMAIN PURITY: the domain constructs the pure CanonItem (no
  // traceContext); the ADAPTER adds the field here at write time only. Optional:
  // direct-flow paths (the callable, tests) pass nothing and write no field.
  traceContext?: string,
): CanonLocalStorePort {
  return {
    async upsert(item: CanonItem): Promise<ReadResult<CanonItem, DomainError>> {
      // Child span: the Firestore write of a matched/created canon doc. .set()
      // is an upsert (create OR overwrite) and Firestore does not report which,
      // so we attribute the bounded item id (family-shared, not free-form user
      // text) rather than guessing create-vs-update.
      const span = startSpan(
        'Firestore: write canon item',
        parentSpan ? { parent: parentSpan } : {},
      );
      span.setAttribute('firestore.collection', COLLECTION);
      span.setAttribute('canon.itemId', item.id);
      try {
        // Strip `embedding` before writing (issue #410): vectors live in the
        // server-only canonEmbeddings collection now, never on this
        // client-subscribed doc. The domain only ever produces a null embedding
        // (createCanonItem) or round-trips an existing one loaded by list()/load()
        // — either way the canon-write drops it, and the CF embedding branch owns
        // canonEmbeddings as the single writer. A full-doc .set() also clears any
        // inline vector still on an un-migrated doc; the onCanonItemWritten
        // embedding guard then backfills canonEmbeddings on the resulting write.
        const { embedding: _embedding, ...docFields } = item;
        await db
          .collection(COLLECTION)
          .doc(item.id)
          // The pure CanonItem (minus embedding) plus the correlation field added
          // at the adapter boundary only (domain never sees traceContext). Omitted
          // entirely when absent so direct-flow paths write byte-identical docs.
          .set({ ...docFields, ...(traceContext ? { traceContext } : {}) });
        return success(item);
      } catch (err) {
        return failure(classify(err));
      } finally {
        span.end();
      }
    },
    async load(id: string): Promise<ReadResult<CanonItem | null, DomainError>> {
      try {
        const [snap, embSnap] = await Promise.all([
          db.collection(COLLECTION).doc(id).get(),
          db.collection(EMBEDDING_COLLECTION).doc(id).get(),
        ]);
        if (!snap.exists) return success(null);
        const result = CanonItemSchema.safeParse(snap.data());
        if (!result.success) {
          logger.error('firestoreCanonStore: invalid doc', {
            id,
            error: result.error.message,
          });
          return failure({ kind: 'StorageError', reason: 'corruption' });
        }
        // The embedding doc is a secondary read — a corrupt/missing one degrades
        // to the inline fallback (or null), never fails the canon load: matching
        // tolerates an absent embedding (stage 5 skips it).
        const embeddings = new Map<string, readonly number[]>();
        if (embSnap.exists) {
          const parsed = CanonEmbeddingSchema.safeParse(embSnap.data());
          if (parsed.success) {
            embeddings.set(id, parsed.data.embedding);
          } else {
            logger.error('firestoreCanonStore: invalid embedding doc, ignoring', {
              id,
              error: parsed.error.message,
            });
          }
        }
        return success(mergeEmbedding(result.data, embeddings));
      } catch (err) {
        return failure(classify(err));
      }
    },
    async list(): Promise<ReadResult<readonly CanonItem[], DomainError>> {
      // Child span: the canon candidate retrieval for matching. There is no
      // native Firestore vector query — retrieval is a load-all and cosine
      // similarity is scored in pure domain — so the span is named for what it
      // actually does (a collection read). The candidate count is the scoring
      // input cardinality; capturing it here keeps scoring's outcome visible in
      // the trace without giving the pure-domain scorer a span of its own.
      const span = startSpan(
        'Firestore: load canon candidates',
        parentSpan ? { parent: parentSpan } : {},
      );
      span.setAttribute('firestore.collection', COLLECTION);
      try {
        // Two reads (issue #410): the light, embedding-free canon docs plus the
        // server-only vectors, in parallel. The vectors are joined back by id so
        // the pure matcher still sees CanonItem.embedding — the split is invisible
        // above this adapter. (Optimising the server-side vector load itself —
        // projection / native KNN — is issue #410 step 2/3, not this change.)
        const [canonSnap, embSnap] = await Promise.all([
          db.collection(COLLECTION).get(),
          db.collection(EMBEDDING_COLLECTION).get(),
        ]);

        const embeddings = new Map<string, readonly number[]>();
        for (const doc of embSnap.docs) {
          const parsed = CanonEmbeddingSchema.safeParse(doc.data());
          if (!parsed.success) {
            logger.error('firestoreCanonStore: invalid embedding doc, skipping', {
              id: doc.id,
              error: parsed.error.message,
            });
            continue;
          }
          embeddings.set(doc.id, parsed.data.embedding);
        }

        const items: CanonItem[] = [];
        for (const doc of canonSnap.docs) {
          const result = CanonItemSchema.safeParse(doc.data());
          if (!result.success) {
            logger.error('firestoreCanonStore: invalid doc, skipping', {
              id: doc.id,
              error: result.error.message,
            });
            continue;
          }
          items.push(mergeEmbedding(result.data, embeddings));
        }
        span.setAttribute('canon.candidateCount', items.length);
        span.setAttribute('canon.embeddingCount', embeddings.size);
        return success(items);
      } catch (err) {
        return failure(classify(err));
      } finally {
        span.end();
      }
    },
    async delete(id: string): Promise<ReadResult<void, DomainError>> {
      try {
        // Delete the canon doc and its relocated vector together — Firestore is
        // the master, delete means delete (no tombstones). The embedding delete
        // is best-effort in the same batch; an orphaned vector is inert (nothing
        // reads it without its canon doc) but we clear it to avoid drift.
        await Promise.all([
          db.collection(COLLECTION).doc(id).delete(),
          db.collection(EMBEDDING_COLLECTION).doc(id).delete(),
        ]);
        return success(undefined);
      } catch (err) {
        return failure(classify(err));
      }
    },
  };
}
