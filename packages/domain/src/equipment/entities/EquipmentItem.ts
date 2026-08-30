import type { AccessoryDoc, EquipmentItemDoc } from '../../schemas/equipmentManifest.js';

// Schema-first (issue #417, carried here by issue #932): aliases of the
// inferred schema types, so the entities and the stored manifest cannot drift.

export type Accessory = AccessoryDoc;

// `updatedAt` is ISO-8601, stamped by domain commands on mutation.
export type EquipmentItem = EquipmentItemDoc;
