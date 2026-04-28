import type { CanonItem } from '../entities/CanonItem.js';
import type { MatchCandidate } from '../matching.js';
import type { EmbeddingPort } from '../ports/EmbeddingPort.js';
import { MATCH_THRESHOLDS } from '../matching.js';

// Stage 5: semantic similarity via stored embeddings.
// Items without a stored embedding are skipped gracefully.
// Returns all candidates above the stage5Stop threshold, sorted by confidence
// descending. Returns an empty array when computeEmbedding fails so the
// pipeline can fall through to stage 6 without an exception.
export async function embedMatch(
  port: EmbeddingPort,
  normalisedName: string,
  items: readonly CanonItem[],
): Promise<MatchCandidate[]> {
  const result = await port.computeEmbedding(normalisedName);
  if (result.kind === 'err') return [];

  const queryEmbedding = result.value;
  const candidates: MatchCandidate[] = [];

  for (const item of items) {
    if (item.embedding === null) continue;
    const score = port.cosineSimilarity(queryEmbedding, item.embedding);
    if (score >= MATCH_THRESHOLDS.stage5Stop) {
      candidates.push({ item, confidence: score, stage: 5 });
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}
