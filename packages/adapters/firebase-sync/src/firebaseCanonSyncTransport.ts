import {
  getFirestore,
  collection,
  doc,
  query,
  where,
  orderBy,
  getDocs,
  runTransaction,
} from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { failure, success, conflict } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type {
  CanonItem,
  CanonSyncTransportPort,
  SyncBatch,
  SyncPending,
  ErrorReportingPort,
} from '@salt/domain';
import { classifyFirestoreError } from './firestoreErrors.js';
import { createFirebaseManifestListener } from './firebaseManifestListener.js';

const COLLECTION = 'canonItems';
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 10_000;

function toDoc(item: CanonItem) {
  return { ...item };
}

function fromDoc(data: Record<string, unknown>): CanonItem {
  return {
    id: data['id'] as string,
    schemaVersion: 2,
    name: data['name'] as string,
    synonyms: Array.isArray(data['synonyms']) ? (data['synonyms'] as string[]) : [],
    aisleId: typeof data['aisleId'] === 'string' ? data['aisleId'] : null,
    thumbnail: typeof data['thumbnail'] === 'string' ? data['thumbnail'] : null,
    embedding: Array.isArray(data['embedding']) ? (data['embedding'] as number[]) : null,
    needs_approval: typeof data['needs_approval'] === 'boolean' ? data['needs_approval'] : true,
    updatedAt: typeof data['updatedAt'] === 'string' ? data['updatedAt'] : '',
    revision: typeof data['revision'] === 'number' ? data['revision'] : 0,
    deletedAt: typeof data['deletedAt'] === 'string' ? data['deletedAt'] : null,
  };
}

function isRetryable(err: unknown): boolean {
  const { kind } = classifyFirestoreError(err);
  return kind === 'NetworkError' || kind === 'SyncError';
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err) || attempt >= MAX_RETRIES) throw err;
      const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
}

export function createFirebaseCanonSyncTransportAdapter(
  errors: ErrorReportingPort | null = null,
): CanonSyncTransportPort {
  const pendingState: {
    initialSync: boolean;
    pull: boolean;
    push: boolean;
    manifestRefresh: boolean;
  } = {
    initialSync: false,
    pull: false,
    push: false,
    manifestRefresh: false,
  };

  return {
    get pending(): SyncPending {
      return pendingState;
    },

    async pull(sinceCursor) {
      pendingState.pull = true;
      try {
        const db = getFirestore(getApp());
        const q = query(
          collection(db, COLLECTION),
          where('revision', '>', sinceCursor ?? 0),
          orderBy('revision'),
        );
        const snap = await withRetry(() => getDocs(q));
        const upserted = snap.docs.map((d) => fromDoc(d.data() as Record<string, unknown>));
        // Items are ordered by revision asc, so last item holds the max revision.
        const cursor =
          upserted.length > 0 ? upserted[upserted.length - 1]!.revision : (sinceCursor ?? 0);
        return success({ upserted, deleted: [], cursor } satisfies SyncBatch);
      } catch (err) {
        errors?.report(err);
        return failure(classifyFirestoreError(err));
      } finally {
        pendingState.pull = false;
      }
    },

    async push(item) {
      pendingState.push = true;
      try {
        const db = getFirestore(getApp());
        const itemRef = doc(db, COLLECTION, item.id);

        const txResult = await withRetry(() =>
          runTransaction(db, async (tx) => {
            const remote = await tx.get(itemRef);
            if (remote.exists()) {
              const remoteData = fromDoc(remote.data() as Record<string, unknown>);
              if (remoteData.revision !== item.revision) {
                return { isConflict: true as const, remoteData };
              }
            }
            // Write optimistic revision; CF trigger stamps the authoritative value.
            tx.set(itemRef, { ...toDoc(item), revision: item.revision + 1 });
            return { isConflict: false as const };
          }),
        );

        if (txResult.isConflict) {
          return conflict(item, txResult.remoteData);
        }
        return success(item);
      } catch (err) {
        errors?.report(err);
        return failure(classifyFirestoreError(err));
      } finally {
        pendingState.push = false;
      }
    },

    subscribe(onTick, onError) {
      return createFirebaseManifestListener(onTick, onError);
    },
  };
}
