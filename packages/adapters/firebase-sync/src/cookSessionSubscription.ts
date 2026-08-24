import {
  getFirestore,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  limit,
  orderBy,
  where,
} from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { CookSessionSchema } from '@salt/domain/schemas';
import type { CookSessionDoc } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';
import { subscribeCollection } from './subscribeCollection.js';
import { subscribeDocument } from './subscribeDocument.js';

// Cook session persistence (cooking mode, Phase 1). One document per user per
// recipe at cookSessions/{recipeId}_{uid}. The id is DETERMINISTIC, so this is a
// SINGLE-DOCUMENT subscription (`onSnapshot(doc(...))`) rather than a collection
// query — there is exactly one session per user per recipe. Per-user scoped like
// chatSessions: firestore.rules gate every read/write on `ownerUid`. Whole-document
// last-write-wins on `updatedAt`.
//
// Read contract: an invalid single doc is treated as "no session" (log + null),
// NOT a Failure — a corrupt cook session is disposable transient state, and the
// page will simply bootstrap a fresh one. Writes never throw for operational
// errors: they cross the boundary as Failure<DomainError> (Rule 10). This adapter
// must not import @salt/observability (Rule 4).

const COLLECTION = 'cookSessions';

// Subscribe to ONE cook session doc by its deterministic id. Emits the parsed
// session, or null when the doc is absent or fails validation (disposable state).
export function subscribeCookSession(
  sessionId: string,
  onSession: (session: CookSessionDoc | null) => void,
  // rawError forwards the original Firestore error for the real stack alongside
  // the categorised DomainError. Optional + last-positional: backward-compatible.
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  return subscribeDocument(
    {
      path: [COLLECTION, sessionId],
      schema: CookSessionSchema,
      label: 'CookSessionSchema',
      // Disposable transient state: a corrupt session is "no session", and the
      // page bootstraps a fresh one over it. See the header.
      onCorrupt: 'null',
      logsRejection: true,
      forwardsRawError: true,
    },
    onSession,
    onError,
  );
}

// How many of a member's open sessions to carry. The personal view shows ONE (the
// most recent); a few spare keeps the "most recent" honest if one is deleted on
// another device, without turning this into an unbounded read.
const MY_SESSIONS_LIMIT = 5;

// Subscribe to MY open cook sessions, newest first (issue #634). Unlike the
// single-doc subscription above, the caller here knows only who they are — the
// point is "am I mid-cook right now", asked without knowing which recipe.
//
// The `ownerUid` filter is what makes this readable: the existing rule allows a
// read when `resource.data.ownerUid == request.auth.uid`, and every document a
// constrained query returns satisfies it, so no firestore.rules change is needed.
// The where + orderBy pair does need the composite index in firestore.indexes.json.
//
// LIST read (Zod conventions): an invalid document is skipped and logged, and the
// valid subset is returned — one corrupt session must not blank the card. Stream
// errors surface via onError.
export function subscribeMyCookSessions(
  ownerUid: string,
  onSessions: (sessions: CookSessionDoc[]) => void,
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  return subscribeCollection(
    {
      path: [COLLECTION],
      // The where + orderBy pair needs the composite index in
      // firestore.indexes.json; see the header for why the filter is what makes
      // this readable at all.
      constraints: [
        where('ownerUid', '==', ownerUid),
        orderBy('updatedAt', 'desc'),
        limit(MY_SESSIONS_LIMIT),
      ],
      schema: CookSessionSchema,
      label: 'CookSessionSchema',
      project: (session) => session,
      forwardsRawError: true,
    },
    onSessions,
    onError,
  );
}

export async function loadCookSession(
  id: string,
): Promise<ReadResult<CookSessionDoc | null, DomainError>> {
  try {
    const db = getFirestore(getApp());
    const snap = await getDoc(doc(db, COLLECTION, id));
    if (!snap.exists()) return success(null);
    const result = CookSessionSchema.safeParse(snap.data());
    if (!result.success) return failure({ kind: 'StorageError', reason: 'corruption' });
    return success(result.data);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

// Keyed by session.id (deterministic). Whole-document last-write-wins.
export async function saveCookSession(
  session: CookSessionDoc,
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, COLLECTION, session.id), { ...session });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

export async function deleteCookSession(id: string): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await deleteDoc(doc(db, COLLECTION, id));
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
