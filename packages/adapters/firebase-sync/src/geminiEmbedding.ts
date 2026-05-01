import { getApp } from 'firebase/app';
import type { EmbeddingPort, ErrorReportingPort } from '@salt/domain';

const EMBEDDING_MODEL = 'text-embedding-004';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export function createGeminiEmbeddingAdapter(
  errors: ErrorReportingPort | null = null,
): EmbeddingPort {
  return {
    async computeEmbedding(text: string) {
      const apiKey = getApp().options.apiKey;
      if (!apiKey) {
        errors?.report(new Error('Gemini embedding: no API key configured'));
        return { kind: 'err', error: { kind: 'NetworkError', reason: 'unreachable' } };
      }
      try {
        const resp = await fetch(
          `${BASE_URL}/${EMBEDDING_MODEL}:embedContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: `models/${EMBEDDING_MODEL}`,
              content: { parts: [{ text }] },
            }),
          },
        );
        if (!resp.ok) {
          const body = await resp.json().catch(() => null);
          errors?.report(new Error(`Gemini embedding ${resp.status}: ${JSON.stringify(body)}`));
          const reason = resp.status >= 500 || resp.status === 429 ? 'transient' : 'unreachable';
          return { kind: 'err', error: { kind: 'NetworkError', reason } };
        }
        const data = (await resp.json()) as { embedding: { values: number[] } };
        return { kind: 'ok', value: data.embedding.values };
      } catch (err) {
        errors?.report(err);
        return { kind: 'err', error: { kind: 'NetworkError', reason: 'transient' } };
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
