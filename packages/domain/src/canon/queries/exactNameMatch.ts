import type { CanonItem } from '../entities/CanonItem.js';
import { normaliseName } from './normaliseName.js';

// Stage 1 — returns items whose own name is an exact normalised match.
export function exactNameMatch(
  items: readonly CanonItem[],
  normalisedTarget: string,
): readonly CanonItem[] {
  return items.filter((item) => normaliseName(item.name) === normalisedTarget);
}
