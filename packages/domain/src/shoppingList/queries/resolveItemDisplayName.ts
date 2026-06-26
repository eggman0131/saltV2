import type { ShoppingListItem } from '../entities/ShoppingListItem.js';
import { parseShoppingListEntry } from './parseEntry.js';

// The label a single shopping-list row displays by: the user's (or recipe's)
// wording with the amount / unit / context the parser lifts out removed, so the
// row reads as the item itself ("whole chicken") without the quantity that's
// already rendered separately, and without collapsing to the leaner canon name
// ("chicken"). Manual and recipe rows are labelled identically — recipe wording
// is clean by construction, so the same parse applies cleanly to both.
//
// Parsing at display time (rather than trusting `item.rawText` to have been
// rewritten) keeps the label correct before the async match trigger runs, and for
// the items it never rewrites — pending / failed / notes-bearing rows still carry
// the raw "2 whole chickens" in `rawText`, and stripping it here drops the leading
// "2" that's otherwise duplicated by the separate amount field.
//
// The combined aggregate row is the one place a canon name is shown instead; that
// lives in the page's `rowLabel`, not here. Pure and I/O-free — the caller applies
// presentation casing.
export function resolveItemDisplayName(item: ShoppingListItem): string {
  return parseShoppingListEntry(item.rawText).name;
}
