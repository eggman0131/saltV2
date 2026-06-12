import type { ShoppingListItem } from '../entities/ShoppingListItem.js';
import type { CanonInfo } from './groupItemsByAisle.js';
import { hasLiveCanonMatch } from '../../canon/index.js';

// Where a shopping-list row's display label comes from. `canon` rows are owned
// by the canon item's name (the canonical-naming contract); `raw` rows fall back
// to the user/recipe-supplied text because there is no live canon match to speak
// for them. The caller applies presentation casing per source (title vs sentence).
export interface ItemDisplayName {
  readonly text: string;
  readonly source: 'canon' | 'raw';
}

// Resolve the label a shopping-list item should display by. A live canon match
// (matched / needs_approval, with the canon item still present) is labelled by
// the canon `name`; everything else falls back to `rawText`. Pure — the caller
// supplies the canon snapshot and the set of live canon ids (same set fed to
// groupItemsByAisle, so display name and grouping never disagree).
export function resolveItemDisplayName(
  item: ShoppingListItem,
  canonMap: ReadonlyMap<string, CanonInfo>,
  liveCanonIds: ReadonlySet<string>,
): ItemDisplayName {
  if (hasLiveCanonMatch(item, liveCanonIds)) {
    return { text: canonMap.get(item.canonId!)!.name, source: 'canon' };
  }
  return { text: item.rawText, source: 'raw' };
}
