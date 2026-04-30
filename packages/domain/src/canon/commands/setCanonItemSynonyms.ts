import { success } from '@salt/shared-types';
import type { DomainError, Result } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';

export function setCanonItemSynonyms(
  item: CanonItem,
  synonyms: readonly string[],
): Result<CanonItem, DomainError> {
  const cleaned = [...new Set(synonyms.map((s) => s.trim()).filter((s) => s.length > 0))];
  return success({ ...item, synonyms: cleaned });
}
