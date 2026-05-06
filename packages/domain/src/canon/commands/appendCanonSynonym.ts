import type { CanonItem } from '../entities/CanonItem.js';
import { normaliseName } from '../queries/normaliseName.js';

export function appendCanonSynonym(item: CanonItem, rawName: string): CanonItem {
  const normalised = normaliseName(rawName);
  if (!normalised || item.synonyms.includes(normalised)) return item;
  return { ...item, synonyms: [...item.synonyms, normalised], needs_approval: true };
}
