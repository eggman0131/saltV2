import type { ShoppingListItem } from '../entities/ShoppingListItem.js';
import { hasLiveCanonMatch } from '../../canon/index.js';

// Where a shopping-list row's display label comes from. The `text` is always the
// user/recipe-supplied `rawText` so a row reads as it was entered (minus the bits
// the parser lifts out into amount/unit/notes, which the row renders separately).
// `source` only signals whether a live canon match backs the row — `canon` rows
// still own the icon/thumbnail via the matched canon item — it no longer changes
// the text. The caller applies presentation casing.
export interface ItemDisplayName {
  readonly text: string;
  readonly source: 'canon' | 'raw';
}

// Resolve the label a shopping-list item should display by. The text is always
// `rawText` (the user's wording); a live canon match (matched / needs_approval,
// with the canon item still present) is reported via `source: 'canon'` so the
// caller can still source the icon from canon, but it does not rename the row.
// Pure — the caller supplies the set of live canon ids (same set fed to
// groupItemsByAisle, so display name and grouping never disagree).
export function resolveItemDisplayName(
  item: ShoppingListItem,
  liveCanonIds: ReadonlySet<string>,
): ItemDisplayName {
  const source = hasLiveCanonMatch(item, liveCanonIds) ? 'canon' : 'raw';
  return { text: item.rawText, source };
}
