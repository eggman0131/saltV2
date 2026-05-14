import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { EquipmentManifest } from '../entities/EquipmentManifest.js';
import type { IdGenerator } from '../ports/IdGenerator.js';

export interface AddAccessoryInput {
  readonly equipmentId: string;
  readonly name: string;
  readonly owned: boolean;
  readonly included: boolean;
  readonly now: string;
}

export function addAccessory(
  manifest: EquipmentManifest,
  input: AddAccessoryInput,
  ids: IdGenerator,
): ReadResult<EquipmentManifest, DomainError> {
  const name = input.name.trim();
  if (!name) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_ACCESSORY_NAME });
  }
  const item = manifest.items.find((i) => i.id === input.equipmentId);
  if (!item) {
    return failure({ kind: 'NotFound', resource: 'equipment', id: input.equipmentId });
  }
  const newAccessory = {
    id: ids.newAccessoryId(),
    name,
    owned: input.owned,
    included: input.included,
  };
  return success({
    ...manifest,
    items: manifest.items.map((i) =>
      i.id === input.equipmentId
        ? { ...i, accessories: [...i.accessories, newAccessory], updatedAt: input.now }
        : i,
    ),
  });
}
