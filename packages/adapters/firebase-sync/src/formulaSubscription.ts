import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { FormulaSchema, type Formula } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';
import { subscribeDocument } from './subscribeDocument.js';

// Formula persistence (issue #806, phase 1 of epic #778). One document per recipe
// at `formulas/{recipeId}` — a DETERMINISTIC id, so this is a SINGLE-DOCUMENT
// subscription (`onSnapshot(doc(...))`), not a collection query. Family-shared
// like the recipe it describes: no `ownerUid`, and firestore.rules gates on
// "signed in" alone. Whole-document last-write-wins.
//
// Modelled on guidedPlanSubscription, including its read contract and the reason
// for it: a formula is not disposable state. Someone sat down, decided which
// ingredients are the basis, typed grams for the eggs and declared what the
// recipe makes. Handing the screen a `null` for a document that failed validation
// would present it as "no formula yet", and the first thing the user would do is
// map it again over the top. So an invalid doc surfaces as a
// StorageError/corruption through `onError` and the caller keeps what it had.
//
// No `deleteFormula`: nothing in this phase removes a formula, and an unused
// delete on a family-shared document is a foot-gun waiting for a caller.
//
// Writes never throw for operational errors: they cross the boundary as
// Failure<DomainError> (Rule 10). This adapter must not import
// @salt/observability (Rule 4).

const COLLECTION = 'formulas';

/**
 * Subscribe to ONE recipe's formula. Emits the parsed formula, or `null` when the
 * document genuinely does not exist (nothing has been mapped yet — the screen's
 * first-visit state, where it derives a fresh guess from the recipe instead).
 *
 * A document that fails validation is NOT reported as absent: it goes to
 * `onError` as a corruption Failure (see the header).
 */
export function subscribeFormula(
  recipeId: string,
  onFormula: (formula: Formula | null) => void,
  // rawError forwards the original Firestore error for the real stack alongside
  // the categorised DomainError. Optional + last-positional: backward-compatible.
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  return subscribeDocument(
    {
      path: [COLLECTION, recipeId],
      schema: FormulaSchema,
      label: 'FormulaSchema',
    },
    onFormula,
    onError,
  );
}

/** One-shot read of a recipe's formula. Absent → `null`; corrupt → a Failure. */
export async function loadFormula(
  recipeId: string,
): Promise<ReadResult<Formula | null, DomainError>> {
  try {
    const db = getFirestore(getApp());
    const snap = await getDoc(doc(db, COLLECTION, recipeId));
    if (!snap.exists()) return success(null);
    const result = FormulaSchema.safeParse(snap.data());
    if (!result.success) return failure({ kind: 'StorageError', reason: 'corruption' });
    return success(result.data);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

/**
 * Write a formula. Keyed by `formula.recipeId`, which IS the doc id — the same
 * contract `ShoppingDaySchema.date` has with `shoppingDays/{YYYY-MM-DD}`.
 *
 * Whole-document last-write-wins, so a re-map replaces the previous formula
 * outright rather than merging into it. There is nothing to merge: the
 * percentages are one internally-consistent set derived from one basis, and half
 * of an old basis mixed into a new one is not a formula anybody wrote.
 */
export async function saveFormula(formula: Formula): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, COLLECTION, formula.recipeId), { ...formula });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
