import type { EquipmentItem } from './EquipmentItem.js';

// Wire shape of the equipmentManifest/current Firestore document.
// updatedAt is stamped client-side by saveEquipmentManifest (firebase-sync).
export interface EquipmentManifest {
  readonly schemaVersion: 1;
  readonly updatedAt: string; // ISO-8601
  readonly items: readonly EquipmentItem[];
}
