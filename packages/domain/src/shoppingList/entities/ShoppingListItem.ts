import type { SourceRef } from './SourceRef.js';

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
