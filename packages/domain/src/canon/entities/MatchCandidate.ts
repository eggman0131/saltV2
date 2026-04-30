import type { CanonItem } from './CanonItem.js';

export type MatchStage = 1 | 2 | 3 | 4 | 5 | 6;

export interface MatchCandidate {
  readonly item: CanonItem;
  readonly confidence: number;
  readonly stage: MatchStage;
}
