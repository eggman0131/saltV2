import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { EquipmentManifest } from '../entities/EquipmentManifest.js';
import { updateEquipmentItem } from './updateEquipmentItem.js';

export interface RemoveAccessoryInput {
  readonly equipmentId: string;
  readonly accessoryId: string;
  readonly now: string;
}

export function removeAccessory(
  manifest: EquipmentManifest,
  input: RemoveAccessoryInput,
): ReadResult<EquipmentManifest, DomainError> {
  return updateEquipmentItem(manifest, input.equipmentId, input.now, (item) => {
    if (!item.accessories.some((a) => a.id === input.accessoryId)) {
      return failure({ kind: 'ValidationError', code: ErrorCode.EQUIPMENT_ACCESSORY_NOT_FOUND });
    }
    return success({
      ...item,
      accessories: item.accessories.filter((a) => a.id !== input.accessoryId),
    });
  });
}
