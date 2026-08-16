import { getFirestore, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { KitchenTimersSchema } from '@salt/domain/schemas';
import type { KitchenTimersDoc } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

// Standalone kitchen timers (issue #842). ONE document per user at
// `kitchenTimers/{uid}` — the id IS the uid, so this is a SINGLE-DOCUMENT
// subscription rather than a collection query, and the security rule proves
// ownership from the path without ever reading the document.
//
// Read contract: an absent OR invalid document is "no timers" (log + null), NOT
// a Failure — the same call the cook-session adapter makes, and for the same
// reason. The document does not exist until the member starts their first
// timer, so absence is the ordinary state on a fresh account rather than an
// error, and a corrupt one is disposable: the next start writes a fresh
// document over it. Writes never throw for operational errors; they cross the
// boundary as Failure<DomainError> (Rule 10). This adapter must not import
// @salt/observability (Rule 4).

const COLLECTION = 'kitchenTimers';

// Subscribe to MY kitchen timers. Emits the parsed document, or null when it is
// absent or fails validation.
export function subscribeKitchenTimers(
  uid: string,
  onDoc: (doc: KitchenTimersDoc | null) => void,
  // rawError forwards the original Firestore error for the real stack alongside
  // the categorised DomainError, matching the other single-doc subscriptions.
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    doc(db, COLLECTION, uid),
    (snap) => {
      if (!snap.exists()) {
        onDoc(null);
        return;
      }
      const result = KitchenTimersSchema.safeParse(snap.data());
      if (!result.success) {
        console.error(`[KitchenTimersSchema] Document ${snap.id} failed validation`, result.error);
        onDoc(null);
        return;
      }
      onDoc(result.data);
    },
    (err) => onError(classifyFirestoreError(err), err),
  );
}

// Keyed by `ownerUid`, which is also the document id — the rule requires the two
// to agree, so writing it anywhere else would simply be denied. Whole-document
// last-write-wins, as everywhere else in this codebase.
export async function saveKitchenTimers(
  timers: KitchenTimersDoc,
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, COLLECTION, timers.ownerUid), { ...timers });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
