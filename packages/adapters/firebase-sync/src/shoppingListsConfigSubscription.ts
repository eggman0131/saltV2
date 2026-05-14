import { getFirestore, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { ShoppingListsConfig } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { classifyFirestoreError } from './firestoreErrors.js';

const CONFIG_COLLECTION = 'shoppingListsConfig';
const CONFIG_DOC_ID = 'singleton';

function fromDoc(data: Record<string, unknown>): ShoppingListsConfig {
  return {
    defaultListId: String(data['defaultListId'] ?? ''),
    schemaVersion: 1,
  };
}

export function subscribeShoppingListsConfig(
  onConfig: (config: ShoppingListsConfig | null) => void,
  onError: (err: DomainError) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID),
    (snap) => onConfig(snap.exists() ? fromDoc(snap.data() as Record<string, unknown>) : null),
    (err) => onError(classifyFirestoreError(err)),
  );
}

export async function loadShoppingListsConfig(): Promise<
  ReadResult<ShoppingListsConfig | null, DomainError>
> {
  try {
    const db = getFirestore(getApp());
    const snap = await getDoc(doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID));
    return success(snap.exists() ? fromDoc(snap.data() as Record<string, unknown>) : null);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

export async function saveShoppingListsConfig(
  config: ShoppingListsConfig,
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID), { ...config });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
