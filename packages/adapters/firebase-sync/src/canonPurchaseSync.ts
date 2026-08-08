import { getFirestore, doc, getDoc, setDoc, increment } from 'firebase/firestore';
import type { FieldValue } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { CanonPurchaseCountsSchema, type CanonPurchaseCountsDoc } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

// Purchase counts (issue #726). `canonData/purchaseCounts` — the household's
// tick-off history, family-shared like every other list in the app.
//
// `increment` is a Firebase SDK sentinel, so Rule 2 confines it to this package;
// it must never leak into web-pwa or domain. It is also the only correct
// primitive here: a server-applied transform queues in `persistentLocalCache`
// and lands on reconnect, whereas a read-modify-write would silently lose ticks.
// This data is created in supermarkets on bad signal.

const COLLECTION = 'canonData';
const DOC_ID = 'purchaseCounts';

/**
 * Record a tick-off gesture: one write carrying a field transform per canon id.
 *
 * A 30-item bulk tick-off is a SINGLE write, not 30 — per-item writes to one
 * shared document would hit Firestore's ~1 write/sec sustained per-document
 * limit head-on. Ids repeat when two rows resolve to the same canon item; that
 * is a genuine double purchase and accumulates into one `increment(n)` rather
 * than being de-duplicated away.
 *
 * `setDoc(…, { merge: true })` and NOT `updateDoc`: the latter rejects when the
 * document does not yet exist, which is precisely the first ever tick-off.
 * Field transforms are supported under merge.
 */
export async function recordCanonPurchases(
  canonIds: readonly string[],
): Promise<ReadResult<void, DomainError>> {
  // Nothing to count — every ticked row was unmatched. Not a write, not an error.
  if (canonIds.length === 0) return success(undefined);
  try {
    const db = getFirestore(getApp());
    const now = new Date().toISOString();
    const perId = new Map<string, number>();
    for (const id of canonIds) perId.set(id, (perId.get(id) ?? 0) + 1);

    const counts: Record<string, FieldValue> = {};
    const lastAt: Record<string, string> = {};
    for (const [id, n] of perId) {
      counts[id] = increment(n);
      lastAt[id] = now;
    }
    await setDoc(doc(db, COLLECTION, DOC_ID), { counts, lastAt }, { merge: true });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

/**
 * Read the whole counts document once. A SINGLE-DOCUMENT read, so a parse
 * failure returns `Failure<DomainError>` per the Zod convention — not the
 * skip-and-log contract that list reads use.
 *
 * An absent document is the day-one state, not an error: it parses as empty
 * maps and the consumer falls back to alphabetical ordering.
 */
export async function loadCanonPurchaseCounts(): Promise<
  ReadResult<CanonPurchaseCountsDoc, DomainError>
> {
  try {
    const db = getFirestore(getApp());
    const snap = await getDoc(doc(db, COLLECTION, DOC_ID));
    const parsed = CanonPurchaseCountsSchema.safeParse(snap.exists() ? snap.data() : {});
    if (!parsed.success) return failure({ kind: 'StorageError', reason: 'corruption' });
    return success(parsed.data);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
