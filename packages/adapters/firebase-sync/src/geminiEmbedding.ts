import { getFunctions, httpsCallable } from 'firebase/functions';
import type { EmbeddingPort, ErrorReportingPort } from '@salt/domain';

export function createGeminiEmbeddingAdapter(
  errors: ErrorReportingPort | null = null,
): EmbeddingPort {
  return {
    async computeEmbedding(text: string) {
      try {
        const fn = httpsCallable<{ text: string }, { values: number[] }>(
          getFunctions(),
          'embedText',
        );
        const result = await fn({ text });
        return { kind: 'ok', value: result.data.values };
      } catch (err) {
        errors?.report(err);
        const code = (err as { code?: string }).code ?? '';
        const reason =
          code === 'functions/unauthenticated' || code === 'functions/permission-denied'
            ? 'unreachable'
            : 'transient';
        return { kind: 'err', error: { kind: 'NetworkError', reason } };
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
