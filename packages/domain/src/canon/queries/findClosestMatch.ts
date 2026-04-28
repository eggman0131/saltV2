import type { CanonItem } from '../entities/CanonItem.js';
import type { MatchCandidate } from '../matching.js';
import { MATCH_THRESHOLDS } from '../matching.js';
import { normaliseName } from './normaliseName.js';
import { tokenMatch } from './tokenMatch.js';
import { synonymMatch } from './synonymMatch.js';
import { stringSimilarity } from './stringSimilarity.js';
import type { MatchLogBuilder } from '../logging/MatchLogBuilder.js';

// Runs stages 1–4 in order; returns the first candidate that meets its stop
// threshold. Returns null when no stage finds a confident match (stages 5–6
// are handled by the pipeline orchestrator in Phase 4+).
export function findClosestMatch(
  items: readonly CanonItem[],
  rawName: string,
  log?: MatchLogBuilder,
): MatchCandidate | null {
  const target = normaliseName(rawName);
  if (!target) return null;

  // Stage 1: exact normalised name match
  for (const item of items) {
    if (normaliseName(item.name) === target) {
      log?.addStage({
        stage: 1,
        stageName: 'exact_name',
        threshold: MATCH_THRESHOLDS.stage1Stop,
        passed: true,
        candidates: [{ itemId: item.id, score: 1.0 }],
      });
      return { item, confidence: 1.0, stage: 1 };
    }
  }
  log?.addStage({
    stage: 1,
    stageName: 'exact_name',
    threshold: MATCH_THRESHOLDS.stage1Stop,
    passed: false,
    candidates: [],
  });

  // Stage 2: token overlap
  for (const item of items) {
    const score = tokenMatch(target, normaliseName(item.name));
    if (score >= MATCH_THRESHOLDS.stage2Stop) {
      log?.addStage({
        stage: 2,
        stageName: 'token_overlap',
        threshold: MATCH_THRESHOLDS.stage2Stop,
        passed: true,
        candidates: [{ itemId: item.id, score }],
      });
      return { item, confidence: score, stage: 2 };
    }
  }
  log?.addStage({
    stage: 2,
    stageName: 'token_overlap',
    threshold: MATCH_THRESHOLDS.stage2Stop,
    passed: false,
    candidates: [],
  });

  // Stage 3: synonym exact match
  const synMatches = synonymMatch(items, target);
  const firstSyn = synMatches[0];
  if (firstSyn !== undefined) {
    log?.addStage({
      stage: 3,
      stageName: 'synonym',
      threshold: MATCH_THRESHOLDS.stage3Stop,
      passed: true,
      candidates: [{ itemId: firstSyn.id, score: 1.0 }],
    });
    return { item: firstSyn, confidence: 1.0, stage: 3 };
  }
  log?.addStage({
    stage: 3,
    stageName: 'synonym',
    threshold: MATCH_THRESHOLDS.stage3Stop,
    passed: false,
    candidates: [],
  });

  // Stage 4: Levenshtein string similarity
  for (const item of items) {
    const score = stringSimilarity(target, normaliseName(item.name));
    if (score >= MATCH_THRESHOLDS.stage4Stop) {
      log?.addStage({
        stage: 4,
        stageName: 'string_similarity',
        threshold: MATCH_THRESHOLDS.stage4Stop,
        passed: true,
        candidates: [{ itemId: item.id, score }],
      });
      return { item, confidence: score, stage: 4 };
    }
  }
  log?.addStage({
    stage: 4,
    stageName: 'string_similarity',
    threshold: MATCH_THRESHOLDS.stage4Stop,
    passed: false,
    candidates: [],
  });

  return null;
}
