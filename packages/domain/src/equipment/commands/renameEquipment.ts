import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { EquipmentManifest } from '../entities/EquipmentManifest.js';

export interface RenameEquipmentInput {
  readonly id: string;
  readonly name: string;
  readonly now: string;
}

export function renameEquipment(
  manifest: EquipmentManifest,
  input: RenameEquipmentInput,
): ReadResult<EquipmentManifest, DomainError> {
  const name = input.name.trim();
  if (!name) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_EQUIPMENT_NAME });
  }
  const item = manifest.items.find((i) => i.id === input.id);
  if (!item) {
    return failure({ kind: 'NotFound', resource: 'equipment', id: input.id });
  }
  return success({
    ...manifest,
    items: manifest.items.map((i) =>
      i.id === input.id ? { ...i, name, updatedAt: input.now } : i,
    ),
  });
}
