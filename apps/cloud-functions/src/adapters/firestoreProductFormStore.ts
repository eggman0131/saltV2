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
  upsert(form: ProductForm): Promise<ReadResult<ProductForm, DomainError>>;
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
    // Write path for AI-seeded proposals (issue #500, Phase 3), mirroring
    // firestoreCanonStore.upsert. Full-doc `.set()` (LWW). `undefined` fields are
    // stripped so an absent optional (e.g. an unset needs_approval) never trips
    // firebase-admin's undefined-value rejection. Never throws — a write failure
    // crosses the boundary as Failure (Rule 10) and the caller degrades to plain
    // matching, so a proposal is purely additive.
    async upsert(form: ProductForm): Promise<ReadResult<ProductForm, DomainError>> {
      try {
        const doc = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== undefined));
        await db.collection(COLLECTION).doc(form.id).set(doc);
        return success(form);
      } catch (err) {
        return failure(classify(err));
      }
    },
  };
}
