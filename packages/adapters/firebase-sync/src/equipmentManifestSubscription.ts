import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { EquipmentManifest, EquipmentItem, Accessory } from '@salt/domain';
import type { DomainError } from '@salt/shared-types';
import { classifyFirestoreError } from './firestoreErrors.js';

const EQUIPMENT_MANIFEST_COLLECTION = 'equipmentManifest';
const EQUIPMENT_MANIFEST_DOC_ID = 'current';

function fromDoc(data: Record<string, unknown>): EquipmentManifest {
  const items: EquipmentItem[] = Array.isArray(data['items'])
    ? (data['items'] as Array<Record<string, unknown>>).map((item) => {
        const accessories: Accessory[] = Array.isArray(item['accessories'])
          ? (item['accessories'] as Array<Record<string, unknown>>).map((acc) => ({
              id: String(acc['id'] ?? ''),
              name: String(acc['name'] ?? ''),
              owned: Boolean(acc['owned']),
              included: Boolean(acc['included']),
            }))
          : [];
        const rules: string[] = Array.isArray(item['rules'])
          ? (item['rules'] as unknown[]).map(String)
          : [];
        return {
          id: String(item['id'] ?? ''),
          schemaVersion: 1 as const,
          name: String(item['name'] ?? ''),
          accessories,
          rules,
          updatedAt: String(item['updatedAt'] ?? ''),
        };
      })
    : [];

  return {
    schemaVersion: 1,
    updatedAt: String(data['updatedAt'] ?? ''),
    items,
  };
}

export function subscribeEquipmentManifest(
  onManifest: (manifest: EquipmentManifest | null) => void,
  onError: (err: DomainError) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    doc(db, EQUIPMENT_MANIFEST_COLLECTION, EQUIPMENT_MANIFEST_DOC_ID),
    (snap) => {
      onManifest(snap.exists() ? fromDoc(snap.data() as Record<string, unknown>) : null);
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
