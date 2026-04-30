import type { CanonItem } from '../entities/CanonItem.js';
import type { MatchCandidate } from '../entities/MatchCandidate.js';
import type { EmbeddingPort } from '../ports/EmbeddingPort.js';
import { MATCH_THRESHOLDS } from './matchThresholds.js';
import type { MatchLogBuilder } from '../commands/buildMatchLog.js';

// Stage 5: semantic similarity via stored embeddings.
// Items without a stored embedding are skipped gracefully.
// Returns all candidates above the stage5Stop threshold, sorted by confidence
// descending. Returns an empty array when computeEmbedding fails so the
// pipeline can fall through to stage 6 without an exception.
export async function embedMatch(
  port: EmbeddingPort,
  normalisedName: string,
  items: readonly CanonItem[],
  log?: MatchLogBuilder,
): Promise<MatchCandidate[]> {
  const result = await port.computeEmbedding(normalisedName);
  if (result.kind === 'err') {
    log?.addStage({
      stage: 5,
      stageName: 'embedding',
      threshold: MATCH_THRESHOLDS.stage5Stop,
      passed: false,
      candidates: [],
    });
    return [];
  }

  const queryEmbedding = result.value;
  const candidates: MatchCandidate[] = [];

  for (const item of items) {
    if (item.embedding === null) continue;
    const score = port.cosineSimilarity(queryEmbedding, item.embedding);
    if (score >= MATCH_THRESHOLDS.stage5Stop) {
      candidates.push({ item, confidence: score, stage: 5 });
    }
  }

  const sorted = candidates.sort((a, b) => b.confidence - a.confidence);
  log?.addStage({
    stage: 5,
    stageName: 'embedding',
    threshold: MATCH_THRESHOLDS.stage5Stop,
    passed: sorted.length > 0,
    candidates: sorted.map((c) => ({
      itemId: c.item.id,
      score: c.confidence,
      reason: `cosine:${c.confidence.toFixed(4)}`,
    })),
  });
  return sorted;
}
