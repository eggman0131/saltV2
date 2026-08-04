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
// saveChatSession bumps expiresAt on every write; a Firestore TTL policy on
// chatSessions.expiresAt handles server-side expiry (infra step). See expiresAt()
// below for the one session that is written so it never expires.

const COLLECTION = 'chatSessions';
const TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// A chat attached to a recipe has the same lifetime as the recipe (issue #696).
// The recipe page lists every conversation you have had about a dish, including
// the one it was written from — a list that a fortnightly sweep would empty for
// exactly the recipes you have lived with longest.
//
// This is deliberately done through `expiresAt` rather than by narrowing the TTL
// policy: the policy is per-project console infra on dev, staging and prod, and a
// document whose expiry is a millennium away is simply never swept. So general
// chats keep tidying themselves away after a fortnight, recipe chats keep, and no
// console anywhere had to change.
const NEVER_EXPIRES = '9999-12-31T23:59:59.999Z';

function expiresAt(session: ChatSessionDoc): string {
  if (session.recipeId !== null) return NEVER_EXPIRES;
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
    const stamped: ChatSessionDoc = { ...session, expiresAt: expiresAt(session) };
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
