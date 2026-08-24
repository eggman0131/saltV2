import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { EquipmentManifest } from '../entities/EquipmentManifest.js';
import { updateEquipmentItem } from './updateEquipmentItem.js';

export interface RemoveRuleInput {
  readonly equipmentId: string;
  readonly ruleIndex: number;
  readonly now: string;
}

export function removeRule(
  manifest: EquipmentManifest,
  input: RemoveRuleInput,
): ReadResult<EquipmentManifest, DomainError> {
  return updateEquipmentItem(manifest, input.equipmentId, input.now, (item) => {
    if (input.ruleIndex < 0 || input.ruleIndex >= item.rules.length) {
      return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_RULE });
    }
    return success({
      ...item,
      rules: item.rules.filter((_, idx) => idx !== input.ruleIndex),
    });
  });
}
