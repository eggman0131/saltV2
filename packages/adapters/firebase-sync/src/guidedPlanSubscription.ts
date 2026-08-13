import { getFirestore, doc, setDoc, getDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { GuidedPlanSchema, type GuidedPlanDoc } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

// Guided-plan persistence (issue #751, Phase 1). One document per recipe at
// `guidedPlans/{recipeId}` — a DETERMINISTIC id, so this is a SINGLE-DOCUMENT
// subscription (`onSnapshot(doc(...))`), not a collection query. Family-shared
// like the recipe it describes: no `ownerUid`, and firestore.rules gates on
// "signed in" alone. Whole-document last-write-wins on `updatedAt`.
//
// Read contract — and this is where it deliberately DIVERGES from
// cookSessionSubscription, which is otherwise the closest template. A corrupt
// cook session is disposable transient state, so that adapter logs it and reports
// "no session" so the page can bootstrap a fresh one. A guided plan is not
// disposable: a human wrote or reviewed every line of it. Handing the editor a
// null would present it as "no plan yet" behind a Write-the-plan button, and the
// first thing the user would do is overwrite the document that is still there.
// So an invalid doc surfaces as a StorageError/corruption through `onError` and
// the caller keeps whatever it was holding.
//
// Writes never throw for operational errors: they cross the boundary as
// Failure<DomainError> (Rule 10). This adapter must not import
// @salt/observability (Rule 4).

const COLLECTION = 'guidedPlans';

/**
 * Subscribe to ONE recipe's guided plan. Emits the parsed plan, or `null` when
 * the document genuinely does not exist (no plan has been written yet — the
 * editor's empty state).
 *
 * A document that fails validation is NOT reported as absent: it goes to
 * `onError` as a corruption Failure (see the header), which leaves the caller's
 * current value alone rather than inviting an overwrite of reviewed work.
 */
export function subscribeGuidedPlan(
  recipeId: string,
  onPlan: (plan: GuidedPlanDoc | null) => void,
  // rawError forwards the original Firestore error for the real stack alongside
  // the categorised DomainError. Optional + last-positional: backward-compatible.
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    doc(db, COLLECTION, recipeId),
    (snap) => {
      if (!snap.exists()) {
        onPlan(null);
        return;
      }
      const result = GuidedPlanSchema.safeParse(snap.data());
      if (!result.success) {
        console.error(`[GuidedPlanSchema] Document ${snap.id} failed validation`, result.error);
        onError({ kind: 'StorageError', reason: 'corruption' });
        return;
      }
      onPlan(result.data);
    },
    (err) => onError(classifyFirestoreError(err), err),
  );
}

/** One-shot read of a recipe's plan. Absent → `null`; corrupt → a Failure. */
export async function loadGuidedPlan(
  recipeId: string,
): Promise<ReadResult<GuidedPlanDoc | null, DomainError>> {
  try {
    const db = getFirestore(getApp());
    const snap = await getDoc(doc(db, COLLECTION, recipeId));
    if (!snap.exists()) return success(null);
    const result = GuidedPlanSchema.safeParse(snap.data());
    if (!result.success) return failure({ kind: 'StorageError', reason: 'corruption' });
    return success(result.data);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

/**
 * Write a plan. Keyed by `plan.id` (which IS the recipe id); whole-document
 * last-write-wins, so a re-run replaces the previous plan outright rather than
 * merging into it — which is exactly what "get a fresh one" means.
 */
export async function saveGuidedPlan(plan: GuidedPlanDoc): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, COLLECTION, plan.id), { ...plan });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

/**
 * Delete a recipe's guided plan. A real delete, not a flag — Firestore is the
 * master and there are no tombstones in this codebase.
 *
 * Deleting a plan that was never written is a SUCCESS, not an error: Firestore's
 * `deleteDoc` is idempotent on an absent document, and the caller (issue #784's
 * refresh, which invalidates a plan whose step ids it just re-minted) has no
 * business knowing whether one existed. It would otherwise have to read before
 * writing purely to decide which result to report.
 */
export async function deleteGuidedPlan(recipeId: string): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await deleteDoc(doc(db, COLLECTION, recipeId));
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
