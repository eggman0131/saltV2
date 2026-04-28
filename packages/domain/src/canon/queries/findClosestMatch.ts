import type { CanonItem } from '../entities/CanonItem.js';
import type { MatchCandidate } from '../matching.js';
import { MATCH_THRESHOLDS } from '../matching.js';
import { normaliseName } from './normaliseName.js';
import { tokenMatch } from './tokenMatch.js';
import { synonymMatch } from './synonymMatch.js';
import { stringSimilarity } from './stringSimilarity.js';

// Runs stages 1–4 in order; returns the first candidate that meets its stop
// threshold. Returns null when no stage finds a confident match (stages 5–6
// are handled by the pipeline orchestrator in Phase 4+).
export function findClosestMatch(
  items: readonly CanonItem[],
  rawName: string,
): MatchCandidate | null {
  const target = normaliseName(rawName);
  if (!target) return null;

  // Stage 1: exact normalised name match
  for (const item of items) {
    if (normaliseName(item.name) === target) {
      return { item, confidence: 1.0, stage: 1 };
    }
  }

  // Stage 2: token overlap
  for (const item of items) {
    const score = tokenMatch(target, normaliseName(item.name));
    if (score >= MATCH_THRESHOLDS.stage2Stop) {
      return { item, confidence: score, stage: 2 };
    }
  }

  // Stage 3: synonym exact match
  const synMatches = synonymMatch(items, target);
  const firstSyn = synMatches[0];
  if (firstSyn !== undefined) {
    return { item: firstSyn, confidence: 1.0, stage: 3 };
  }

  // Stage 4: Levenshtein string similarity
  for (const item of items) {
    const score = stringSimilarity(target, normaliseName(item.name));
    if (score >= MATCH_THRESHOLDS.stage4Stop) {
      return { item, confidence: score, stage: 4 };
    }
  }

  return null;
}
