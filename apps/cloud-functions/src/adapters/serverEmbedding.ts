import { logger } from 'firebase-functions';
import type { EmbeddingPort } from '@salt/domain';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import { embedTextFlow } from '../flows/embedText.js';

export function createServerEmbeddingAdapter(): EmbeddingPort {
  return {
    async computeEmbedding(text: string): Promise<ReadResult<readonly number[], DomainError>> {
      try {
        const { values } = await embedTextFlow({ text });
        return success(values);
      } catch (err) {
        logger.error('matchOrCreateCanon: embedding failed', { err });
        return failure({ kind: 'NetworkError', reason: 'transient' });
      }
    },
    cosineSimilarity(a: readonly number[], b: readonly number[]): number {
      let dot = 0;
      let magA = 0;
      let magB = 0;
      for (let i = 0; i < a.length; i++) {
        const ai = a[i]!;
        const bi = b[i]!;
        dot += ai * bi;
        magA += ai * ai;
        magB += bi * bi;
      }
      const mag = Math.sqrt(magA) * Math.sqrt(magB);
      return mag === 0 ? 0 : dot / mag;
    },
  };
}
