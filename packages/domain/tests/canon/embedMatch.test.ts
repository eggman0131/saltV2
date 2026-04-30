import { describe, it, expect } from 'vitest';
import { embedMatch } from '../../src/canon/queries/embedMatch.js';
import type { EmbeddingPort } from '../../src/canon/ports/EmbeddingPort.js';
import type { CanonItem } from '../../src/canon/entities/CanonItem.js';
import { MATCH_THRESHOLDS } from '../../src/canon/queries/matchThresholds.js';

function item(overrides: Partial<CanonItem> & { id: string; name: string }): CanonItem {
  return {
    synonyms: [],
    aisle: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    ...overrides,
  };
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag === 0 ? 0 : dot / mag;
}

function okPort(queryEmbedding: readonly number[]): EmbeddingPort {
  return {
    computeEmbedding: async () => ({ kind: 'ok', value: queryEmbedding }),
    cosineSimilarity: cosine,
  };
}

function failPort(): EmbeddingPort {
  return {
    computeEmbedding: async () => ({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'transient' },
    }),
    cosineSimilarity: cosine,
  };
}

// Unit vectors — cosine between them is easy to reason about.
const eX = [1, 0] as const; // x-axis
const eY = [0, 1] as const; // y-axis — cosine(eX, eY) = 0.0
const eSim = [0.8, 0.6] as const; // cosine(eX, eSim) = 0.8 (above 0.75 threshold)

describe('embedMatch — null-embedding items are skipped', () => {
  it('skips items where embedding is null', async () => {
    const items = [
      item({ id: '1', name: 'Tomato', embedding: null }),
      item({ id: '2', name: 'Olive Oil', embedding: eX }),
    ];
    const results = await embedMatch(okPort(eX), 'tomato', items);
    expect(results.every((r) => r.item.id !== '1')).toBe(true);
    expect(results.some((r) => r.item.id === '2')).toBe(true);
  });

  it('returns empty array when all items have null embeddings', async () => {
    const items = [item({ id: '1', name: 'Tomato', embedding: null })];
    expect(await embedMatch(okPort(eX), 'tomato', items)).toHaveLength(0);
  });
});

describe('embedMatch — threshold filtering', () => {
  it('includes items at or above stage5Stop threshold', async () => {
    // cosine(eX, eX) = 1.0 >= 0.75
    const items = [item({ id: '1', name: 'Perfect', embedding: eX })];
    const results = await embedMatch(okPort(eX), 'perfect', items);
    expect(results).toHaveLength(1);
    expect(results[0]?.item.id).toBe('1');
  });

  it('excludes items below stage5Stop threshold', async () => {
    // cosine(eX, eY) = 0.0 < 0.75
    const items = [item({ id: '1', name: 'Unrelated', embedding: eY })];
    expect(await embedMatch(okPort(eX), 'unrelated', items)).toHaveLength(0);
  });

  it('all returned candidates meet the threshold', async () => {
    const items = [
      item({ id: '1', name: 'Similar', embedding: eSim }), // 0.8 >= 0.75
      item({ id: '2', name: 'Unrelated', embedding: eY }), // 0.0 < 0.75
    ];
    const results = await embedMatch(okPort(eX), 'similar', items);
    for (const r of results) {
      expect(r.confidence).toBeGreaterThanOrEqual(MATCH_THRESHOLDS.stage5Stop);
    }
    expect(results.some((r) => r.item.id === '2')).toBe(false);
  });
});

describe('embedMatch — candidate shape', () => {
  it('sets stage to 5', async () => {
    const items = [item({ id: '1', name: 'Tomato', embedding: eX })];
    const results = await embedMatch(okPort(eX), 'tomato', items);
    expect(results[0]?.stage).toBe(5);
  });

  it('sets confidence to the cosine score', async () => {
    const items = [item({ id: '1', name: 'Tomato', embedding: eX })];
    const results = await embedMatch(okPort(eX), 'tomato', items);
    expect(results[0]?.confidence).toBeCloseTo(1.0);
  });
});

describe('embedMatch — sort order', () => {
  it('returns candidates sorted by confidence descending', async () => {
    const items = [
      item({ id: '2', name: 'Partial', embedding: eSim }), // cosine ≈ 0.8
      item({ id: '1', name: 'Perfect', embedding: eX }), // cosine = 1.0
    ];
    const results = await embedMatch(okPort(eX), 'query', items);
    expect(results).toHaveLength(2);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.confidence).toBeGreaterThanOrEqual(results[i]!.confidence);
    }
    expect(results[0]?.item.id).toBe('1');
  });
});

describe('embedMatch — embedding failure', () => {
  it('returns empty array when computeEmbedding fails', async () => {
    const items = [item({ id: '1', name: 'Tomato', embedding: eX })];
    expect(await embedMatch(failPort(), 'tomato', items)).toHaveLength(0);
  });
});

describe('embedMatch — empty catalog', () => {
  it('returns empty array for an empty item list', async () => {
    expect(await embedMatch(okPort(eX), 'tomato', [])).toHaveLength(0);
  });
});
