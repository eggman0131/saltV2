import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { EquipmentManifest } from '../entities/EquipmentManifest.js';
import { updateEquipmentItem } from './updateEquipmentItem.js';

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
  return updateEquipmentItem(manifest, input.equipmentId, input.now, (item) => {
    const rule = input.rule.trim();
    if (!rule) {
      return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_RULE });
    }
    if (input.ruleIndex < 0 || input.ruleIndex >= item.rules.length) {
      return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_RULE });
    }
    return success({
      ...item,
      rules: item.rules.map((r, idx) => (idx === input.ruleIndex ? rule : r)),
    });
  });
}
