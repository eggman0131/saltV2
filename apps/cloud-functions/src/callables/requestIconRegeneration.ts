import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { iconRegenerationFields } from '@salt/domain';
import { reportFlowError } from '../observability/reportServerError.js';

/**
 * The write behind every "regenerate this icon" request, shared by the canon-item
 * and product-form callables (issues #148, #871).
 *
 * Clearing `thumbnail` is what re-fires the owning trigger's icon branch; the
 * `iconRequestedAt` nonce is what makes the clear a real write. When the record
 * has no icon yet `thumbnail` is *already* null, so writing null again is a no-op
 * and Firestore emits no write event — the trigger would never fire. A fresh
 * nonce guarantees the update always mutates the document.
 *
 * Passing no `hint` deletes any stale hint, so a plain regenerate is plain rather
 * than silently inheriting the last steer someone typed.
 *
 * The field set itself is `@salt/domain`'s `iconRegenerationFields`, shared with
 * the admin screens' `regenerateKitchenToolIcon` — an app this one cannot import.
 * What is NOT shared is the delete: this is a partial `.update()`, where an
 * absent key means "leave it alone", so the delete has to be spelled out. The
 * client's whole-document `setDoc` deletes by omission instead.
 *
 * Parameterised on collection because the two callables differ ONLY in which
 * collection and which id field they address — the semantics above are one
 * behaviour, and two copies of them would be two places to get the nonce wrong.
 * The callables stay separate (own auth guard, own wire schema); only this write
 * is shared.
 */
export async function requestIconRegeneration(
  collection: 'canonItems' | 'productForms',
  id: string,
  hint: string | undefined,
): Promise<void> {
  const fields = iconRegenerationFields(Date.now(), hint);
  try {
    await getFirestore()
      .collection(collection)
      .doc(id)
      .update({
        ...fields,
        // Absence is the builder's way of saying "no steer"; on a partial update
        // it has to become an explicit delete. Never `iconHint: undefined` —
        // the Admin SDK rejects that outright.
        ...('iconHint' in fields ? {} : { iconHint: FieldValue.delete() }),
      });
  } catch (err) {
    // An unexpected Firestore write failure (StorageError-class) — report it
    // additively, flush, then re-throw so each callable's error path is
    // unchanged. Auth/validation guards throw HttpsError before reaching here.
    await reportFlowError(err);
    throw err;
  }
}
