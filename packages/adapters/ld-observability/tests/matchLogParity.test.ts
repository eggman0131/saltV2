import { describe, expect, it } from 'vitest';
import type { MatchLogEntry } from '@salt/domain';
import { applyMatchLogAttrs, type SpanLike } from '../src/shared/matchLogToAttributes.js';

// Records every span.setAttribute call so we can assert the wire-shape contract.
class RecordingSpan implements SpanLike {
  readonly calls: Array<[string, string | number | boolean]> = [];
  setAttribute(key: string, value: string | number | boolean): void {
    this.calls.push([key, value]);
  }
}

const fixture: MatchLogEntry = {
  id: 'corr-123',
  schemaVersion: 2,
  timestamp: '2026-05-06T19:00:00.000Z',
  rawInput: 'Apples',
  normalizedInput: 'apples',
  inputItemCount: 42,
  totalDurationMs: 17,
  stages: [
    {
      stage: 1,
      stageName: 'exact_name',
      threshold: 1.0,
      passed: false,
      consideredCount: 42,
      durationMs: 1,
      topCandidates: [],
      bestScore: null,
      gap: null,
      skipReason: null,
    },
    {
      stage: 2,
      stageName: 'token_overlap',
      threshold: 0.8,
      passed: true,
      consideredCount: 42,
      durationMs: 3,
      topCandidates: [
        { itemId: 'i1', itemName: 'Apple', score: 0.92 },
        { itemId: 'i2', itemName: 'Pineapple', score: 0.71 },
      ],
      bestScore: 0.92,
      gap: 0.21,
      skipReason: null,
    },
  ],
  finalDecision: 'matched',
  finalItemId: 'i1',
  finalItemName: 'Apple',
  arbitration: {
    reason: 'ambiguous_near_tie',
    candidatesIn: 2,
    aislesIn: 5,
    prompt: 'p',
    rawResponse: 'r',
    outcome: 'match',
    durationMs: 8,
  },
};

describe('applyMatchLogAttrs — fast/cf parity', () => {
  it('emits identical span attributes for the same entry on both paths (modulo canon.path)', () => {
    const fastSpan = new RecordingSpan();
    const cfSpan = new RecordingSpan();

    applyMatchLogAttrs(fastSpan, fixture, 'fast');
    applyMatchLogAttrs(cfSpan, fixture, 'cf');

    // Same number of attribute calls.
    expect(cfSpan.calls.length).toBe(fastSpan.calls.length);

    // Same key sequence.
    expect(cfSpan.calls.map(([k]) => k)).toEqual(fastSpan.calls.map(([k]) => k));

    // Every value matches except canon.path itself.
    for (let i = 0; i < fastSpan.calls.length; i++) {
      const [fastKey, fastVal] = fastSpan.calls[i]!;
      const [cfKey, cfVal] = cfSpan.calls[i]!;
      expect(cfKey).toBe(fastKey);
      if (fastKey === 'canon.path') {
        expect(fastVal).toBe('fast');
        expect(cfVal).toBe('cf');
      } else {
        expect(cfVal).toBe(fastVal);
      }
    }
  });

  it('emits the user-visible parity fields verbatim', () => {
    const span = new RecordingSpan();
    applyMatchLogAttrs(span, fixture, 'cf');
    const attrs = Object.fromEntries(span.calls);

    // The user explicitly named these as the fields they want to verify match
    // between fast-path and CF emissions for drift detection.
    expect(attrs['canon.input']).toBe('Apples');
    expect(attrs['canon.normalized']).toBe('apples');
    expect(attrs['canon.summary']).toBeTypeOf('string');
    expect(attrs['canon.trace']).toBeTypeOf('string');
    expect(attrs['canon.decision']).toBe('matched');
    expect(attrs['canon.correlation_id']).toBe('corr-123');
    expect(attrs['canon.input_count']).toBe(42);
    expect(attrs['canon.total_duration_ms']).toBe(17);
    expect(attrs['canon.result']).toBe('Apple');
    expect(attrs['canon.result_id']).toBe('i1');
  });

  it('scales stage scores ×100 with 2dp', () => {
    const span = new RecordingSpan();
    applyMatchLogAttrs(span, fixture, 'fast');
    const attrs = Object.fromEntries(span.calls);

    expect(attrs['stage.2.best_score']).toBe(92);
    expect(attrs['stage.2.gap']).toBe(21);
  });

  it('omits canon.normalized when it equals rawInput', () => {
    const span = new RecordingSpan();
    applyMatchLogAttrs(span, { ...fixture, rawInput: 'apples', normalizedInput: 'apples' }, 'cf');
    const keys = span.calls.map(([k]) => k);
    expect(keys).not.toContain('canon.normalized');
  });

  it('truncates oversized arbitration prompt/response to the LD attribute cap', () => {
    const big = 'x'.repeat(3000);
    const span = new RecordingSpan();
    applyMatchLogAttrs(
      span,
      {
        ...fixture,
        arbitration: { ...fixture.arbitration!, prompt: big, rawResponse: big },
      },
      'cf',
    );
    const attrs = Object.fromEntries(span.calls);
    expect((attrs['arbitration.prompt'] as string).length).toBe(2000);
    expect((attrs['arbitration.raw_response'] as string).length).toBe(2000);
  });
});
