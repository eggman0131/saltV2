import type { CanonItem } from '../entities/CanonItem.js';
import { normaliseName } from './normaliseName.js';

// Stage 3 — returns items whose synonyms contain an exact normalised match.
export function synonymMatch(
  items: readonly CanonItem[],
  normalisedTarget: string,
): readonly CanonItem[] {
  return items.filter((item) =>
    item.synonyms.some((syn) => normaliseName(syn) === normalisedTarget),
  );
}
