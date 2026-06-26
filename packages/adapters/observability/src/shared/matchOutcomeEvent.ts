import type { MatchLogEntry } from '@salt/domain';

// PostHog event name for the canon match/create outcome. One event per
// addCanonItem call, emitted from the fast path (this package) and — in a later
// phase — from the CF path, so the name and property shape MUST stay identical
// across both. This module is the single source of truth for that wire schema.
export const CANON_MATCH_EVENT = 'canon.match' as const;

export type CanonMatchPath = 'fast' | 'cf';

// Slim, analytics-friendly projection of a MatchLogEntry: what the user typed →
// what canon chose (id + name) → which stage decided it → the winning
// confidence, plus the path tag and final decision. Deliberately omits the
// verbose per-stage candidate dumps and arbitration prompt/response that the
// LD span carried (those are debugging-grade, not analytics-grade). Property
// names are snake_cased to match PostHog's event-property conventions and the
// existing `canon.*` LD attribute namespace.
export interface CanonMatchEventProps {
  // What was typed, and its normalised form (only when it differs).
  readonly canon_input: string;
  readonly canon_normalized?: string;
  // What it chose.
  readonly canon_decision: MatchLogEntry['finalDecision'];
  readonly canon_result_id?: string;
  readonly canon_result?: string;
  // Which stage won (the last stage that passed), and the confidence there.
  // Both absent when nothing matched (e.g. a fresh 'created' with no passing
  // stage) so dashboards can distinguish "no stage won" from "stage 0 won".
  readonly canon_winning_stage?: number;
  readonly canon_winning_stage_name?: string;
  readonly canon_confidence?: number;
  // Context.
  readonly canon_path: CanonMatchPath;
  readonly canon_correlation_id: string;
  readonly canon_input_count: number;
  readonly canon_total_duration_ms: number;
}

// Mirrors matchLogToAttributes' ×100 / 2dp scaling so a confidence reads as a
// 0–100 percentage in both the LD span and the PostHog event.
function scaleScore(score: number): number {
  return parseFloat((score * 100).toFixed(2));
}

// Build the slim outcome event properties from a full MatchLogEntry. Pure and
// runtime-neutral: no PostHog, no LD, no I/O — just a projection. Both the
// fast-path adapter (this phase) and the CF-path adapter (later) call this so
// the canon.match wire schema cannot drift between the two emission sites.
export function toCanonMatchEvent(
  entry: MatchLogEntry,
  path: CanonMatchPath,
): CanonMatchEventProps {
  // The winning stage is the last stage that passed — that's the one whose
  // candidate became the result. Its bestScore is the decision confidence.
  const winning = [...entry.stages].reverse().find((s) => s.passed);

  const props: CanonMatchEventProps = {
    canon_input: entry.rawInput,
    canon_decision: entry.finalDecision,
    canon_path: path,
    canon_correlation_id: entry.id,
    canon_input_count: entry.inputItemCount,
    canon_total_duration_ms: entry.totalDurationMs,
    ...(entry.normalizedInput !== entry.rawInput && {
      canon_normalized: entry.normalizedInput,
    }),
    ...(entry.finalItemId !== null && { canon_result_id: entry.finalItemId }),
    ...(entry.finalItemName !== null && { canon_result: entry.finalItemName }),
    ...(winning && {
      canon_winning_stage: winning.stage,
      canon_winning_stage_name: winning.stageName,
    }),
    ...(winning &&
      winning.bestScore !== null && {
        canon_confidence: scaleScore(winning.bestScore),
      }),
  };

  return props;
}
