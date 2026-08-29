import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  updateDoc,
} from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { ShoppingList } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { ShoppingListSchema } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';
import { parseDocuments } from './schemaParsing.js';
import { subscribeCollection } from './subscribeCollection.js';

const COLLECTION = 'shoppingLists';

export function subscribeShoppingLists(
  onLists: (lists: ShoppingList[]) => void,
  // rawError forwards the original Firestore error for the real stack alongside
  // the categorised DomainError. Optional + last-positional: backward-compatible.
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  return subscribeCollection(
    {
      path: [COLLECTION],
      schema: ShoppingListSchema,
      label: 'ShoppingListSchema',
      project: (list) => list,
    },
    onLists,
    onError,
  );
}

export async function listShoppingLists(): Promise<
  ReadResult<readonly ShoppingList[], DomainError>
> {
  try {
    const db = getFirestore(getApp());
    const snap = await getDocs(collection(db, COLLECTION));
    // The same list contract the subscription above delivers, through the same
    // parse loop — this one-shot used to repeat it verbatim (#928, B2-006).
    return success(
      parseDocuments(snap.docs, ShoppingListSchema, 'ShoppingListSchema', (list) => list),
    );
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
