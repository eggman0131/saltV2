import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { EquipmentManifest } from '@salt/domain';
import type { DomainError } from '@salt/shared-types';
import {
  EquipmentManifestSchema,
  EQUIPMENT_MANIFEST_COLLECTION,
  EQUIPMENT_MANIFEST_DOC_ID,
} from '@salt/domain/schemas';
import { subscribeDocument } from './subscribeDocument.js';

export function subscribeEquipmentManifest(
  onManifest: (manifest: EquipmentManifest | null) => void,
  onError: (err: DomainError) => void,
): () => void {
  return subscribeDocument(
    {
      path: [EQUIPMENT_MANIFEST_COLLECTION, EQUIPMENT_MANIFEST_DOC_ID],
      schema: EquipmentManifestSchema,
      label: 'EquipmentManifestSchema',
      onCorrupt: 'error',
      logsRejection: false,
      forwardsRawError: false,
    },
    onManifest,
    onError,
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
