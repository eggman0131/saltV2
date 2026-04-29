import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { failure, success } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type { Aisle, AisleStorePort } from '@salt/domain';

const toError = (): DomainError => ({ kind: 'StorageError', reason: 'unavailable' });

export function createFirebaseAisleStoreAdapter(): AisleStorePort {
  return {
    async load() {
      try {
        const db = getFirestore(getApp());
        const snap = await getDoc(doc(db, 'config', 'aisles'));
        if (!snap.exists()) return success(null);
        const data = snap.data() as { aisles?: Aisle[] };
        return success(data.aisles ?? []);
      } catch {
        return failure(toError());
      }
    },

    async save(aisles) {
      try {
        const db = getFirestore(getApp());
        await setDoc(doc(db, 'config', 'aisles'), { aisles: [...aisles], schemaVersion: 1 });
        return success(aisles);
      } catch {
        return failure(toError());
      }
    },
  };
}
