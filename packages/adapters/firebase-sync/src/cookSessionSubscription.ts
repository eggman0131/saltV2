import { getFirestore, doc, setDoc, deleteDoc, getDoc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { CookSessionSchema } from '@salt/domain/schemas';
import type { CookSessionDoc } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

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
  const db = getFirestore(getApp());
  return onSnapshot(
    doc(db, COLLECTION, sessionId),
    (snap) => {
      if (!snap.exists()) {
        onSession(null);
        return;
      }
      const result = CookSessionSchema.safeParse(snap.data());
      if (!result.success) {
        console.error(`[CookSessionSchema] Document ${snap.id} failed validation`, result.error);
        onSession(null);
        return;
      }
      onSession(result.data);
    },
    (err) => onError(classifyFirestoreError(err), err),
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
