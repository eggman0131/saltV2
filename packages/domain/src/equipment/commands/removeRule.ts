import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { EquipmentManifest } from '../entities/EquipmentManifest.js';

export interface RemoveRuleInput {
  readonly equipmentId: string;
  readonly ruleIndex: number;
  readonly now: string;
}

export function removeRule(
  manifest: EquipmentManifest,
  input: RemoveRuleInput,
): ReadResult<EquipmentManifest, DomainError> {
  const item = manifest.items.find((i) => i.id === input.equipmentId);
  if (!item) {
    return failure({ kind: 'NotFound', resource: 'equipment', id: input.equipmentId });
  }
  if (input.ruleIndex < 0 || input.ruleIndex >= item.rules.length) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_RULE });
  }
  const rules = item.rules.filter((_, idx) => idx !== input.ruleIndex);
  return success({
    ...manifest,
    items: manifest.items.map((i) =>
      i.id === input.equipmentId ? { ...i, rules, updatedAt: input.now } : i,
    ),
  });
}
