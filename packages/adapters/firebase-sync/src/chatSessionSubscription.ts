import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { ChatSessionSchema } from '@salt/domain/schemas';
import type { ChatSessionDoc } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

// Chat session persistence (issue #206, Phase 1). One doc per session at
// chatSessions/{id}. Per-user scoped: every read/write is filtered by ownerUid.
// Messages are stored as an array in the session doc (not a subcollection).
// saveChatSession bumps expiresAt to now + 14 days on every write; a Firestore
// TTL policy on chatSessions.expiresAt handles server-side expiry (infra step).

const COLLECTION = 'chatSessions';
const TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function expiresAt(): string {
  return new Date(Date.now() + TTL_MS).toISOString();
}

export function subscribeChatSessions(
  ownerUid: string,
  onSessions: (sessions: ChatSessionDoc[]) => void,
  // rawError forwards the original Firestore error for the real stack alongside
  // the categorised DomainError. Optional + last-positional: backward-compatible.
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  const db = getFirestore(getApp());
  const q = query(collection(db, COLLECTION), where('ownerUid', '==', ownerUid));
  return onSnapshot(
    q,
    (snap) => {
      const valid: ChatSessionDoc[] = [];
      for (const d of snap.docs) {
        const result = ChatSessionSchema.safeParse(d.data());
        if (result.success) {
          valid.push(result.data);
        } else {
          console.error(`[ChatSessionSchema] Document ${d.id} failed validation`, result.error);
        }
      }
      onSessions(valid);
    },
    (err) => onError(classifyFirestoreError(err), err),
  );
}

export async function loadChatSession(
  id: string,
): Promise<ReadResult<ChatSessionDoc | null, DomainError>> {
  try {
    const db = getFirestore(getApp());
    const snap = await getDoc(doc(db, COLLECTION, id));
    if (!snap.exists()) return success(null);
    const result = ChatSessionSchema.safeParse(snap.data());
    if (!result.success) return failure({ kind: 'StorageError', reason: 'corruption' });
    return success(result.data);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

export async function saveChatSession(
  session: ChatSessionDoc,
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    const stamped: ChatSessionDoc = { ...session, expiresAt: expiresAt() };
    await setDoc(doc(db, COLLECTION, stamped.id), { ...stamped });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

export async function deleteChatSession(id: string): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await deleteDoc(doc(db, COLLECTION, id));
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
