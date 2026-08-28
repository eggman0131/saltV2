import type { CanonItem } from '../entities/CanonItem.js';
import type { MatchCandidate } from '../entities/MatchCandidate.js';
import type { CandidateLog } from '../entities/MatchLogEntry.js';
import { MATCH_THRESHOLDS } from './matchThresholds.js';
import { normaliseName } from './normaliseName.js';
import { tokenMatch } from './tokenMatch.js';
import { synonymMatch } from './synonymMatch.js';
import { stringSimilarity } from './stringSimilarity.js';
import type { MatchLogBuilder } from '../commands/buildMatchLog.js';

export type FindClosestMatchResult =
  | { readonly kind: 'match'; readonly candidate: MatchCandidate }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly MatchCandidate[] }
  | { readonly kind: 'none' };

// Runs stages 1–4 in order. Returns:
//   'match'     — one candidate clearly above its stop threshold with gap ≥ ambiguityGap
//   'ambiguous' — candidates above the stop threshold but too close to auto-pick
//   'none'      — no stage found a confident match (stages 5–6 handled by the orchestrator)
export function findClosestMatch(
  items: readonly CanonItem[],
  rawName: string,
  log?: MatchLogBuilder,
): FindClosestMatchResult {
  const target = normaliseName(rawName);
  if (!target) return { kind: 'none' };

  const { ambiguityGap } = MATCH_THRESHOLDS;

  // Stage 1: exact normalised name match
  {
    const t0 = Date.now();
    const exactMatches: CandidateLog[] = [];
    const winners: CanonItem[] = [];
    for (const item of items) {
      if (normaliseName(item.name) === target) {
        exactMatches.push({ itemId: item.id, itemName: item.name, score: 1.0 });
        winners.push(item);
      }
    }
    const top = exactMatches.slice(0, 5);
    const passed = winners.length > 0;
    // gap between best (1.0) and second (also 1.0 if tie, else 0)
    const gap = winners.length === 1 ? 1.0 : winners.length > 1 ? 0.0 : null;
    log?.addStage({
      stage: 1,
      stageName: 'exact_name',
      threshold: MATCH_THRESHOLDS.stage1Stop,
      passed,
      consideredCount: items.length,
      durationMs: Date.now() - t0,
      topCandidates: top,
      bestScore: passed ? 1.0 : null,
      gap,
      skipReason: null,
    });
    if (winners.length === 1) {
      return {
        kind: 'match',
        candidate: { item: winners[0]!, confidence: 1.0, stage: 1, supportedStages: [1] },
      };
    }
    if (winners.length > 1) {
      return {
        kind: 'ambiguous',
        candidates: winners.map((item) => ({
          item,
          confidence: 1.0,
          stage: 1 as MatchCandidate['stage'],
          supportedStages: [1] as MatchCandidate['supportedStages'],
        })),
      };
    }
  }

  // Stage 2: token overlap — score all items, take top 5
  {
    const result = runScoredStage({
      items,
      target,
      ambiguityGap,
      log,
      stage: 2,
      stageName: 'token_overlap',
      scorer: tokenMatch,
      stop: MATCH_THRESHOLDS.stage2Stop,
    });
    if (result) return result;
  }

  // Stage 3: synonym exact match
  {
    const t0 = Date.now();
    const synMatches = synonymMatch(items, target);
    const passed = synMatches.length > 0;
    const gap = synMatches.length === 1 ? 1.0 : synMatches.length > 1 ? 0.0 : null;
    log?.addStage({
      stage: 3,
      stageName: 'synonym',
      threshold: MATCH_THRESHOLDS.stage3Stop,
      passed,
      consideredCount: items.length,
      durationMs: Date.now() - t0,
      topCandidates: synMatches
        .slice(0, 5)
        .map((i) => ({ itemId: i.id, itemName: i.name, score: 1.0 })),
      bestScore: passed ? 1.0 : null,
      gap,
      skipReason: null,
    });
    if (synMatches.length === 1) {
      return {
        kind: 'match',
        candidate: { item: synMatches[0]!, confidence: 1.0, stage: 3, supportedStages: [3] },
      };
    }
    if (synMatches.length > 1) {
      return {
        kind: 'ambiguous',
        candidates: synMatches.map((item) => ({
          item,
          confidence: 1.0,
          stage: 3 as MatchCandidate['stage'],
          supportedStages: [3] as MatchCandidate['supportedStages'],
        })),
      };
    }
  }

  // Stage 4: Levenshtein string similarity — score all items, take top 5
  {
    const result = runScoredStage({
      items,
      target,
      ambiguityGap,
      log,
      stage: 4,
      stageName: 'string_similarity',
      scorer: stringSimilarity,
      stop: MATCH_THRESHOLDS.stage4Stop,
    });
    if (result) return result;
  }

  return { kind: 'none' };
}

