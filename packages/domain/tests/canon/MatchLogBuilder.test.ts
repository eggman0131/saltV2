import { describe, it, expect, beforeEach } from 'vitest';
import { MatchLogBuilder } from '@salt/domain';
import type { StageLog } from '@salt/domain';

function makeStage(overrides: Partial<StageLog> = {}): StageLog {
  return {
    stage: 1,
    stageName: 'normalization',
    threshold: 1.0,
    passed: true,
    candidates: [],
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

  it('sets schemaVersion to 1', () => {
    builder.start('Onion', 'onion');
    const entry = builder.complete('log-3', 'matched', 'item-1');

    expect(entry.schemaVersion).toBe(1);
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
});
