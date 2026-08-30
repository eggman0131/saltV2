import type { CanonItem } from './CanonItem.js';

// HAND-WRITTEN ON PURPOSE (issue #932). In-memory state of the matching
// pipeline — built, ranked and discarded within a single match. It is never
// persisted and never parsed, so it has no schema counterpart to derive from.

export type MatchStage = 1 | 2 | 3 | 4 | 5 | 6;

export interface MatchCandidate {
  readonly item: CanonItem;
  /** The highest score any signal gave this candidate. */
  readonly confidence: number;
  /** The single signal that produced `confidence` — the TOP-scoring one. */
  readonly stage: MatchStage;
  /**
   * Every signal that supports this candidate, not just the top-scoring one.
   *
   * `stage` answers "which signal scored highest"; this answers "which signals
   * back this at all". Two policy sites ask those two different questions and one
   * field cannot serve both (issue #937): the lone-candidate fast bind
   * (`matchOrCreate.ts`) asks whether token overlap is the STRONGEST support and
   * rightly reads `stage`; the degraded AI-failure fallback asks whether edit
   * distance is the ONLY support, and reading `stage` there silently skipped
   * candidates that token overlap or embedding also backed, merely because their
   * Levenshtein score happened to come out higher — minting a new canon item where
   * the pipeline promised to bind an existing one.
   *
   * REQUIRED, deliberately: an optional field would let a future construction site
   * omit provenance and be read as "supported only by `stage`", which is the exact
   * conflation this exists to end. Ascending, deduplicated, and never empty — it
   * always contains `stage`.
   */
  readonly supportedStages: readonly MatchStage[];
}
