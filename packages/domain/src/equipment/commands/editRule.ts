import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { EquipmentManifest } from '../entities/EquipmentManifest.js';

export interface EditRuleInput {
  readonly equipmentId: string;
  readonly ruleIndex: number;
  readonly rule: string;
  readonly now: string;
}

export function editRule(
  manifest: EquipmentManifest,
  input: EditRuleInput,
): ReadResult<EquipmentManifest, DomainError> {
  const rule = input.rule.trim();
  if (!rule) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_RULE });
  }
  const item = manifest.items.find((i) => i.id === input.equipmentId);
  if (!item) {
    return failure({ kind: 'NotFound', resource: 'equipment', id: input.equipmentId });
  }
  if (input.ruleIndex < 0 || input.ruleIndex >= item.rules.length) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_RULE });
  }
  const rules = item.rules.map((r, idx) => (idx === input.ruleIndex ? rule : r));
  return success({
    ...manifest,
    items: manifest.items.map((i) =>
      i.id === input.equipmentId ? { ...i, rules, updatedAt: input.now } : i,
    ),
  });
}
