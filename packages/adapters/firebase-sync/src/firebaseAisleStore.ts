import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { failure, success } from '@salt/shared-types';
import type { Aisle, AisleStorePort, ErrorReportingPort } from '@salt/domain';
import { classifyFirestoreError } from './firestoreErrors.js';

export function createFirebaseAisleStoreAdapter(
  errors: ErrorReportingPort | null = null,
): AisleStorePort {
  return {
    async load() {
      try {
        const db = getFirestore(getApp());
        const snap = await getDoc(doc(db, 'config', 'aisles'));
        if (!snap.exists()) return success(null);
        const data = snap.data() as { aisles?: Aisle[] };
        return success(data.aisles ?? []);
      } catch (err) {
        errors?.report(err);
        return failure(classifyFirestoreError(err));
      }
    },

    async save(aisles) {
      try {
        const db = getFirestore(getApp());
        await setDoc(doc(db, 'config', 'aisles'), { aisles: [...aisles], schemaVersion: 1 });
        return success(aisles);
      } catch (err) {
        errors?.report(err);
        return failure(classifyFirestoreError(err));
      }
    },
  };
}
