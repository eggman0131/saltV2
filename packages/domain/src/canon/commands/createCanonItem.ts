import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult, ShoppingBehavior, CanonItemUnit } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';
import type { IdGenerator } from '../ports/IdGenerator.js';

export interface CreateCanonItemInput {
  readonly name: string;
  readonly synonyms?: readonly string[];
  readonly aisleId?: string | null;
  readonly needs_approval?: boolean;
  readonly shoppingBehavior?: ShoppingBehavior;
  readonly largeQuantityThreshold?: number;
  readonly unit?: CanonItemUnit;
  readonly reasoning?: string;
}

export function createCanonItem(
  input: CreateCanonItemInput,
  ids: IdGenerator,
): ReadResult<CanonItem, DomainError> {
  const name = input.name.trim();
  if (!name) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_CANON_NAME });
  }
  return success({
    id: ids.newCanonId(),
    schemaVersion: 5,
    name,
    synonyms: (input.synonyms ?? []).map((s) => s.trim()).filter((s) => s.length > 0),
    aisleId: input.aisleId ?? null,
    thumbnail: null,
    embedding: null,
    needs_approval: input.needs_approval ?? true,
    shoppingBehavior: input.shoppingBehavior ?? 'needed',
    ...(input.largeQuantityThreshold !== undefined
      ? { largeQuantityThreshold: input.largeQuantityThreshold }
      : {}),
    ...(input.unit !== undefined ? { unit: input.unit } : {}),
    ...(input.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
    updatedAt: '',
  });
}
