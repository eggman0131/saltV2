import { z } from 'zod';

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
