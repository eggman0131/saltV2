import type { Firestore } from 'firebase-admin/firestore';
import type { CanonItem, CanonLocalStorePort } from '@salt/domain';
import {
  failure,
  success,
  type CanonItemUnit,
  type DomainError,
  type ReadResult,
  type ShoppingBehavior,
} from '@salt/shared-types';

const COLLECTION = 'canonItems';

function fromDoc(data: Record<string, unknown>): CanonItem {
  return {
    id: data['id'] as string,
    schemaVersion: 5,
    name: data['name'] as string,
    synonyms: Array.isArray(data['synonyms']) ? (data['synonyms'] as string[]) : [],
    aisleId: typeof data['aisleId'] === 'string' ? data['aisleId'] : null,
    thumbnail: typeof data['thumbnail'] === 'string' ? data['thumbnail'] : null,
    embedding: Array.isArray(data['embedding']) ? (data['embedding'] as number[]) : null,
    needs_approval: typeof data['needs_approval'] === 'boolean' ? data['needs_approval'] : true,
    shoppingBehavior: (data['shoppingBehavior'] as ShoppingBehavior | undefined) ?? 'needed',
    ...(typeof data['largeQuantityThreshold'] === 'number'
      ? { largeQuantityThreshold: data['largeQuantityThreshold'] as number }
      : {}),
    ...(typeof data['unit'] === 'string' ? { unit: data['unit'] as CanonItemUnit } : {}),
    ...(typeof data['reasoning'] === 'string' ? { reasoning: data['reasoning'] as string } : {}),
    updatedAt: typeof data['updatedAt'] === 'string' ? data['updatedAt'] : '',
  };
}

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
        return success(fromDoc(snap.data() as Record<string, unknown>));
      } catch (err) {
        return failure(classify(err));
      }
    },
    async list(): Promise<ReadResult<readonly CanonItem[], DomainError>> {
      try {
        const snap = await db.collection(COLLECTION).get();
        const items = snap.docs.map((d) => fromDoc(d.data() as Record<string, unknown>));
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
