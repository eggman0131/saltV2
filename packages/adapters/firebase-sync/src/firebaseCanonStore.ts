import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
} from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { failure, success } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type { CanonItem, CanonStorePort, ErrorReportingPort } from '@salt/domain';

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

const toError = (): DomainError => ({ kind: 'StorageError', reason: 'unavailable' });

export function subscribeCanonToLocalStore(
  localStore: CanonStorePort,
  errors: ErrorReportingPort | null = null,
  onBatchComplete?: () => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    collection(db, COLLECTION),
    async (snapshot) => {
      await Promise.all(
        snapshot.docChanges().map((change) => {
          if (change.type === 'added' || change.type === 'modified') {
            return localStore.save(fromDoc(change.doc.data() as Record<string, unknown>));
          }
          return localStore.delete(change.doc.id);
        }),
      );
      onBatchComplete?.();
    },
    (err) => errors?.report(err),
  );
}

export function createFirebaseCanonStoreAdapter(
  errors: ErrorReportingPort | null = null,
): CanonStorePort {
  return {
    async save(item) {
      try {
        const db = getFirestore(getApp());
        await setDoc(doc(db, COLLECTION, item.id), toDoc(item));
        return success(item);
      } catch (err) {
        errors?.report(err);
        return failure(toError());
      }
    },

    async load(id) {
      try {
        const db = getFirestore(getApp());
        const snap = await getDoc(doc(db, COLLECTION, id));
        return success(snap.exists() ? fromDoc(snap.data() as Record<string, unknown>) : null);
      } catch (err) {
        errors?.report(err);
        return failure(toError());
      }
    },

    async list() {
      try {
        const db = getFirestore(getApp());
        const snap = await getDocs(collection(db, COLLECTION));
        return success(snap.docs.map((d) => fromDoc(d.data() as Record<string, unknown>)));
      } catch (err) {
        errors?.report(err);
        return failure(toError());
      }
    },

    async delete(id) {
      try {
        const db = getFirestore(getApp());
        await deleteDoc(doc(db, COLLECTION, id));
        return success(undefined);
      } catch (err) {
        errors?.report(err);
        return failure(toError());
      }
    },
  };
}
