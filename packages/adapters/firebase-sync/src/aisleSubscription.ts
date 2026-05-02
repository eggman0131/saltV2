import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { Aisle } from '@salt/domain';
import type { DomainError } from '@salt/shared-types';
import { classifyFirestoreError } from './firestoreErrors.js';

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

export function subscribeAisles(
  onAisles: (aisles: Aisle[]) => void,
  onError: (err: DomainError) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    doc(db, AISLES_COLLECTION, AISLES_DOC_ID),
    (snap) => {
      onAisles(snap.exists() ? fromDoc(snap.data() as Record<string, unknown>) : []);
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
