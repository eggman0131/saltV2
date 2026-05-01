import { getFirestore, collection, doc, getDocs, setDoc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { failure, success } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type {
  CanonItem,
  CanonSyncTransportPort,
  SyncBatch,
  SyncPending,
  ErrorReportingPort,
} from '@salt/domain';
import { classifyFirestoreError } from './firestoreErrors.js';

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
  const pendingState: SyncPending & { initialSync: boolean; pull: boolean; push: boolean } = {
    initialSync: false,
    pull: false,
    push: false,
  };

  return {
    get pending(): SyncPending {
      return pendingState;
    },

    async pull(_sinceCursor) {
      pendingState.pull = true;
      try {
        const db = getFirestore(getApp());
        const snap = await withRetry(() => getDocs(collection(db, COLLECTION)));
        const items = snap.docs.map((d) => fromDoc(d.data() as Record<string, unknown>));
        const cursor = new Date().toISOString();
        return success({ items, cursor });
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
        await withRetry(() => setDoc(doc(db, COLLECTION, item.id), toDoc(item)));
        return success(item);
      } catch (err) {
        errors?.report(err);
        return failure(classifyFirestoreError(err));
      } finally {
        pendingState.push = false;
      }
    },

    subscribe(onChange: (batch: SyncBatch) => void, onError: (err: DomainError) => void) {
      const db = getFirestore(getApp());
      return onSnapshot(
        collection(db, COLLECTION),
        (snapshot) => {
          const upserted: CanonItem[] = [];
          const deleted: string[] = [];
          for (const change of snapshot.docChanges()) {
            if (change.type === 'added' || change.type === 'modified') {
              upserted.push(fromDoc(change.doc.data() as Record<string, unknown>));
            } else {
              deleted.push(change.doc.id);
            }
          }
          onChange({ upserted, deleted });
        },
        (err) => {
          errors?.report(err);
          onError(classifyFirestoreError(err));
        },
      );
    },
  };
}
