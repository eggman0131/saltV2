import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { EquipmentManifest } from '../entities/EquipmentManifest.js';
import { updateEquipmentItem } from './updateEquipmentItem.js';

export interface RenameEquipmentInput {
  readonly id: string;
  readonly name: string;
  readonly now: string;
}

export function renameEquipment(
  manifest: EquipmentManifest,
  input: RenameEquipmentInput,
): ReadResult<EquipmentManifest, DomainError> {
  return updateEquipmentItem(manifest, input.id, input.now, (item) => {
    const name = input.name.trim();
    if (!name) {
      return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_EQUIPMENT_NAME });
    }
    return success({ ...item, name });
  });
}
