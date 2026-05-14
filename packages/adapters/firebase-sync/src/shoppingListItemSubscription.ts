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
import type { ShoppingListItem, MatchState, SourceRef } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { classifyFirestoreError } from './firestoreErrors.js';

const LISTS_COLLECTION = 'shoppingLists';
const ITEMS_SUB = 'items';

const VALID_MATCH_STATES = new Set<string>(['pending', 'matched', 'needs_approval', 'failed']);

function isMatchState(v: unknown): v is MatchState {
  return typeof v === 'string' && VALID_MATCH_STATES.has(v);
}

function sourcesFromDoc(raw: unknown): SourceRef[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s: unknown): SourceRef => {
    const src = s as Record<string, unknown>;
    if (src['kind'] === 'recipe') {
      const ref: SourceRef = {
        kind: 'recipe',
        recipeId: String(src['recipeId'] ?? ''),
        servings: typeof src['servings'] === 'number' ? src['servings'] : 1,
        ...(typeof src['label'] === 'string' ? { label: src['label'] } : {}),
      };
      return ref;
    }
    return { kind: 'manual' };
  });
}

function fromDoc(data: Record<string, unknown>): ShoppingListItem {
  return {
    id: String(data['id'] ?? ''),
    rawText: String(data['rawText'] ?? ''),
    notes: String(data['notes'] ?? ''),
    sources: sourcesFromDoc(data['sources']),
    canonId: typeof data['canonId'] === 'string' ? data['canonId'] : null,
    matchState: isMatchState(data['matchState']) ? data['matchState'] : 'pending',
    checked: Boolean(data['checked']),
    schemaVersion: 1,
    createdAt: String(data['createdAt'] ?? ''),
    updatedAt: String(data['updatedAt'] ?? ''),
  };
}

export function subscribeShoppingListItems(
  listId: string,
  onItems: (items: ShoppingListItem[]) => void,
  onError: (err: DomainError) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    collection(db, LISTS_COLLECTION, listId, ITEMS_SUB),
    (snap) => onItems(snap.docs.map((d) => fromDoc(d.data() as Record<string, unknown>))),
    (err) => onError(classifyFirestoreError(err)),
  );
}

export async function listShoppingListItems(
  listId: string,
): Promise<ReadResult<readonly ShoppingListItem[], DomainError>> {
  try {
    const db = getFirestore(getApp());
    const snap = await getDocs(collection(db, LISTS_COLLECTION, listId, ITEMS_SUB));
    return success(snap.docs.map((d) => fromDoc(d.data() as Record<string, unknown>)));
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

export async function saveShoppingListItem(
  listId: string,
  item: ShoppingListItem,
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, LISTS_COLLECTION, listId, ITEMS_SUB, item.id), { ...item });
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
