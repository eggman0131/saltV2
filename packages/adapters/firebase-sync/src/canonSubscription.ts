import { getFirestore, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { CanonItem } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { CanonItemSchema } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';
import { subscribeCollection } from './subscribeCollection.js';

const COLLECTION = 'canonItems';

export function subscribeCanonItems(
  onItems: (items: CanonItem[]) => void,
  // rawError forwards the original Firestore error alongside the categorised
  // DomainError so the service report site can send the REAL stack to PostHog
  // (the synthetic DomainError carries none). Optional + last-positional, so
  // existing two-arg callers stay source-compatible.
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  return subscribeCollection(
    {
      path: [COLLECTION],
      schema: CanonItemSchema,
      label: 'CanonItemSchema',
      // The client never uses embeddings — they're server-only since #410. Drop
      // any inline vector still on an un-migrated doc so the in-memory canon
      // store stays lean and a client-side edit can't write one back (see
      // upsertCanonItem). The only per-subscription transform in the package,
      // and the reason `project` exists on the descriptor at all: a shared parse
      // loop without one would have dropped it silently.
      project: (item) => ({ ...item, embedding: null }) as CanonItem,
      forwardsRawError: true,
    },
    onItems,
    onError,
  );
}

export async function upsertCanonItem(item: CanonItem): Promise<void> {
  const db = getFirestore(getApp());
  // Never write embeddings from the client (#410): vectors are server-only, in
  // the canonEmbeddings collection. Strip it so a client edit can't reintroduce a
  // vector inline; the CF embedding branch backfills canonEmbeddings on the write.
  const { embedding: _embedding, ...rest } = item;
  await setDoc(doc(db, COLLECTION, item.id), { ...rest });
}

export async function deleteCanonItem(id: string): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await deleteDoc(doc(db, COLLECTION, id));
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
