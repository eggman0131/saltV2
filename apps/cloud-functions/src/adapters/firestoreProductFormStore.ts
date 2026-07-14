import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import type { ProductForm } from '@salt/domain';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import { ProductFormSchema } from '@salt/domain/schemas';

const COLLECTION = 'productForms';

function classify(_err: unknown): DomainError {
  return { kind: 'StorageError', reason: 'unavailable' };
}

/**
 * Read-only firebase-admin store over `productForms`, mirroring
 * firestoreCanonStore's `list()`: parse each doc with ProductFormSchema and skip
 * (log) the invalid ones so one corrupt form never fails the whole read
 * (list-read convention). cloud-functions must NOT import @salt/firebase-sync
 * (Rule 8) — this is the server-side read the canonicalise flow consults to bind
 * a form ingredient to its parent canon before matching.
 */
export function createFirestoreProductFormStore(db: Firestore): {
  list(): Promise<ReadResult<readonly ProductForm[], DomainError>>;
} {
  return {
    async list(): Promise<ReadResult<readonly ProductForm[], DomainError>> {
      try {
        const snap = await db.collection(COLLECTION).get();
        const forms: ProductForm[] = [];
        for (const d of snap.docs) {
          const result = ProductFormSchema.safeParse(d.data());
          if (!result.success) {
            logger.error('firestoreProductFormStore: invalid doc, skipping', {
              id: d.id,
              error: result.error.message,
            });
            continue;
          }
          forms.push(result.data as ProductForm);
        }
        return success(forms);
      } catch (err) {
        return failure(classify(err));
      }
    },
  };
}
