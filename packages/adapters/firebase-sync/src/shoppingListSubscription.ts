import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  updateDoc,
  onSnapshot,
} from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { ShoppingList } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { classifyFirestoreError } from './firestoreErrors.js';

const COLLECTION = 'shoppingLists';

function fromDoc(data: Record<string, unknown>): ShoppingList {
  return {
    id: String(data['id'] ?? ''),
    name: String(data['name'] ?? ''),
    schemaVersion: 1,
    createdAt: String(data['createdAt'] ?? ''),
    updatedAt: String(data['updatedAt'] ?? ''),
  };
}

export function subscribeShoppingLists(
  onLists: (lists: ShoppingList[]) => void,
  onError: (err: DomainError) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    collection(db, COLLECTION),
    (snap) => onLists(snap.docs.map((d) => fromDoc(d.data() as Record<string, unknown>))),
    (err) => onError(classifyFirestoreError(err)),
  );
}

export async function listShoppingLists(): Promise<
  ReadResult<readonly ShoppingList[], DomainError>
> {
  try {
    const db = getFirestore(getApp());
    const snap = await getDocs(collection(db, COLLECTION));
    return success(snap.docs.map((d) => fromDoc(d.data() as Record<string, unknown>)));
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

export async function createShoppingList(
  list: ShoppingList,
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, COLLECTION, list.id), { ...list });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

export async function renameShoppingList(
  id: string,
  name: string,
  updatedAt: string,
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await updateDoc(doc(db, COLLECTION, id), { name, updatedAt });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

export async function deleteShoppingList(id: string): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await deleteDoc(doc(db, COLLECTION, id));
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
