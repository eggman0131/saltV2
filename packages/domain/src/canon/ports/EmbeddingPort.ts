import type { ReadResult, DomainError } from '@salt/shared-types';

export interface EmbeddingPort {
  computeEmbedding(text: string): Promise<ReadResult<readonly number[], DomainError>>;
  cosineSimilarity(a: readonly number[], b: readonly number[]): number;
}
