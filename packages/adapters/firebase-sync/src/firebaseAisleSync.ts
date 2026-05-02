import { getFirestore, doc, getDoc, runTransaction } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { failure, success, conflict } from '@salt/shared-types';
import type {
  Aisle,
  AisleSyncTransportPort,
  AisleSyncBatch,
  AislesDocument,
  ErrorReportingPort,
} from '@salt/domain';
import { classifyFirestoreError } from './firestoreErrors.js';
import { createFirebaseManifestListener } from './firebaseManifestListener.js';

const AISLES_COLLECTION = 'canonData';
const AISLES_DOC_ID = 'aisles';

function fromDoc(data: Record<string, unknown>): AislesDocument {
  const aisles = Array.isArray(data['aisles'])
    ? (data['aisles'] as Aisle[]).map((a) => ({ id: a.id, name: a.name, order: a.order }))
    : [];
  return {
    schemaVersion: 1,
    revision: typeof data['revision'] === 'number' ? data['revision'] : 0,
    updatedAt: typeof data['updatedAt'] === 'string' ? data['updatedAt'] : '',
    aisles,
  };
}

export function createFirebaseAisleSyncTransportAdapter(
  errors: ErrorReportingPort | null = null,
): AisleSyncTransportPort {
  return {
    async pull(sinceCursor) {
      try {
        const db = getFirestore(getApp());
        const snap = await getDoc(doc(db, AISLES_COLLECTION, AISLES_DOC_ID));
        if (!snap.exists()) return success(null);
        const document = fromDoc(snap.data() as Record<string, unknown>);
        if (document.revision <= (sinceCursor ?? 0)) return success(null);
        return success({
          aisles: document.aisles,
          cursor: document.revision,
        } satisfies AisleSyncBatch);
      } catch (err) {
        errors?.report(err);
        return failure(classifyFirestoreError(err));
      }
    },

    async push(aisles, baseRevision) {
      try {
        const db = getFirestore(getApp());
        const aislesRef = doc(db, AISLES_COLLECTION, AISLES_DOC_ID);

        const txResult = await runTransaction(db, async (tx) => {
          const remote = await tx.get(aislesRef);
          if (remote.exists()) {
            const remoteDoc = fromDoc(remote.data() as Record<string, unknown>);
            if (remoteDoc.revision !== baseRevision) {
              return { isConflict: true as const, remoteDoc };
            }
          }
          // Write optimistic revision; CF trigger stamps the authoritative value.
          const newDoc: AislesDocument = {
            schemaVersion: 1,
            revision: baseRevision + 1,
            updatedAt: new Date().toISOString(),
            aisles: [...aisles],
          };
          tx.set(aislesRef, newDoc);
          return { isConflict: false as const, newDoc };
        });

        if (txResult.isConflict) {
          const localDoc: AislesDocument = {
            schemaVersion: 1,
            revision: baseRevision,
            updatedAt: '',
            aisles: [...aisles],
          };
          return conflict(localDoc, txResult.remoteDoc);
        }
        return success(txResult.newDoc);
      } catch (err) {
        errors?.report(err);
        return failure(classifyFirestoreError(err));
      }
    },

    subscribe(onTick, onError) {
      return createFirebaseManifestListener(onTick, onError);
    },
  };
}
