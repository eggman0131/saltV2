import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { EquipmentManifest } from '../entities/EquipmentManifest.js';

export interface RemoveAccessoryInput {
  readonly equipmentId: string;
  readonly accessoryId: string;
  readonly now: string;
}

export function removeAccessory(
  manifest: EquipmentManifest,
  input: RemoveAccessoryInput,
): ReadResult<EquipmentManifest, DomainError> {
  const item = manifest.items.find((i) => i.id === input.equipmentId);
  if (!item) {
    return failure({ kind: 'NotFound', resource: 'equipment', id: input.equipmentId });
  }
  const accessoryExists = item.accessories.some((a) => a.id === input.accessoryId);
  if (!accessoryExists) {
    return failure({ kind: 'ValidationError', code: ErrorCode.EQUIPMENT_ACCESSORY_NOT_FOUND });
  }
  return success({
    ...manifest,
    items: manifest.items.map((i) =>
      i.id === input.equipmentId
        ? {
            ...i,
            accessories: i.accessories.filter((a) => a.id !== input.accessoryId),
            updatedAt: input.now,
          }
        : i,
    ),
  });
}
