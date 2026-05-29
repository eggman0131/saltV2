import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import type { Aisle, AisleLocalStorePort } from '@salt/domain';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import { AislesDocumentSchema } from '@salt/domain/schemas';

const AISLES_COLLECTION = 'canonData';
const AISLES_DOC_ID = 'aisles';

function classify(_err: unknown): DomainError {
  return { kind: 'StorageError', reason: 'unavailable' };
}

export function createFirestoreAisleStore(db: Firestore): AisleLocalStorePort {
  return {
    async load(): Promise<ReadResult<readonly Aisle[] | null, DomainError>> {
      try {
        const snap = await db.collection(AISLES_COLLECTION).doc(AISLES_DOC_ID).get();
        if (!snap.exists) return success(null);
        const result = AislesDocumentSchema.safeParse(snap.data());
        if (!result.success) {
          logger.error('firestoreAisleStore: invalid doc', { error: result.error.message });
          return failure({ kind: 'StorageError', reason: 'corruption' });
        }
        return success(result.data.aisles);
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
