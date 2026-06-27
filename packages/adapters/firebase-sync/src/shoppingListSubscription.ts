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
import { ShoppingListSchema } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

const COLLECTION = 'shoppingLists';

export function subscribeShoppingLists(
  onLists: (lists: ShoppingList[]) => void,
  // rawError forwards the original Firestore error for the real stack alongside
  // the categorised DomainError. Optional + last-positional: backward-compatible.
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    collection(db, COLLECTION),
    (snap) => {
      const valid: ShoppingList[] = [];
      for (const d of snap.docs) {
        const result = ShoppingListSchema.safeParse(d.data());
        if (result.success) {
          valid.push(result.data);
        } else {
          console.error(`[ShoppingListSchema] Document ${d.id} failed validation`, result.error);
        }
      }
      onLists(valid);
    },
    (err) => onError(classifyFirestoreError(err), err),
  );
}

export async function listShoppingLists(): Promise<
  ReadResult<readonly ShoppingList[], DomainError>
> {
  try {
    const db = getFirestore(getApp());
    const snap = await getDocs(collection(db, COLLECTION));
    const valid: ShoppingList[] = [];
    for (const d of snap.docs) {
      const result = ShoppingListSchema.safeParse(d.data());
      if (result.success) {
        valid.push(result.data);
      } else {
        console.error(`[ShoppingListSchema] Document ${d.id} failed validation`, result.error);
      }
    }
    return success(valid);
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
