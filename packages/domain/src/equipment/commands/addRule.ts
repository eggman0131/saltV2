import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { EquipmentManifest } from '../entities/EquipmentManifest.js';
import { updateEquipmentItem } from './updateEquipmentItem.js';

export interface AddRuleInput {
  readonly equipmentId: string;
  readonly rule: string;
  readonly now: string;
}

export function addRule(
  manifest: EquipmentManifest,
  input: AddRuleInput,
): ReadResult<EquipmentManifest, DomainError> {
  return updateEquipmentItem(manifest, input.equipmentId, input.now, (item) => {
    const rule = input.rule.trim();
    if (!rule) {
      return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_RULE });
    }
    return success({ ...item, rules: [...item.rules, rule] });
  });
}
