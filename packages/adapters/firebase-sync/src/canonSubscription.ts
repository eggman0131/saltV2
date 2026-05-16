import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { CanonItem } from '@salt/domain';
import type { DomainError, ReadResult, ShoppingBehavior, CanonItemUnit } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { classifyFirestoreError } from './firestoreErrors.js';

const COLLECTION = 'canonItems';

function fromDoc(data: Record<string, unknown>): CanonItem {
  return {
    id: data['id'] as string,
    schemaVersion: 4,
    name: data['name'] as string,
    synonyms: Array.isArray(data['synonyms']) ? (data['synonyms'] as string[]) : [],
    aisleId: typeof data['aisleId'] === 'string' ? data['aisleId'] : null,
    thumbnail: typeof data['thumbnail'] === 'string' ? data['thumbnail'] : null,
    embedding: Array.isArray(data['embedding']) ? (data['embedding'] as number[]) : null,
    needs_approval: typeof data['needs_approval'] === 'boolean' ? data['needs_approval'] : true,
    shoppingBehavior: (data['shoppingBehavior'] as ShoppingBehavior | undefined) ?? 'needed',
    ...(typeof data['largeQuantityThreshold'] === 'number'
      ? { largeQuantityThreshold: data['largeQuantityThreshold'] as number }
      : {}),
    ...(typeof data['unit'] === 'string' ? { unit: data['unit'] as CanonItemUnit } : {}),
    ...(typeof data['reasoning'] === 'string' ? { reasoning: data['reasoning'] } : {}),
    updatedAt: typeof data['updatedAt'] === 'string' ? data['updatedAt'] : '',
    deletedAt: typeof data['deletedAt'] === 'string' ? data['deletedAt'] : null,
  };
}

export function subscribeCanonItems(
  onItems: (items: CanonItem[]) => void,
  onError: (err: DomainError) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    collection(db, COLLECTION),
    (snap) => {
      onItems(snap.docs.map((d) => fromDoc(d.data() as Record<string, unknown>)));
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
