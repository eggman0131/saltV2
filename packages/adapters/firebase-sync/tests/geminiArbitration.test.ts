import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MatchCandidate } from '@salt/domain';

const mockCallable = vi.fn();

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => mockCallable),
}));

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

const baseReq = {
  normalisedName: 'tomato',
  candidates: [makeCandidate('abc', 'Tomato', 0.9)],
  aisles: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GeminiArbitrationAdapter — match result', () => {
  it('returns ok with match result from callable', async () => {
    mockCallable.mockResolvedValue({
      data: { kind: 'match', itemId: 'abc', confidence: 0.92, shoppingBehavior: 'needed' },
    });

    const adapter = createGeminiArbitrationAdapter();
    const result = await adapter.arbitrate(baseReq);

    expect(result).toEqual({
      kind: 'ok',
      value: { kind: 'match', itemId: 'abc', confidence: 0.92, shoppingBehavior: 'needed' },
    });
    expect(mockCallable).toHaveBeenCalledWith(baseReq);
  });

  it('passes through largeQuantityThreshold, unit, and reasoning on match result', async () => {
    mockCallable.mockResolvedValue({
      data: {
        kind: 'match',
        itemId: 'abc',
        confidence: 0.92,
        shoppingBehavior: 'stocked',
        largeQuantityThreshold: 1000,
        unit: 'g',
        reasoning: 'Good match for plain flour.',
      },
    });

    const adapter = createGeminiArbitrationAdapter();
    const result = await adapter.arbitrate(baseReq);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      const v = result.value;
      expect(v.kind).toBe('match');
      if (v.kind === 'match') {
        expect(v.shoppingBehavior).toBe('stocked');
        expect(v.largeQuantityThreshold).toBe(1000);
        expect(v.unit).toBe('g');
        expect(v.reasoning).toBe('Good match for plain flour.');
      }
    }
  });
});

describe('GeminiArbitrationAdapter — new item result', () => {
  it('returns ok with new result including aisleId and shoppingBehavior', async () => {
    mockCallable.mockResolvedValue({
      data: {
        kind: 'new',
        canonName: 'Cherry Tomato',
        aisleId: 'produce-1',
        shoppingBehavior: 'needed',
      },
    });

    const adapter = createGeminiArbitrationAdapter();
    const result = await adapter.arbitrate({
      normalisedName: 'cherry tomato',
      candidates: [],
      aisles: [{ id: 'produce-1', name: 'Produce', order: 1 }],
    });

    expect(result).toEqual({
      kind: 'ok',
      value: {
        kind: 'new',
        canonName: 'Cherry Tomato',
        aisleId: 'produce-1',
        shoppingBehavior: 'needed',
      },
    });
  });

  it('returns ok with null aisleId', async () => {
    mockCallable.mockResolvedValue({
      data: { kind: 'new', canonName: 'Cherry Tomato', aisleId: null, shoppingBehavior: 'needed' },
    });

    const adapter = createGeminiArbitrationAdapter();
    const result = await adapter.arbitrate({
      normalisedName: 'cherry tomato',
      candidates: [],
      aisles: [],
    });

    expect(result).toEqual({
      kind: 'ok',
      value: { kind: 'new', canonName: 'Cherry Tomato', aisleId: null, shoppingBehavior: 'needed' },
    });
  });

  it('passes through largeQuantityThreshold, unit, and reasoning on new result', async () => {
    mockCallable.mockResolvedValue({
      data: {
        kind: 'new',
        canonName: 'Plain Flour',
        aisleId: 'baking-1',
        shoppingBehavior: 'stocked',
        largeQuantityThreshold: 1000,
        unit: 'g',
        reasoning: 'Standard UK bag of flour is 1 kg.',
      },
    });

    const adapter = createGeminiArbitrationAdapter();
    const result = await adapter.arbitrate({
      normalisedName: 'plain flour',
      candidates: [],
      aisles: [{ id: 'baking-1', name: 'Baking', order: 1 }],
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      const v = result.value;
      expect(v.kind).toBe('new');
      if (v.kind === 'new') {
        expect(v.shoppingBehavior).toBe('stocked');
        expect(v.largeQuantityThreshold).toBe(1000);
        expect(v.unit).toBe('g');
        expect(v.reasoning).toBe('Standard UK bag of flour is 1 kg.');
      }
    }
  });
});

describe('GeminiArbitrationAdapter — no-match result', () => {
  it('returns ok with no-match result from callable', async () => {
    mockCallable.mockResolvedValue({ data: { kind: 'no-match' } });

    const adapter = createGeminiArbitrationAdapter();
    const result = await adapter.arbitrate({ normalisedName: 'xyzzy', candidates: [], aisles: [] });

    expect(result).toEqual({ kind: 'ok', value: { kind: 'no-match' } });
  });
});

describe('GeminiArbitrationAdapter — failure paths', () => {
  it('returns transient NetworkError when the callable throws a generic error', async () => {
    mockCallable.mockRejectedValue(new Error('network failure'));

    const adapter = createGeminiArbitrationAdapter();
    const result = await adapter.arbitrate(baseReq);

    expect(result).toEqual({ kind: 'err', error: { kind: 'NetworkError', reason: 'transient' } });
  });

  it('returns unreachable NetworkError for unauthenticated errors', async () => {
    const err = Object.assign(new Error('unauthenticated'), { code: 'functions/unauthenticated' });
    mockCallable.mockRejectedValue(err);

    const adapter = createGeminiArbitrationAdapter();
    const result = await adapter.arbitrate(baseReq);

    expect(result).toEqual({ kind: 'err', error: { kind: 'NetworkError', reason: 'unreachable' } });
  });

  it('returns unreachable NetworkError for permission-denied errors', async () => {
    const err = Object.assign(new Error('permission denied'), {
      code: 'functions/permission-denied',
    });
    mockCallable.mockRejectedValue(err);

    const adapter = createGeminiArbitrationAdapter();
    const result = await adapter.arbitrate(baseReq);

    expect(result).toEqual({ kind: 'err', error: { kind: 'NetworkError', reason: 'unreachable' } });
  });

  it('reports errors to the ErrorReportingPort', async () => {
    const err = new Error('boom');
    mockCallable.mockRejectedValue(err);
    const errors = { report: vi.fn() };

    const adapter = createGeminiArbitrationAdapter(errors);
    await adapter.arbitrate(baseReq);

    expect(errors.report).toHaveBeenCalledWith(err);
  });
});
