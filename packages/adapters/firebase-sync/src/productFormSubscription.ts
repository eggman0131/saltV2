import { getFirestore, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getApp } from 'firebase/app';
import type { ProductForm } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { ProductFormSchema } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';
import { classifyCallableError } from './callableErrors.js';
import { subscribeCollection } from './subscribeCollection.js';
import { FUNCTIONS_REGION } from './functionsRegion.js';

const COLLECTION = 'productForms';

export function subscribeProductForms(
  onItems: (items: ProductForm[]) => void,
  // rawError forwards the original Firestore error alongside the categorised
  // DomainError so the service report site can send the REAL stack to PostHog.
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  return subscribeCollection(
    {
      path: [COLLECTION],
      schema: ProductFormSchema,
      label: 'ProductFormSchema',
      project: (form) => form as ProductForm,
      forwardsRawError: true,
    },
    onItems,
    onError,
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

// Clears a product form's icon server-side (issue #871), re-firing the
// onProductFormWritten trigger so the icon branch regenerates. Used for both the
// "regenerate" and "unhide" actions (both set thumbnail → null). An optional
// `hint` is a one-shot additive steer for the next generation. The exact twin of
// `callRegenerateCanonIcon`, including its error mapping.
export async function callRegenerateProductFormIcon(
  formId: string,
  hint?: string,
): Promise<ReadResult<void, DomainError>> {
  try {
    const fn = httpsCallable<{ formId: string; hint?: string }, { ok: true }>(
      getFunctions(undefined, FUNCTIONS_REGION),
      'regenerateProductFormIcon',
    );
    await fn(hint && hint.trim() ? { formId, hint: hint.trim() } : { formId });
    return success(undefined);
  } catch (err) {
    return failure(classifyCallableError(err));
  }
}
