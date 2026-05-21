import { getFirestore, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { ShoppingListsConfig } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { ShoppingListsConfigSchema } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

const CONFIG_COLLECTION = 'shoppingListsConfig';
const CONFIG_DOC_ID = 'singleton';

export function subscribeShoppingListsConfig(
  onConfig: (config: ShoppingListsConfig | null) => void,
  onError: (err: DomainError) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID),
    (snap) => {
      if (!snap.exists()) {
        onConfig(null);
        return;
      }
      const result = ShoppingListsConfigSchema.safeParse(snap.data());
      if (!result.success) {
        onError({ kind: 'StorageError', reason: 'corruption' });
        return;
      }
      onConfig(result.data);
    },
    (err) => onError(classifyFirestoreError(err)),
  );
}

export async function loadShoppingListsConfig(): Promise<
  ReadResult<ShoppingListsConfig | null, DomainError>
> {
  try {
    const db = getFirestore(getApp());
    const snap = await getDoc(doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID));
    if (!snap.exists()) return success(null);
    const result = ShoppingListsConfigSchema.safeParse(snap.data());
    if (!result.success) return failure({ kind: 'StorageError', reason: 'corruption' });
    return success(result.data);
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
