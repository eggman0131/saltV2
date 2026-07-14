import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { ProductForm } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { ProductFormSchema } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

const COLLECTION = 'productForms';

export function subscribeProductForms(
  onItems: (items: ProductForm[]) => void,
  // rawError forwards the original Firestore error alongside the categorised
  // DomainError so the service report site can send the REAL stack to PostHog.
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    collection(db, COLLECTION),
    (snap) => {
      const valid: ProductForm[] = [];
      for (const d of snap.docs) {
        const result = ProductFormSchema.safeParse(d.data());
        if (result.success) {
          valid.push(result.data as ProductForm);
        } else {
          console.error(`[ProductFormSchema] Document ${d.id} failed validation`, result.error);
        }
      }
      onItems(valid);
    },
    (err) => onError(classifyFirestoreError(err), err),
  );
}

export async function upsertProductForm(item: ProductForm): Promise<void> {
  const db = getFirestore(getApp());
  await setDoc(doc(db, COLLECTION, item.id), { ...item });
}

export async function deleteProductForm(id: string): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await deleteDoc(doc(db, COLLECTION, id));
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
