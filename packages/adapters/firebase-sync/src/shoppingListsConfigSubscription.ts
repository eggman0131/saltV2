import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { ShoppingListsConfig } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { ShoppingListsConfigSchema } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';
import { subscribeDocument } from './subscribeDocument.js';

const CONFIG_COLLECTION = 'shoppingListsConfig';
const CONFIG_DOC_ID = 'singleton';

export function subscribeShoppingListsConfig(
  onConfig: (config: ShoppingListsConfig | null) => void,
  // rawError forwards the original Firestore error for the real stack; the
  // synthetic schema-corruption DomainError has none, so the parse path omits
  // it (see subscribeDocument.ts).
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  return subscribeDocument(
    {
      path: [CONFIG_COLLECTION, CONFIG_DOC_ID],
      schema: ShoppingListsConfigSchema,
      label: 'ShoppingListsConfigSchema',
    },
    onConfig,
    onError,
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
