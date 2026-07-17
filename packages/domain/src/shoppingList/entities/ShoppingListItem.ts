import type { SourceRef } from './SourceRef.js';
import type { FormDemand } from '../../productForm/index.js';

export type MatchState = 'pending' | 'matched' | 'needs_approval' | 'failed';

export interface ShoppingListItem {
  readonly id: string;
  readonly rawText: string;
  readonly notes: string;
  readonly sources: readonly SourceRef[];
  readonly canonId: string | null;
  readonly matchState: MatchState;
  readonly amount?: number;
  readonly unit?: string;
  // Product-form demand breakdown (issue #501). Present only on a product-form
  // parent row (`unit === 'count'`): one entry per form of this parent the source
  // recipe demanded, each with that form's own UNROUNDED parent-count, so the
  // display aggregation can sum a form's demand across recipes and round once.
  // Absent on every other item and on items written before the field existed —
  // those degrade to the old collapsed-count behaviour. Mirrors
  // ShoppingListItemSchema (the read boundary casts the parsed doc to this type,
  // so the two must stay structurally compatible).
  readonly formDemand?: readonly FormDemand[];
  // The recipe's OWN wording for the ingredient line(s) behind a product-form row
  // (issue #528). Present only on a product-form parent row (alongside
  // `formDemand`): the row is labelled with the parent product ("Lime ×3"), so
  // these carry the lines that justified the count ("juice of 2 limes") through to
  // the list. Winner first, then source order, de-duplicated. DISPLAY ONLY — no
  // logic may branch on it. Absent on every other item and on items written before
  // the field existed; those degrade to today's cleaned-name sub-line. Mirrors
  // ShoppingListItemSchema (the read boundary casts the parsed doc to this type,
  // so the two must stay structurally compatible).
  readonly originalText?: readonly string[];
  readonly checked: boolean;
  // Flagged for verification at extraction time (issue #185): a recipe-add put
  // this on the list as a "check you need it" item (e.g. a near-threshold staple).
  // Distinct from `checked` — the shopper confirms-keep (clears the flag) or drops
  // it from the list screen. Always present; defaults false for manual adds.
  readonly needsCheck: boolean;
  readonly schemaVersion: 1;
  readonly createdAt: string; // ISO-8601
  readonly updatedAt: string; // ISO-8601
}
