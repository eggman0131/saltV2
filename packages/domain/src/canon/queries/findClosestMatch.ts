import type { CanonItem } from '../entities/CanonItem.js';
import { normaliseName } from './normaliseName.js';

// Pure: matches a raw ingredient name against the supplied canon list.
// Exact match on the canonical name or any synonym, after normalisation.
// Brute-force is intentional — the canon set is small (<500 items).
export function findClosestMatch(items: readonly CanonItem[], rawName: string): CanonItem | null {
  const target = normaliseName(rawName);
  if (!target) return null;
  for (const item of items) {
    if (normaliseName(item.name) === target) return item;
    for (const syn of item.synonyms) {
      if (normaliseName(syn) === target) return item;
    }
  }
  return null;
}
