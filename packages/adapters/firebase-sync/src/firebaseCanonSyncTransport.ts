import { getFirestore, collection, doc, getDocs, setDoc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { failure, success } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type {
  CanonItem,
  CanonSyncTransportPort,
  SyncBatch,
  SyncPending,
  ErrorReportingPort,
} from '@salt/domain';

const COLLECTION = 'canonItems';

function toDoc(item: CanonItem) {
  return { ...item, schemaVersion: 1 as const };
}

function fromDoc(data: Record<string, unknown>): CanonItem {
  return {
    id: data['id'] as string,
    name: data['name'] as string,
    synonyms: Array.isArray(data['synonyms']) ? (data['synonyms'] as string[]) : [],
    aisle: typeof data['aisle'] === 'string' ? data['aisle'] : null,
    thumbnail: typeof data['thumbnail'] === 'string' ? data['thumbnail'] : null,
    embedding: Array.isArray(data['embedding']) ? (data['embedding'] as number[]) : null,
    needs_approval: typeof data['needs_approval'] === 'boolean' ? data['needs_approval'] : true,
  };
}

function toTransportError(_err: unknown): DomainError {
  return { kind: 'StorageError', reason: 'unavailable' };
}

export function createFirebaseCanonSyncTransportAdapter(
  errors: ErrorReportingPort | null = null,
): CanonSyncTransportPort {
  const pendingState: SyncPending & { initialSync: boolean; pull: boolean; push: boolean } = {
    initialSync: false,
    pull: false,
    push: false,
  };

  return {
    get pending(): SyncPending {
      return pendingState;
    },

    async pull(_sinceCursor) {
      pendingState.pull = true;
      try {
        const db = getFirestore(getApp());
        const snap = await getDocs(collection(db, COLLECTION));
        const items = snap.docs.map((d) => fromDoc(d.data() as Record<string, unknown>));
        const cursor = new Date().toISOString();
        return success({ items, cursor });
      } catch (err) {
        errors?.report(err);
        return failure(toTransportError(err));
      } finally {
        pendingState.pull = false;
      }
    },

    async push(item) {
      pendingState.push = true;
      try {
        const db = getFirestore(getApp());
        await setDoc(doc(db, COLLECTION, item.id), toDoc(item));
        return success(item);
      } catch (err) {
        errors?.report(err);
        return failure(toTransportError(err));
      } finally {
        pendingState.push = false;
      }
    },

    subscribe(onChange: (batch: SyncBatch) => void, onError: (err: DomainError) => void) {
      const db = getFirestore(getApp());
      return onSnapshot(
        collection(db, COLLECTION),
        (snapshot) => {
          const upserted: CanonItem[] = [];
          const deleted: string[] = [];
          for (const change of snapshot.docChanges()) {
            if (change.type === 'added' || change.type === 'modified') {
              upserted.push(fromDoc(change.doc.data() as Record<string, unknown>));
            } else {
              deleted.push(change.doc.id);
            }
          }
          onChange({ upserted, deleted });
        },
        (err) => {
          errors?.report(err);
          onError({ kind: 'StorageError', reason: 'unavailable' });
        },
      );
    },
  };
}
