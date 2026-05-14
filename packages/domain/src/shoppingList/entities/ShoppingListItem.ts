import type { SourceRef } from './SourceRef.js';

export type MatchState = 'pending' | 'matched' | 'needs_approval' | 'failed';

export interface ShoppingListItem {
  readonly id: string;
  readonly rawText: string;
  readonly notes: string;
  readonly sources: readonly SourceRef[];
  readonly canonId: string | null;
  readonly matchState: MatchState;
  readonly checked: boolean;
  readonly schemaVersion: 1;
  readonly createdAt: string; // ISO-8601
  readonly updatedAt: string; // ISO-8601
}
