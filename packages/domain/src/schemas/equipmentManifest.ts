import { z } from 'zod';

// Canonical Firestore location of the single shared equipment manifest. Both the
// client store (firebase-sync) and the server-side chef flow (cloud-functions)
// read this doc; sharing the identifiers here is the one source of truth so the
// two sides can't drift (which silently broke the chef's equipment context once).
export const EQUIPMENT_MANIFEST_COLLECTION = 'equipmentManifest';
export const EQUIPMENT_MANIFEST_DOC_ID = 'current';

export const AccessorySchema = z.object({
  id: z.string(),
  name: z.string(),
  owned: z.boolean(),
  included: z.boolean(),
});

export const EquipmentItemSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  name: z.string(),
  accessories: z.array(AccessorySchema).default([]),
  rules: z.array(z.string()).default([]),
  updatedAt: z.string(),
});

export const EquipmentManifestSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string(),
  items: z.array(EquipmentItemSchema).default([]),
});

export type AccessoryDoc = z.infer<typeof AccessorySchema>;
export type EquipmentItemDoc = z.infer<typeof EquipmentItemSchema>;
export type EquipmentManifestDoc = z.infer<typeof EquipmentManifestSchema>;
