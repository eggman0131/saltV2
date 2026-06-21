import { logger } from 'firebase-functions';
import { googleAI } from '@genkit-ai/google-genai';
import type { EmbeddingPort } from '@salt/domain';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import { embedTextFlow } from '../flows/embedText.js';
import { withAiTimeout } from './withAiTimeout.js';
import { ai } from '../genkit.js';
import { resolveModel } from '../ai/resolveModel.js';

export function createServerEmbeddingAdapter(): EmbeddingPort {
  return {
    async computeEmbedding(text: string): Promise<ReadResult<readonly number[], DomainError>> {
      try {
        const { values } = await withAiTimeout('embedText', () => embedTextFlow({ text }));
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
        // Free-text admin model (Phase 1) is wider than the SDK's literal-union
        // embedder param — launder it across the boundary.
        const embedder = googleAI.embedder(
          (await resolveModel('embedding', 'serverEmbedding')) as Parameters<
            typeof googleAI.embedder
          >[0],
        );
        const allEmbeddings = await withAiTimeout('batchEmbedTexts', () =>
          Promise.all(texts.map((text) => ai.embed({ embedder, content: text }))),
        );
        return success(allEmbeddings.map((e) => e[0]!.embedding));
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
