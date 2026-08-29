import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { KitchenTimersSchema } from '@salt/domain/schemas';
import type { KitchenTimersDoc } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';
import { subscribeDocument } from './subscribeDocument.js';

// Standalone kitchen timers (issue #842). ONE document per user at
// `kitchenTimers/{uid}` — the id IS the uid, so this is a SINGLE-DOCUMENT
// subscription rather than a collection query, and the security rule proves
// ownership from the path without ever reading the document.
//
// Read contract: an ABSENT document is "no timers" — it does not exist until the
// member starts their first timer, so absence is the ordinary state on a fresh
// account rather than an error. A document the schema REFUSES is a different
// thing and is answered differently since #928 Phase 2: logged, then
// `StorageError`/`corruption` on `onError`, like every other single-document
// read. Answering it with `null` too made a corrupt document indistinguishable
// from the ordinary empty state, which is precisely the report the store needs
// and the one thing `null` cannot carry. Writes never throw for operational
// errors; they cross the boundary as Failure<DomainError> (Rule 10). This
// adapter must not import @salt/observability (Rule 4) — the caller reports.

const COLLECTION = 'kitchenTimers';

// Subscribe to MY kitchen timers. Emits the parsed document, or null when it
// does not exist; a document that fails its schema is a Failure on onError,
// never a null. See the header.
export function subscribeKitchenTimers(
  uid: string,
  onDoc: (doc: KitchenTimersDoc | null) => void,
  // rawError forwards the original Firestore error for the real stack alongside
  // the categorised DomainError, matching the other single-doc subscriptions.
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  return subscribeDocument(
    {
      path: [COLLECTION, uid],
      schema: KitchenTimersSchema,
      label: 'KitchenTimersSchema',
    },
    onDoc,
    onError,
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
