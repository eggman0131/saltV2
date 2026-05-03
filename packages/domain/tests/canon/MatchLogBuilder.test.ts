import { describe, it, expect, beforeEach } from 'vitest';
import { MatchLogBuilder } from '@salt/domain';
import type { StageLog } from '@salt/domain';

function makeStage(overrides: Partial<StageLog> = {}): StageLog {
  return {
    stage: 1,
    stageName: 'normalization',
    threshold: 1.0,
    passed: true,
    consideredCount: 3,
    durationMs: 0,
    topCandidates: [],
    bestScore: 1.0,
    gap: 0.0,
    skipReason: null,
    ...overrides,
  };
}

describe('MatchLogBuilder', () => {
  let builder: MatchLogBuilder;

  beforeEach(() => {
    builder = new MatchLogBuilder();
  });

  it('builds a MatchLogEntry with correct raw and normalized input', () => {
    builder.start('Apples', 'apple');
    const entry = builder.complete('log-1', 'matched', 'item-42');

    expect(entry.rawInput).toBe('Apples');
    expect(entry.normalizedInput).toBe('apple');
  });

  it('records the provided id and finalDecision', () => {
    builder.start('Milk', 'milk');
    const entry = builder.complete('log-99', 'created', null);

    expect(entry.id).toBe('log-99');
    expect(entry.finalDecision).toBe('created');
    expect(entry.finalItemId).toBeNull();
  });

  it('includes all added stages in order', () => {
    builder.start('Tomato', 'tomato');
    builder.addStage(makeStage({ stage: 1, stageName: 'normalization' }));
    builder.addStage(makeStage({ stage: 2, stageName: 'token', passed: false }));
    const entry = builder.complete('log-2', 'ai_arbitrated', 'item-7');

    expect(entry.stages).toHaveLength(2);
    expect(entry.stages[0].stage).toBe(1);
    expect(entry.stages[1].stage).toBe(2);
    expect(entry.stages[1].passed).toBe(false);
  });

  it('sets schemaVersion to 2', () => {
    builder.start('Onion', 'onion');
    const entry = builder.complete('log-3', 'matched', 'item-1');

    expect(entry.schemaVersion).toBe(2);
  });

  it('sets timestamp to a valid ISO8601 string', () => {
    builder.start('Garlic', 'garlic');
    const entry = builder.complete('log-4', 'matched', 'item-2');

    expect(() => new Date(entry.timestamp)).not.toThrow();
    expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
  });

  it('resets stages on a second call to start', () => {
    builder.start('First', 'first');
    builder.addStage(makeStage({ stage: 1 }));
    builder.start('Second', 'second');
    const entry = builder.complete('log-5', 'created', null);

    expect(entry.rawInput).toBe('Second');
    expect(entry.stages).toHaveLength(0);
  });

  it('returns a frozen stages array (no shared reference)', () => {
    builder.start('Pepper', 'pepper');
    builder.addStage(makeStage({ stage: 1 }));
    const entry = builder.complete('log-6', 'matched', 'item-3');

    builder.addStage(makeStage({ stage: 2 }));

    expect(entry.stages).toHaveLength(1);
  });

  it('includes inputItemCount set via setInputItemCount', () => {
    builder.start('Apple', 'apple');
    builder.setInputItemCount(42);
    const entry = builder.complete('log-7', 'matched', 'item-1');

    expect(entry.inputItemCount).toBe(42);
  });

  it('defaults inputItemCount to 0 when not set', () => {
    builder.start('Apple', 'apple');
    const entry = builder.complete('log-8', 'created', null);

    expect(entry.inputItemCount).toBe(0);
  });

  it('resets inputItemCount on a second call to start', () => {
    builder.start('First', 'first');
    builder.setInputItemCount(10);
    builder.start('Second', 'second');
    const entry = builder.complete('log-9', 'created', null);

    expect(entry.inputItemCount).toBe(0);
  });

  it('reports totalDurationMs as a non-negative number', () => {
    builder.start('Apple', 'apple');
    const entry = builder.complete('log-10', 'matched', 'item-1');

    expect(entry.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(entry.totalDurationMs)).toBe(true);
  });

  it('includes arbitration log set via setArbitration', () => {
    builder.start('Apple', 'apple');
    const arbLog = {
      reason: 'aisle_suggestion',
      candidatesIn: 0,
      aislesIn: 3,
      prompt: 'test prompt',
      rawResponse: '{"kind":"new"}',
      outcome: 'new',
      durationMs: 42,
    };
    builder.setArbitration(arbLog);
    const entry = builder.complete('log-11', 'created', 'item-1');

    expect(entry.arbitration).toEqual(arbLog);
  });

  it('defaults arbitration to null when not set', () => {
    builder.start('Apple', 'apple');
    const entry = builder.complete('log-12', 'matched', 'item-1');

    expect(entry.arbitration).toBeNull();
  });

  it('resets arbitration on a second call to start', () => {
    builder.start('First', 'first');
    builder.setArbitration({
      reason: 'r',
      candidatesIn: 0,
      aislesIn: 1,
      prompt: '',
      rawResponse: '',
      outcome: 'new',
      durationMs: 1,
    });
    builder.start('Second', 'second');
    const entry = builder.complete('log-13', 'created', null);

    expect(entry.arbitration).toBeNull();
  });
});
