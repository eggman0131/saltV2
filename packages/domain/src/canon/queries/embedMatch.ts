import type { CanonItem } from '../entities/CanonItem.js';
import type { MatchCandidate } from '../entities/MatchCandidate.js';
import type { EmbeddingPort } from '../ports/EmbeddingPort.js';
import { MATCH_THRESHOLDS } from './matchThresholds.js';
import type { MatchLogBuilder } from '../commands/buildMatchLog.js';

// Stage 5: semantic similarity via stored embeddings.
// Always logs top-5 cosine scores regardless of threshold, and emits a
// skipReason when the stage cannot run. Returns all candidates above
// stage5Stop sorted by confidence descending.
export async function embedMatch(
  port: EmbeddingPort,
  normalisedName: string,
  items: readonly CanonItem[],
  log?: MatchLogBuilder,
): Promise<MatchCandidate[]> {
  const t0 = Date.now();
  const itemsWithEmbeddings = items.filter((i) => i.embedding !== null);

  if (itemsWithEmbeddings.length === 0) {
    log?.addStage({
      stage: 5,
      stageName: 'embedding',
      threshold: MATCH_THRESHOLDS.stage5Stop,
      passed: false,
      consideredCount: 0,
      durationMs: Date.now() - t0,
      topCandidates: [],
      bestScore: null,
      gap: null,
      skipReason: 'no_items',
    });
    return [];
  }

  const result = await port.computeEmbedding(normalisedName);
  if (result.kind === 'err') {
    log?.addStage({
      stage: 5,
      stageName: 'embedding',
      threshold: MATCH_THRESHOLDS.stage5Stop,
      passed: false,
      consideredCount: itemsWithEmbeddings.length,
      durationMs: Date.now() - t0,
      topCandidates: [],
      bestScore: null,
      gap: null,
      skipReason: 'embedding_error',
    });
    return [];
  }

  const queryEmbedding = result.value;
  const allScored = itemsWithEmbeddings.map((item) => ({
    item,
    score: port.cosineSimilarity(queryEmbedding, item.embedding!),
  }));
  allScored.sort((a, b) => b.score - a.score);

  const top5 = allScored.slice(0, 5);
  const bestScore = top5[0]?.score ?? 0;
  const passing = allScored.filter((c) => c.score >= MATCH_THRESHOLDS.stage5Stop);

  log?.addStage({
    stage: 5,
    stageName: 'embedding',
    threshold: MATCH_THRESHOLDS.stage5Stop,
    passed: passing.length > 0,
    consideredCount: itemsWithEmbeddings.length,
    durationMs: Date.now() - t0,
    topCandidates: top5.map((c) => ({
      itemId: c.item.id,
      itemName: c.item.name,
      score: c.score,
      reason: `cosine:${c.score.toFixed(4)}`,
    })),
    bestScore,
    gap: bestScore - MATCH_THRESHOLDS.stage5Stop,
    skipReason: null,
  });

  return passing.map((c) => ({ item: c.item, confidence: c.score, stage: 5 }));
}
