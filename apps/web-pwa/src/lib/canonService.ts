import {
  createFirebaseCanonStoreAdapter,
  createFirebaseAisleStoreAdapter,
  createGeminiEmbeddingAdapter,
  createGeminiArbitrationAdapter,
  createFirebaseMatchLoggingAdapter,
} from '@salt/firebase-sync';
import { createCanonMatchingPipeline } from '@salt/domain';
import type { CanonItem } from '@salt/domain';
import type { Result, DomainError } from '@salt/shared-types';

let pipeline: ReturnType<typeof createCanonMatchingPipeline> | null = null;

function getPipeline(): ReturnType<typeof createCanonMatchingPipeline> {
  if (!pipeline) {
    pipeline = createCanonMatchingPipeline(
      createFirebaseCanonStoreAdapter(),
      createFirebaseAisleStoreAdapter(),
      createGeminiEmbeddingAdapter(),
      createGeminiArbitrationAdapter(),
      { newCanonId: () => crypto.randomUUID() },
      createFirebaseMatchLoggingAdapter(),
    );
  }
  return pipeline;
}

export function addCanonItem(
  rawName: string,
  selectedAisle?: string | null,
): Promise<Result<CanonItem, DomainError>> {
  return getPipeline().matchOrCreate(rawName, selectedAisle);
}
