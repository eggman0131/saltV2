import { getFirestore, doc, setDoc, deleteDoc, getDoc, where } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { ChatSessionSchema } from '@salt/domain/schemas';
import type { ChatSessionDoc } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';
import { subscribeCollection } from './subscribeCollection.js';

// Chat session persistence (issue #206, Phase 1). One doc per session at
// chatSessions/{id}. Per-user scoped: every read/write is filtered by ownerUid.
// Messages are stored as an array in the session doc (not a subcollection).
// saveChatSession bumps expiresAt on every write, and every chat now gets a
// finite one — see the two constants below for how long, and for the reason no
// sweep has ever acted on either of them.

const COLLECTION = 'chatSessions';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A general kitchen chat: a fortnight, unchanged since #206. */
const TTL_MS = 14 * DAY_MS;

// A chat attached to a recipe outlives a general one. It no longer outlives
// everything (issues #696, #939).
//
// The reason it lives longer is unchanged and still right: the recipe page lists
// every conversation you have had about a dish, including the one it was written
// from, and a fortnightly sweep would empty that list for exactly the recipes you
// have lived with longest. What was wrong was the WIDTH of the exemption. It was
// written as `9999-12-31`, and because a chat claims its recipe as soon as it
// produces one, the majority of sessions end up in the never-expiring class — 52
// of staging's 76 carry a `recipeId`. A collection whose dominant class is
// immortal has no bound at all, and it is read whole at auth, on every cold
// start, holding the fattest documents in the app.
//
// EIGHTEEN MONTHS, because the interval this has to survive is a year. A dish you
// cook once a Christmas is precisely the "recipe you have lived with longest" the
// exemption exists for, and a 365-day window is a coin flip on whether the sweep
// beats the next cook. Eighteen clears an annual cycle with six months to spare,
// and any turn of the conversation restamps it from today.
const RECIPE_TTL_MS = 540 * DAY_MS;

// ─── NOTHING ENFORCES EITHER OF THESE YET ────────────────────────────────────
//
// `expiresAt` is written below as an ISO-8601 STRING, and a Firestore TTL policy
// only expires a document whose TTL field holds a `Timestamp` — a string, number
// or absent field is skipped in silence. So no policy on dev, staging or prod has
// ever swept a chat, whatever any console says: 42 of staging's 76 documents sit
// past their own recorded expiry and are all still there.
//
// The constants above are therefore the POLICY, not the mechanism. Making them
// bite means writing a `Timestamp`, and that is a shape change on live per-user
// documents with a real trap behind it: `ChatSessionSchema.expiresAt` is
// `z.string()` and the realtime subscription SKIPS a document that fails
// validation, so a naive swap makes every existing chat vanish from the list
// rather than error. It also arms the sweep against those 42 at once. Its own
// issue, and its own decision. (`timerDeliveries` has the identical defect with
// an epoch integer — see docs/939-investigation.md §C3-013.)

function expiresAt(session: ChatSessionDoc): string {
  const ttl = session.recipeId !== null ? RECIPE_TTL_MS : TTL_MS;
  return new Date(Date.now() + ttl).toISOString();
}

export function subscribeChatSessions(
  ownerUid: string,
  onSessions: (sessions: ChatSessionDoc[]) => void,
  // rawError forwards the original Firestore error for the real stack alongside
  // the categorised DomainError. Optional + last-positional: backward-compatible.
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  return subscribeCollection(
    {
      path: [COLLECTION],
      // Per-user scoped: the rule allows a read when the document's ownerUid is
      // the caller's, and every document this filter returns satisfies it.
      constraints: [where('ownerUid', '==', ownerUid)],
      schema: ChatSessionSchema,
      label: 'ChatSessionSchema',
      project: (session) => session,
      forwardsRawError: true,
    },
    onSessions,
    onError,
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
