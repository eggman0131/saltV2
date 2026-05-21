import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { Aisle } from '@salt/domain';
import type { DomainError } from '@salt/shared-types';
import { AislesDocumentSchema } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

const AISLES_COLLECTION = 'canonData';
const AISLES_DOC_ID = 'aisles';

export function subscribeAisles(
  onAisles: (aisles: Aisle[]) => void,
  onError: (err: DomainError) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    doc(db, AISLES_COLLECTION, AISLES_DOC_ID),
    (snap) => {
      if (!snap.exists()) {
        onAisles([]);
        return;
      }
      const result = AislesDocumentSchema.safeParse(snap.data());
      if (!result.success) {
        onError({ kind: 'StorageError', reason: 'corruption' });
        return;
      }
      onAisles(result.data.aisles);
    },
    (err) => onError(classifyFirestoreError(err)),
  );
}

export async function saveAisles(aisles: Aisle[]): Promise<void> {
  const db = getFirestore(getApp());
  await setDoc(doc(db, AISLES_COLLECTION, AISLES_DOC_ID), {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    aisles: [...aisles],
  });
}
