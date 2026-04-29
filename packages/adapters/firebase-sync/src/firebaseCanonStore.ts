import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { failure, success } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type { CanonItem, CanonStorePort } from '@salt/domain';

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

export function createFirebaseCanonStoreAdapter(): CanonStorePort {
  return {
    async save(item) {
      try {
        const db = getFirestore(getApp());
        await setDoc(doc(db, COLLECTION, item.id), toDoc(item));
        return success(item);
      } catch {
        return failure(toError());
      }
    },

    async load(id) {
      try {
        const db = getFirestore(getApp());
        const snap = await getDoc(doc(db, COLLECTION, id));
        return success(snap.exists() ? fromDoc(snap.data() as Record<string, unknown>) : null);
      } catch {
        return failure(toError());
      }
    },

    async list() {
      try {
        const db = getFirestore(getApp());
        const snap = await getDocs(collection(db, COLLECTION));
        return success(snap.docs.map((d) => fromDoc(d.data() as Record<string, unknown>)));
      } catch {
        return failure(toError());
      }
    },

    async delete(id) {
      try {
        const db = getFirestore(getApp());
        await deleteDoc(doc(db, COLLECTION, id));
        return success(undefined);
      } catch {
        return failure(toError());
      }
    },
  };
}
