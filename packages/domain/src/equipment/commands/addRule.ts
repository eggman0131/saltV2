import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { EquipmentManifest } from '../entities/EquipmentManifest.js';

export interface AddRuleInput {
  readonly equipmentId: string;
  readonly rule: string;
  readonly now: string;
}

export function addRule(
  manifest: EquipmentManifest,
  input: AddRuleInput,
): ReadResult<EquipmentManifest, DomainError> {
  const rule = input.rule.trim();
  if (!rule) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_RULE });
  }
  const item = manifest.items.find((i) => i.id === input.equipmentId);
  if (!item) {
    return failure({ kind: 'NotFound', resource: 'equipment', id: input.equipmentId });
  }
  return success({
    ...manifest,
    items: manifest.items.map((i) =>
      i.id === input.equipmentId ? { ...i, rules: [...i.rules, rule], updatedAt: input.now } : i,
    ),
  });
}
