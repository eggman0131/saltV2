import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { CanonItem } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { CanonItemSchema } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

const COLLECTION = 'canonItems';

export function subscribeCanonItems(
  onItems: (items: CanonItem[]) => void,
  onError: (err: DomainError) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    collection(db, COLLECTION),
    (snap) => {
      const valid: CanonItem[] = [];
      for (const d of snap.docs) {
        const result = CanonItemSchema.safeParse(d.data());
        if (result.success) {
          valid.push(result.data as CanonItem);
        } else {
          console.error(`[CanonItemSchema] Document ${d.id} failed validation`, result.error);
        }
      }
      onItems(valid);
    },
    (err) => onError(classifyFirestoreError(err)),
  );
}

export async function upsertCanonItem(item: CanonItem): Promise<void> {
  const db = getFirestore(getApp());
  await setDoc(doc(db, COLLECTION, item.id), { ...item });
}

export async function deleteCanonItem(id: string): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await deleteDoc(doc(db, COLLECTION, id));
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
