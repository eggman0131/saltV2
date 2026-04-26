import { ErrorCode } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';

export interface CreateCanonItemInput {
  id: string;
  name: string;
  synonyms?: readonly string[];
  aisle?: string | null;
}

export function createCanonItem(input: CreateCanonItemInput): CanonItem {
  const name = input.name.trim();
  if (!name) {
    throw new Error(ErrorCode.INVALID_CANON_NAME);
  }
  return {
    id: input.id,
    name,
    synonyms: (input.synonyms ?? []).map((s) => s.trim()).filter((s) => s.length > 0),
    aisle: input.aisle ?? null,
  };
}
