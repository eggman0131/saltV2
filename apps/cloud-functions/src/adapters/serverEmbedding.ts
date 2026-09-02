import { logger } from 'firebase-functions';
import type { EmbeddingPort } from '@salt/domain';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import { embedTextFlow } from '../flows/embedText.js';

export function createServerEmbeddingAdapter(): EmbeddingPort {
  return {
    async computeEmbedding(text: string): Promise<ReadResult<readonly number[], DomainError>> {
      try {
        // No outer withAiTimeout: the flow owns its budget (issue #915). It is
        // also exported as its own callable, so a wrapper here only ever
        // covered some of its entrypoints.
        const { values } = await embedTextFlow({ text });
        return success(values);
      } catch (err) {
        logger.error('matchOrCreateCanon: embedding failed', { err });
        return failure({ kind: 'NetworkError', reason: 'transient' });
      }
    },
    async computeEmbeddings(
      texts: readonly string[],
    ): Promise<ReadResult<readonly (readonly number[])[], DomainError>> {
      try {
        // One job, one implementation (issue #935). This used to resolve an
        // embedder and call `ai.embed` inline, which made "text in, vector out"
        // two implementations: two registry keys, two fake seams (#686), two
        // timeout policies. It now runs `embedTextFlow` per text, exactly as
        // `computeEmbedding` above does, so a batch resolves the same model and
        // obeys the same budget as a single item — and the e2e short-circuit is
        // inherited from the flow rather than repeated here.
        //
        // Per item rather than per batch is also a better failure mode: one slow
        // text now times out and retries alone, where the old single
        // `withAiTimeout('batchEmbedTexts', …)` retried the whole batch. It
        // costs one Genkit flow span per text instead of one per batch, which
        // was accepted on the issue.
        const results = await Promise.all(texts.map((text) => embedTextFlow({ text })));
        return success(results.map(({ values }) => values));
      } catch (err) {
        logger.error('canonicaliseRecipeIngredients: batch embedding failed', { err });
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
