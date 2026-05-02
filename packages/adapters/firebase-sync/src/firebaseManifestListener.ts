import { getFirestore, doc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { ManifestTick } from '@salt/domain';
import type { DomainError } from '@salt/shared-types';
import { classifyFirestoreError } from './firestoreErrors.js';

export function createFirebaseManifestListener(
  onTick: (tick: ManifestTick) => void,
  onError: (err: DomainError) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    doc(db, 'canonManifest', 'global'),
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as Record<string, unknown>;
      onTick({
        itemsRevision: typeof data['itemsRevision'] === 'number' ? data['itemsRevision'] : 0,
        aislesRevision: typeof data['aislesRevision'] === 'number' ? data['aislesRevision'] : 0,
      });
    },
    (err) => {
      onError(classifyFirestoreError(err));
    },
  );
}
