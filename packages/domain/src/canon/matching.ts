import type { CanonItem } from './entities/CanonItem.js';

export type MatchStage = 1 | 2 | 3 | 4 | 5 | 6;

export interface MatchCandidate {
  readonly item: CanonItem;
  readonly confidence: number;
  readonly stage: MatchStage;
}

// Stop threshold: confidence at or above this level ends the search at the current stage.
// aiThreshold: candidates at or above this level are forwarded to stage 6 when reached (Phase 4+).
export const MATCH_THRESHOLDS = {
  stage1Stop: 1.0, // exact normalised name match
  stage2Stop: 0.8, // 80% token coverage
  stage3Stop: 1.0, // exact synonym match
  stage4Stop: 0.85, // ~85% Levenshtein similarity (handles typos)
  stage5Stop: 0.75, // ~75% cosine similarity — Phase 2
  aiThreshold: 0.6, // minimum confidence to forward a candidate to AI — Phase 4
} as const;
