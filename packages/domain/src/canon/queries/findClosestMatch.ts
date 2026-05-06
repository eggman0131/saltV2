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
      return { kind: 'match', candidate: { item: winners[0]!, confidence: 1.0, stage: 1 } };
    }
    if (winners.length > 1) {
      return {
        kind: 'ambiguous',
        candidates: winners.map((item) => ({
          item,
          confidence: 1.0,
          stage: 1 as MatchCandidate['stage'],
        })),
      };
    }
  }

  // Stage 2: token overlap — score all items, take top 5
  {
    const t0 = Date.now();
    const scored = items.map((item) => ({
      item,
      score: tokenMatch(target, normaliseName(item.name)),
    }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 5);
    const best = top[0];
    const bestScore = best?.score ?? 0;
    const passed = bestScore >= MATCH_THRESHOLDS.stage2Stop;
    const secondScore = top[1]?.score ?? 0;
    const gap = passed ? bestScore - secondScore : bestScore - MATCH_THRESHOLDS.stage2Stop;
    log?.addStage({
      stage: 2,
      stageName: 'token_overlap',
      threshold: MATCH_THRESHOLDS.stage2Stop,
      passed,
      consideredCount: items.length,
      durationMs: Date.now() - t0,
      topCandidates: top.map((c) => ({ itemId: c.item.id, itemName: c.item.name, score: c.score })),
      bestScore,
      gap,
      skipReason: null,
    });
    if (passed && best !== undefined) {
      if (bestScore - secondScore >= ambiguityGap) {
        return { kind: 'match', candidate: { item: best.item, confidence: best.score, stage: 2 } };
      }
      const nearTies = scored.filter((c) => c.score >= MATCH_THRESHOLDS.stage2Stop);
      return {
        kind: 'ambiguous',
        candidates: nearTies.map((c) => ({
          item: c.item,
          confidence: c.score,
          stage: 2 as MatchCandidate['stage'],
        })),
      };
    }
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
      return { kind: 'match', candidate: { item: synMatches[0]!, confidence: 1.0, stage: 3 } };
    }
    if (synMatches.length > 1) {
      return {
        kind: 'ambiguous',
        candidates: synMatches.map((item) => ({
          item,
          confidence: 1.0,
          stage: 3 as MatchCandidate['stage'],
        })),
      };
    }
  }

  // Stage 4: Levenshtein string similarity — score all items, take top 5
  {
    const t0 = Date.now();
    const scored = items.map((item) => ({
      item,
      score: stringSimilarity(target, normaliseName(item.name)),
    }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 5);
    const best = top[0];
    const bestScore = best?.score ?? 0;
    const passed = bestScore >= MATCH_THRESHOLDS.stage4Stop;
    const secondScore = top[1]?.score ?? 0;
    const gap = passed ? bestScore - secondScore : bestScore - MATCH_THRESHOLDS.stage4Stop;
    log?.addStage({
      stage: 4,
      stageName: 'string_similarity',
      threshold: MATCH_THRESHOLDS.stage4Stop,
      passed,
      consideredCount: items.length,
      durationMs: Date.now() - t0,
      topCandidates: top.map((c) => ({ itemId: c.item.id, itemName: c.item.name, score: c.score })),
      bestScore,
      gap,
      skipReason: null,
    });
    if (passed && best !== undefined) {
      if (bestScore - secondScore >= ambiguityGap) {
        return { kind: 'match', candidate: { item: best.item, confidence: best.score, stage: 4 } };
      }
      const nearTies = scored.filter((c) => c.score >= MATCH_THRESHOLDS.stage4Stop);
      return {
        kind: 'ambiguous',
        candidates: nearTies.map((c) => ({
          item: c.item,
          confidence: c.score,
          stage: 4 as MatchCandidate['stage'],
        })),
      };
    }
  }

  return { kind: 'none' };
}
