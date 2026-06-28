import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import type { CanonItem, CanonLocalStorePort } from '@salt/domain';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import { CanonItemSchema } from '@salt/domain/schemas';
import { startSpan, type ObservabilitySpan } from '@salt/observability/server';

const COLLECTION = 'canonItems';

function classify(_err: unknown): DomainError {
  return { kind: 'StorageError', reason: 'unavailable' };
}

// The canon match parent span (canon.matchOrCreateCanon / the recipe batch span)
// is created with a plain startSpan and is NOT installed as the active OTel
// context during adapter execution, so a child span must be parented EXPLICITLY
// via { parent } — relying on context.active() would re-root it. The parent is
// threaded in from buildMatchOrCreatePorts(parentSpan), mirroring how the
// match-logging adapter already receives it. parentSpan is optional: direct-flow
// paths (the trigger, tests) pass nothing and the spans simply inherit the
// active context (a no-op span when Firebase telemetry is off).
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
        await db
          .collection(COLLECTION)
          .doc(item.id)
          // The pure CanonItem plus the correlation field added at the adapter
          // boundary only (domain never sees traceContext). Omitted entirely
          // when absent so direct-flow paths write byte-identical docs.
          .set({ ...item, ...(traceContext ? { traceContext } : {}) });
        return success(item);
      } catch (err) {
        return failure(classify(err));
      } finally {
        span.end();
      }
    },
    async load(id: string): Promise<ReadResult<CanonItem | null, DomainError>> {
      try {
        const snap = await db.collection(COLLECTION).doc(id).get();
        if (!snap.exists) return success(null);
        const result = CanonItemSchema.safeParse(snap.data());
        if (!result.success) {
          logger.error('firestoreCanonStore: invalid doc', {
            id,
            error: result.error.message,
          });
          return failure({ kind: 'StorageError', reason: 'corruption' });
        }
        // exactOptionalPropertyTypes: zod's .optional() emits T | undefined
        // while CanonItem uses bare optional properties; cast is load-bearing.
        return success(result.data as CanonItem);
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
        const snap = await db.collection(COLLECTION).get();
        const items: CanonItem[] = [];
        for (const doc of snap.docs) {
          const result = CanonItemSchema.safeParse(doc.data());
          if (!result.success) {
            logger.error('firestoreCanonStore: invalid doc, skipping', {
              id: doc.id,
              error: result.error.message,
            });
            continue;
          }
          // exactOptionalPropertyTypes: same cast rationale as load().
          items.push(result.data as CanonItem);
        }
        span.setAttribute('canon.candidateCount', items.length);
        return success(items);
      } catch (err) {
        return failure(classify(err));
      } finally {
        span.end();
      }
    },
    async delete(id: string): Promise<ReadResult<void, DomainError>> {
      try {
        await db.collection(COLLECTION).doc(id).delete();
        return success(undefined);
      } catch (err) {
        return failure(classify(err));
      }
    },
  };
}
