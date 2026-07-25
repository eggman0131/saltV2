import { getFirestore, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import type { PushSubscriptionDoc } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

// Web-push subscription persistence (cook-timer notifications, issue #544). One
// document per device at pushSubscriptions/{uid}_{deviceHash}. Deterministic id,
// so a single whole-document write (LWW). Owner-scoped like cookSessions;
// firestore.rules gate every read/write on `ownerUid`. The subscription's
// existence on-device is read from the browser `PushManager`, not Firestore, so
// there is no subscribe/read here — only write (subscribe) and delete
// (unsubscribe). Writes never throw for operational errors: they cross the
// boundary as Failure<DomainError> (Rule 10). Must not import @salt/observability
// (Rule 4) — the caller in web-pwa owns any reporting.

const COLLECTION = 'pushSubscriptions';

// Keyed by subscription.id (`${uid}_${deviceHash}`). Whole-document last-write-wins.
export async function savePushSubscription(
  subscription: PushSubscriptionDoc,
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, COLLECTION, subscription.id), { ...subscription });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

export async function deletePushSubscription(id: string): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await deleteDoc(doc(db, COLLECTION, id));
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
