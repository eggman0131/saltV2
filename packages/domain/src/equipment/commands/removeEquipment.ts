import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { EquipmentManifest } from '../entities/EquipmentManifest.js';

export interface RemoveEquipmentInput {
  readonly id: string;
}

export function removeEquipment(
  manifest: EquipmentManifest,
  input: RemoveEquipmentInput,
): ReadResult<EquipmentManifest, DomainError> {
  const exists = manifest.items.some((item) => item.id === input.id);
  if (!exists) {
    return failure({ kind: 'NotFound', resource: 'equipment', id: input.id });
  }
  return success({ ...manifest, items: manifest.items.filter((item) => item.id !== input.id) });
}
