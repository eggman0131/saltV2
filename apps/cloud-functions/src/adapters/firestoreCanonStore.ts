import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import type { CanonItem, CanonLocalStorePort } from '@salt/domain';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import { CanonItemSchema } from '@salt/domain/schemas';

const COLLECTION = 'canonItems';

function classify(_err: unknown): DomainError {
  return { kind: 'StorageError', reason: 'unavailable' };
}

export function createFirestoreCanonStore(db: Firestore): CanonLocalStorePort {
  return {
    async upsert(item: CanonItem): Promise<ReadResult<CanonItem, DomainError>> {
      try {
        await db
          .collection(COLLECTION)
          .doc(item.id)
          .set({ ...item });
        return success(item);
      } catch (err) {
        return failure(classify(err));
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
        return success(items);
      } catch (err) {
        return failure(classify(err));
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
