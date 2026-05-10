import type { Firestore } from 'firebase-admin/firestore';
import type { Aisle, AisleLocalStorePort } from '@salt/domain';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';

const AISLES_COLLECTION = 'canonData';
const AISLES_DOC_ID = 'aisles';

function fromDoc(data: Record<string, unknown>): Aisle[] {
  return Array.isArray(data['aisles'])
    ? (data['aisles'] as Array<{ id: string; name: string; order: number }>).map((a) => ({
        id: a.id,
        name: a.name,
        order: typeof a.order === 'number' ? a.order : 0,
      }))
    : [];
}

function classify(_err: unknown): DomainError {
  return { kind: 'StorageError', reason: 'unavailable' };
}

export function createFirestoreAisleStore(db: Firestore): AisleLocalStorePort {
  return {
    async load(): Promise<ReadResult<readonly Aisle[] | null, DomainError>> {
      try {
        const snap = await db.collection(AISLES_COLLECTION).doc(AISLES_DOC_ID).get();
        if (!snap.exists) return success(null);
        const data = snap.data() as Record<string, unknown>;
        return success(fromDoc(data));
      } catch (err) {
        return failure(classify(err));
      }
    },
    // matchOrCreate never writes aisles. Kept as an ok no-op so the port
    // contract stays satisfied without exposing an unused write path.
    async save() {
      return success(undefined);
    },
  };
}
