import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MatchCandidate } from '@salt/domain';

vi.mock('firebase/app', () => ({
  getApp: () => ({ options: { apiKey: 'test-key' } }),
}));

// Import after the mock is set up so the module picks up the fake getApp.
const { createGeminiArbitrationAdapter } = await import('../src/geminiArbitration.js');

function makeCandidate(id: string, name: string, confidence: number): MatchCandidate {
  return {
    item: {
      id,
      name,
      synonyms: [],
      aisleId: null,
      thumbnail: null,
      embedding: null,
      needs_approval: false,
    },
    confidence,
    stage: 5,
  };
}

type FetchResponse = { ok: boolean; json: () => Promise<unknown> };

function mockFetch(body: unknown, ok = true): void {
  const response: FetchResponse = { ok, json: async () => body };
  vi.stubGlobal('fetch', async () => response);
}

function geminiResponse(text: string): unknown {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GeminiArbitrationAdapter — match result', () => {
  it('returns ok/match when Gemini responds with kind:match', async () => {
    mockFetch(geminiResponse('{"kind":"match","itemId":"abc","confidence":0.92}'));
    const adapter = createGeminiArbitrationAdapter();
    const result = await adapter.arbitrate({
      normalisedName: 'tomato',
      candidates: [makeCandidate('abc', 'Tomato', 0.9)],
      aisles: [],
    });
    expect(result).toEqual({
      kind: 'ok',
      value: { kind: 'match', itemId: 'abc', confidence: 0.92 },
    });
  });
});

describe('GeminiArbitrationAdapter — new item result', () => {
  it('returns ok/new with an aisleId', async () => {
    mockFetch(geminiResponse('{"kind":"new","canonName":"Cherry Tomato","aisleId":"produce-1"}'));
    const adapter = createGeminiArbitrationAdapter();
    const result = await adapter.arbitrate({
      normalisedName: 'cherry tomato',
      candidates: [],
      aisles: [{ id: 'produce-1', name: 'Produce', order: 1 }],
    });
    expect(result).toEqual({
      kind: 'ok',
      value: { kind: 'new', canonName: 'Cherry Tomato', aisleId: 'produce-1' },
    });
  });

  it('returns ok/new with null aisleId when Gemini returns null', async () => {
    mockFetch(geminiResponse('{"kind":"new","canonName":"Cherry Tomato","aisleId":null}'));
    const adapter = createGeminiArbitrationAdapter();
    const result = await adapter.arbitrate({
      normalisedName: 'cherry tomato',
      candidates: [],
      aisles: [],
    });
    expect(result).toEqual({
      kind: 'ok',
      value: { kind: 'new', canonName: 'Cherry Tomato', aisleId: null },
    });
  });
});

describe('GeminiArbitrationAdapter — no-match result', () => {
  it('returns ok/no-match when Gemini responds with kind:no-match', async () => {
    mockFetch(geminiResponse('{"kind":"no-match"}'));
    const adapter = createGeminiArbitrationAdapter();
    const result = await adapter.arbitrate({
      normalisedName: 'xyzzy',
      candidates: [],
      aisles: [],
    });
    expect(result).toEqual({ kind: 'ok', value: { kind: 'no-match' } });
  });
});

describe('GeminiArbitrationAdapter — failure paths', () => {
  it('returns ok/no-match when fetch throws', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('network failure');
    });
    const adapter = createGeminiArbitrationAdapter();
    const result = await adapter.arbitrate({
      normalisedName: 'tomato',
      candidates: [],
      aisles: [],
    });
    expect(result).toEqual({ kind: 'ok', value: { kind: 'no-match' } });
  });

  it('returns ok/no-match when response is not ok', async () => {
    mockFetch({}, false);
    const adapter = createGeminiArbitrationAdapter();
    const result = await adapter.arbitrate({
      normalisedName: 'tomato',
      candidates: [],
      aisles: [],
    });
    expect(result).toEqual({ kind: 'ok', value: { kind: 'no-match' } });
  });

  it('returns ok/no-match when response JSON is malformed', async () => {
    mockFetch(geminiResponse('not-valid-json{{{'));
    const adapter = createGeminiArbitrationAdapter();
    const result = await adapter.arbitrate({
      normalisedName: 'tomato',
      candidates: [],
      aisles: [],
    });
    expect(result).toEqual({ kind: 'ok', value: { kind: 'no-match' } });
  });

  it('returns ok/no-match when response has no candidates', async () => {
    mockFetch({ candidates: [] });
    const adapter = createGeminiArbitrationAdapter();
    const result = await adapter.arbitrate({
      normalisedName: 'tomato',
      candidates: [],
      aisles: [],
    });
    expect(result).toEqual({ kind: 'ok', value: { kind: 'no-match' } });
  });

  it('returns ok/no-match when response JSON has an unrecognised kind', async () => {
    mockFetch(geminiResponse('{"kind":"unknown","foo":"bar"}'));
    const adapter = createGeminiArbitrationAdapter();
    const result = await adapter.arbitrate({
      normalisedName: 'tomato',
      candidates: [],
      aisles: [],
    });
    expect(result).toEqual({ kind: 'ok', value: { kind: 'no-match' } });
  });
});
