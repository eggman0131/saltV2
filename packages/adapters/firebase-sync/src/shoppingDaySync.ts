import {
  getFirestore,
  collection,
  doc,
  documentId,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { ShoppingDaySchema, type ShoppingDayDoc } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

// Shop-day sync (issue #629). `shoppingDays/{YYYY-MM-DD}` — one tiny doc per shop
// trip, family-shared, keyed by the local calendar date.
//
// The date-keyed id is what keeps this cheap: the planner reads a whole week with
// a single RANGE QUERY OVER DOC IDS (no field index, no composite index, nothing
// to keep in sync), and clearing a shop day is a plain delete — there is no
// "cleared" state to represent and no stale value to filter out.

const COLLECTION = 'shoppingDays';

/**
 * Subscribe to every shop day whose date falls in `[startDate, endDate]`
 * inclusive — in practice one planner week.
 *
 * A LIST read, so it follows the list contract: an invalid doc is skipped and
 * logged, and the valid subset is delivered (one corrupt doc must not blank the
 * week). Stream-level errors still surface via `onError`.
 */
export function subscribeShoppingDaysInRange(
  startDate: string,
  endDate: string,
  onDays: (days: ShoppingDayDoc[]) => void,
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  const db = getFirestore(getApp());
  // documentId() range — the doc id IS the date, so this needs no field index.
  const q = query(
    collection(db, COLLECTION),
    where(documentId(), '>=', startDate),
    where(documentId(), '<=', endDate),
  );
  return onSnapshot(
    q,
    (snap) => {
      const valid: ShoppingDayDoc[] = [];
      for (const d of snap.docs) {
        const result = ShoppingDaySchema.safeParse(d.data());
        if (result.success) {
          valid.push(result.data);
        } else {
          console.error(`[ShoppingDaySchema] Document ${d.id} failed validation`, result.error);
        }
      }
      onDays(valid);
    },
    (err) => onError(classifyFirestoreError(err), err),
  );
}

/** Mark a day as the shop. Keyed by `day.date`; whole-document last-write-wins. */
export async function saveShoppingDay(day: ShoppingDayDoc): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, COLLECTION, day.date), { ...day });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

/** Clear a shop day. Deleting an absent date is a no-op, not an error. */
export async function deleteShoppingDay(date: string): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await deleteDoc(doc(db, COLLECTION, date));
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
