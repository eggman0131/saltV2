import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { Member } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { MemberSchema } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

const COLLECTION = 'members';

// Realtime roster subscription (issue #155). List read: skip + log any corrupt
// doc and deliver the valid subset, so one bad member can't blank the screen.
// Stream-level errors still surface via onError.
export function subscribeMembers(
  onMembers: (members: Member[]) => void,
  onError: (err: DomainError) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    collection(db, COLLECTION),
    (snap) => {
      const valid: Member[] = [];
      for (const d of snap.docs) {
        const result = MemberSchema.safeParse(d.data());
        if (result.success) {
          valid.push(result.data as Member);
        } else {
          console.error(`[MemberSchema] Document ${d.id} failed validation`, result.error);
        }
      }
      onMembers(valid);
    },
    (err) => onError(classifyFirestoreError(err)),
  );
}

// Create-or-update a member, keyed by its normalised-email id. Returns Failure
// rather than throwing so the operational error crosses the boundary cleanly.
export async function upsertMember(member: Member): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, COLLECTION, member.id), { ...member });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

export async function deleteMember(id: string): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await deleteDoc(doc(db, COLLECTION, id));
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
