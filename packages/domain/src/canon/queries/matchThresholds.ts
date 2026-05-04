// Stop threshold: confidence at or above this level ends the search at the current stage.
// aiThreshold: candidates at or above this level are forwarded to stage 6 when reached (Phase 4+).
// ambiguityGap: a deterministic stage (1–4) only auto-matches when (best − second) ≥ this value.
//   When best ≥ stop but the gap is smaller, the near-tie candidates are forwarded to AI
//   arbitration instead of auto-binding to the highest scorer.
export const MATCH_THRESHOLDS = {
  stage1Stop: 1.0, // exact normalised name match
  stage2Stop: 0.8, // 80% token coverage
  stage3Stop: 1.0, // exact synonym match
  stage4Stop: 0.85, // ~85% Levenshtein similarity (handles typos)
  stage5Stop: 0.75, // ~75% cosine similarity — Phase 2
  aiThreshold: 0.6, // minimum confidence to forward a candidate to AI — Phase 4
  ambiguityGap: 0.05, // minimum gap between best and second-best to auto-match
} as const;
