import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { EquipmentManifest } from '@salt/domain';
import type { DomainError } from '@salt/shared-types';
import { EquipmentManifestSchema } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

const EQUIPMENT_MANIFEST_COLLECTION = 'equipmentManifest';
const EQUIPMENT_MANIFEST_DOC_ID = 'current';

export function subscribeEquipmentManifest(
  onManifest: (manifest: EquipmentManifest | null) => void,
  onError: (err: DomainError) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    doc(db, EQUIPMENT_MANIFEST_COLLECTION, EQUIPMENT_MANIFEST_DOC_ID),
    (snap) => {
      if (!snap.exists()) {
        onManifest(null);
        return;
      }
      const result = EquipmentManifestSchema.safeParse(snap.data());
      if (!result.success) {
        onError({ kind: 'StorageError', reason: 'corruption' });
        return;
      }
      onManifest(result.data);
    },
    (err) => onError(classifyFirestoreError(err)),
  );
}

export async function saveEquipmentManifest(manifest: EquipmentManifest): Promise<void> {
  const db = getFirestore(getApp());
  await setDoc(doc(db, EQUIPMENT_MANIFEST_COLLECTION, EQUIPMENT_MANIFEST_DOC_ID), {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    items: [...manifest.items],
  });
}
