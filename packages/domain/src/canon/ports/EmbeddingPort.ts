import type { ReadResult, DomainError } from '@salt/shared-types';

export interface EmbeddingPort {
  computeEmbedding(text: string): Promise<ReadResult<readonly number[], DomainError>>;
  /**
   * Batch variant: compute embeddings for many texts in as few underlying
   * calls as possible. Returns one embedding per input text, in the same
   * order. Optional — when an adapter does not implement it, callers fall
   * back to per-text `computeEmbedding`. The batch matching path uses this to
   * pre-compute every input name once and serve `embedMatch` from a warm cache.
   */
  computeEmbeddings?(
    texts: readonly string[],
  ): Promise<ReadResult<readonly (readonly number[])[], DomainError>>;
  cosineSimilarity(a: readonly number[], b: readonly number[]): number;
}
