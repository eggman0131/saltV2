import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { EquipmentManifest } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import {
  EquipmentManifestSchema,
  EQUIPMENT_MANIFEST_COLLECTION,
  EQUIPMENT_MANIFEST_DOC_ID,
} from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';
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

export async function saveEquipmentManifest(
  manifest: EquipmentManifest,
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, EQUIPMENT_MANIFEST_COLLECTION, EQUIPMENT_MANIFEST_DOC_ID), {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      items: [...manifest.items],
    });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
