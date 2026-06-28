import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  writeBatch,
} from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { ShoppingListItem } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { ShoppingListItemSchema } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

const LISTS_COLLECTION = 'shoppingLists';
const ITEMS_SUB = 'items';

export function subscribeShoppingListItems(
  listId: string,
  onItems: (items: ShoppingListItem[]) => void,
  // rawError forwards the original Firestore error for the real stack alongside
  // the categorised DomainError. Optional + last-positional: backward-compatible.
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    collection(db, LISTS_COLLECTION, listId, ITEMS_SUB),
    (snap) => {
      const valid: ShoppingListItem[] = [];
      for (const d of snap.docs) {
        const result = ShoppingListItemSchema.safeParse(d.data());
        if (result.success) {
          valid.push(result.data as ShoppingListItem);
        } else {
          console.error(
            `[ShoppingListItemSchema] Document ${d.id} failed validation`,
            result.error,
          );
        }
      }
      onItems(valid);
    },
    (err) => onError(classifyFirestoreError(err), err),
  );
}

export async function listShoppingListItems(
  listId: string,
): Promise<ReadResult<readonly ShoppingListItem[], DomainError>> {
  try {
    const db = getFirestore(getApp());
    const snap = await getDocs(collection(db, LISTS_COLLECTION, listId, ITEMS_SUB));
    const valid: ShoppingListItem[] = [];
    for (const d of snap.docs) {
      const result = ShoppingListItemSchema.safeParse(d.data());
      if (result.success) {
        valid.push(result.data as ShoppingListItem);
      } else {
        console.error(`[ShoppingListItemSchema] Document ${d.id} failed validation`, result.error);
      }
    }
    return success(valid);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

export async function saveShoppingListItem(
  listId: string,
  item: ShoppingListItem,
  // Distributed-trace correlation (issue #362, Phase 5). When the browser roots a
  // trace at "add to shopping list", it passes the action span's W3C `traceparent`
  // here so it is stamped onto the doc as `traceContext`; the
  // onShoppingListItemWrite trigger reads it back and continues that trace. Plain
  // string only — firebase-sync NEVER imports observability (Rule 4); it just
  // stores the value. Optional + last-positional so every existing call site
  // (edits, check toggles, batch writes) stays unchanged and writes no field.
  traceparent?: string,
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, LISTS_COLLECTION, listId, ITEMS_SUB, item.id), {
      ...item,
      ...(traceparent ? { traceContext: traceparent } : {}),
    });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

export async function deleteShoppingListItem(
  listId: string,
  itemId: string,
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await deleteDoc(doc(db, LISTS_COLLECTION, listId, ITEMS_SUB, itemId));
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

export async function deleteShoppingListItems(
  listId: string,
  itemIds: readonly string[],
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    const batch = writeBatch(db);
    for (const itemId of itemIds) {
      batch.delete(doc(db, LISTS_COLLECTION, listId, ITEMS_SUB, itemId));
    }
    await batch.commit();
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

export async function moveShoppingListItems(
  sourceListId: string,
  targetListId: string,
  items: readonly ShoppingListItem[],
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    const batch = writeBatch(db);
    for (const item of items) {
      batch.delete(doc(db, LISTS_COLLECTION, sourceListId, ITEMS_SUB, item.id));
      batch.set(doc(db, LISTS_COLLECTION, targetListId, ITEMS_SUB, item.id), { ...item });
    }
    await batch.commit();
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
