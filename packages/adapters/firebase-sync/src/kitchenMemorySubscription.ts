import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { KitchenMemorySchema, type KitchenMemoryDoc } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

// Kitchen memories (issue #816) — the notes the household wrote for the chef. One
// document per note at `kitchenMemories/{id}`, a random id, so this is a COLLECTION
// subscription rather than the single-doc shape guidedPlans and formulas use.
//
// That is the point of the collection: whole-document last-write-wins with no merge
// logic at any layer means an array of notes inside one document would lose a note
// whenever both members added one at the same moment. A document each makes every
// add independent and every delete a `deleteDoc`. See the schema header.
//
// FAMILY-SHARED, exactly as guidedPlans and formulas are: no `ownerUid`, no pinning,
// and firestore.rules gates on "signed in" alone. `author` is a display NAME
// denormalised at write time, never a uid — uids appear nowhere in the family-shared
// data model.
//
// Read contract: the LIST contract, like recipeSubscription. A note that fails
// validation is skipped and logged, and the valid ones are delivered — one corrupt
// document must not empty the memory list. This deliberately differs from
// guidedPlanSubscription, which refuses a corrupt plan: a plan is a large reviewed
// artefact whose loss would invite an overwrite, whereas a note is one sentence and
// the other twenty are still worth showing. Stream-level errors surface via onError.
//
// Writes never throw for operational errors: they cross the boundary as
// Failure<DomainError> (Rule 10). This adapter must not import @salt/observability
// (Rule 4).

const COLLECTION = 'kitchenMemories';

/**
 * Subscribe to every kitchen memory. Both members see the same set, live — a note
 * one of them writes turns up on the other's screen without a reload.
 */
export function subscribeKitchenMemories(
  onMemories: (memories: KitchenMemoryDoc[]) => void,
  // rawError forwards the original Firestore error for the real stack alongside
  // the categorised DomainError. Optional + last-positional: backward-compatible.
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    collection(db, COLLECTION),
    (snap) => {
      const valid: KitchenMemoryDoc[] = [];
      for (const d of snap.docs) {
        const result = KitchenMemorySchema.safeParse(d.data());
        if (result.success) {
          valid.push(result.data);
        } else {
          console.error(`[KitchenMemorySchema] Document ${d.id} failed validation`, result.error);
        }
      }
      onMemories(valid);
    },
    (err) => onError(classifyFirestoreError(err), err),
  );
}

/** Write a note. Keyed by `memory.id`; whole-document last-write-wins. */
export async function saveKitchenMemory(
  memory: KitchenMemoryDoc,
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, COLLECTION, memory.id), { ...memory });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

/**
 * Forget a note. A real delete, not a flag — Firestore is the master and there are
 * no tombstones in this codebase. Idempotent on an absent document, as Firestore's
 * own `deleteDoc` is: two people clearing the same note is not an error.
 */
export async function deleteKitchenMemory(id: string): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await deleteDoc(doc(db, COLLECTION, id));
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
