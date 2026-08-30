import type { EquipmentManifestDoc } from '../../schemas/equipmentManifest.js';

// Wire shape of the equipmentManifest/current Firestore document.
// updatedAt is stamped client-side by saveEquipmentManifest (firebase-sync).
// Schema-first (issue #932).
export type EquipmentManifest = EquipmentManifestDoc;
