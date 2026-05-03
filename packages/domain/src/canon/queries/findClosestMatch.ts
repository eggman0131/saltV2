import type { CanonItem } from '../entities/CanonItem.js';
import type { MatchCandidate } from '../entities/MatchCandidate.js';
import type { CandidateLog } from '../entities/MatchLogEntry.js';
import { MATCH_THRESHOLDS } from './matchThresholds.js';
import { normaliseName } from './normaliseName.js';
import { tokenMatch } from './tokenMatch.js';
import { synonymMatch } from './synonymMatch.js';
import { stringSimilarity } from './stringSimilarity.js';
import type { MatchLogBuilder } from '../commands/buildMatchLog.js';

// Runs stages 1–4 in order; returns the first candidate that meets its stop
// threshold. Returns null when no stage finds a confident match (stages 5–6
// are handled by the pipeline orchestrator).
export function findClosestMatch(
  items: readonly CanonItem[],
  rawName: string,
  log?: MatchLogBuilder,
): MatchCandidate | null {
  const target = normaliseName(rawName);
  if (!target) return null;

  // Stage 1: exact normalised name match
  {
    const t0 = Date.now();
    const exactMatches: CandidateLog[] = [];
    let winner: CanonItem | null = null;
    for (const item of items) {
      if (normaliseName(item.name) === target) {
        exactMatches.push({ itemId: item.id, itemName: item.name, score: 1.0 });
        if (winner === null) winner = item;
      }
    }
    const top = exactMatches.slice(0, 5);
    log?.addStage({
      stage: 1,
      stageName: 'exact_name',
      threshold: MATCH_THRESHOLDS.stage1Stop,
      passed: winner !== null,
      consideredCount: items.length,
      durationMs: Date.now() - t0,
      topCandidates: top,
      bestScore: winner !== null ? 1.0 : null,
      gap: winner !== null ? 0.0 : null,
      skipReason: null,
    });
    if (winner !== null) return { item: winner, confidence: 1.0, stage: 1 };
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
    log?.addStage({
      stage: 2,
      stageName: 'token_overlap',
      threshold: MATCH_THRESHOLDS.stage2Stop,
      passed,
      consideredCount: items.length,
      durationMs: Date.now() - t0,
      topCandidates: top.map((c) => ({ itemId: c.item.id, itemName: c.item.name, score: c.score })),
      bestScore,
      gap: bestScore - MATCH_THRESHOLDS.stage2Stop,
      skipReason: null,
    });
    if (passed && best !== undefined) return { item: best.item, confidence: best.score, stage: 2 };
  }

  // Stage 3: synonym exact match
  {
    const t0 = Date.now();
    const synMatches = synonymMatch(items, target);
    const winner = synMatches[0] ?? null;
    log?.addStage({
      stage: 3,
      stageName: 'synonym',
      threshold: MATCH_THRESHOLDS.stage3Stop,
      passed: winner !== null,
      consideredCount: items.length,
      durationMs: Date.now() - t0,
      topCandidates: synMatches
        .slice(0, 5)
        .map((i) => ({ itemId: i.id, itemName: i.name, score: 1.0 })),
      bestScore: winner !== null ? 1.0 : null,
      gap: winner !== null ? 0.0 : null,
      skipReason: null,
    });
    if (winner !== null) return { item: winner, confidence: 1.0, stage: 3 };
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
    log?.addStage({
      stage: 4,
      stageName: 'string_similarity',
      threshold: MATCH_THRESHOLDS.stage4Stop,
      passed,
      consideredCount: items.length,
      durationMs: Date.now() - t0,
      topCandidates: top.map((c) => ({ itemId: c.item.id, itemName: c.item.name, score: c.score })),
      bestScore,
      gap: bestScore - MATCH_THRESHOLDS.stage4Stop,
      skipReason: null,
    });
    if (passed && best !== undefined) return { item: best.item, confidence: best.score, stage: 4 };
  }

  return null;
}