/**
 * Stages 2 and 4 are one procedure run with a different scorer: score every item,
 * sort, log the top 5, then either match on a clear gap or hand back the near-ties
 * as ambiguous. The two copies differed in exactly four things — the scorer, the
 * stage ordinal, the stage name and the stop threshold — so they are the four
 * parameters here.
 *
 * Written once because the duplication's only real cost was divergence: a future
 * threshold or gap change would land in one half and not the other, silently. The
 * structural-parity test in `findClosestMatch.test.ts` is what keeps that true
 * from here, since a helper can always be inlined again by a later edit.
 *
 * Returns `null` for "this stage did not decide", so the caller falls through to
 * the next one. Note that a stage log is emitted either way — falling through is
 * not the same as being skipped, and `passed: false` records the attempt.
 *
 * Stages 1 and 3 are deliberately NOT folded in. They are set-membership shaped
 * (a winner list, not a score ranking) and use a different `gap` convention —
 * 1.0 for a single winner, 0.0 for a tie, null for a miss — documented in
 * docs/matching-pipeline.md. Forcing them through this shape would mean
 * parameterising the gap arithmetic too, at which point the "one procedure" claim
 * stops being true.
 */
function runScoredStage(params: {
  readonly items: readonly CanonItem[];
  readonly target: string;
  readonly ambiguityGap: number;
  readonly log: MatchLogBuilder | undefined;
  readonly stage: 2 | 4;
  readonly stageName: 'token_overlap' | 'string_similarity';
  readonly scorer: (normA: string, normB: string) => number;
  readonly stop: number;
}): FindClosestMatchResult | null {
  const { items, target, ambiguityGap, log, stage, stageName, scorer, stop } = params;
  const t0 = Date.now();
  const scored = items.map((item) => ({
    item,
    score: scorer(target, normaliseName(item.name)),
  }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 5);
  const best = top[0];
  const bestScore = best?.score ?? 0;
  const passed = bestScore >= stop;
  const secondScore = top[1]?.score ?? 0;
  const gap = passed ? bestScore - secondScore : bestScore - stop;
  log?.addStage({
    stage,
    stageName,
    threshold: stop,
    passed,
    consideredCount: items.length,
    durationMs: Date.now() - t0,
    topCandidates: top.map((c) => ({ itemId: c.item.id, itemName: c.item.name, score: c.score })),
    bestScore,
    gap,
    skipReason: null,
  });
  if (!passed || best === undefined) return null;
  if (bestScore - secondScore >= ambiguityGap) {
    return {
      kind: 'match',
      candidate: { item: best.item, confidence: best.score, stage, supportedStages: [stage] },
    };
  }
  const nearTies = scored.filter((c) => c.score >= stop);
  return {
    kind: 'ambiguous',
    candidates: nearTies.map((c) => ({
      item: c.item,
      confidence: c.score,
      stage,
      supportedStages: [stage],
    })),
  };
}
