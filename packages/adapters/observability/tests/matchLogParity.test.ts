import { describe, expect, it } from 'vitest';
import type { MatchLogEntry } from '@salt/domain';
import {
  CANON_MATCH_EVENT,
  toCanonMatchEvent,
  type CanonMatchEventProps,
} from '../src/shared/matchOutcomeEvent.js';

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

describe('toCanonMatchEvent — fast/cf slim-event parity', () => {
  it('emits an identical event payload on both paths except for canon_path', () => {
    const fast = toCanonMatchEvent(fixture, 'fast');
    const cf = toCanonMatchEvent(fixture, 'cf');

    // Same set of property keys on both paths.
    expect(Object.keys(cf).sort()).toEqual(Object.keys(fast).sort());

    // Every value matches except the path tag itself.
    for (const key of Object.keys(fast) as (keyof CanonMatchEventProps)[]) {
      if (key === 'canon_path') {
        expect(fast.canon_path).toBe('fast');
        expect(cf.canon_path).toBe('cf');
      } else {
        expect(cf[key]).toBe(fast[key]);
      }
    }
  });

  it('emits the user-visible slim fields verbatim', () => {
    const e = toCanonMatchEvent(fixture, 'cf');

    // What was typed → what it chose (id + name) → which stage won → confidence.
    expect(e.canon_input).toBe('Apples');
    expect(e.canon_normalized).toBe('apples');
    expect(e.canon_decision).toBe('matched');
    expect(e.canon_result).toBe('Apple');
    expect(e.canon_result_id).toBe('i1');
    expect(e.canon_winning_stage).toBe(2);
    expect(e.canon_winning_stage_name).toBe('token_overlap');
    expect(e.canon_correlation_id).toBe('corr-123');
    expect(e.canon_input_count).toBe(42);
    expect(e.canon_total_duration_ms).toBe(17);
  });

  it('scales the winning-stage confidence ×100 with 2dp', () => {
    const e = toCanonMatchEvent(fixture, 'fast');
    expect(e.canon_confidence).toBe(92);
  });

  it('picks the LAST passing stage as the winner', () => {
    // Two passing stages — stage 3 must win over stage 2.
    const multi: MatchLogEntry = {
      ...fixture,
      stages: [
        ...fixture.stages,
        {
          stage: 3,
          stageName: 'embedding',
          threshold: 0.7,
          passed: true,
          consideredCount: 42,
          durationMs: 5,
          topCandidates: [{ itemId: 'i9', itemName: 'Apple Pie', score: 0.81 }],
          bestScore: 0.81,
          gap: 0.1,
          skipReason: null,
        },
      ],
    };
    const e = toCanonMatchEvent(multi, 'fast');
    expect(e.canon_winning_stage).toBe(3);
    expect(e.canon_winning_stage_name).toBe('embedding');
    expect(e.canon_confidence).toBe(81);
  });

  it('omits canon_normalized when it equals rawInput', () => {
    const e = toCanonMatchEvent(
      { ...fixture, rawInput: 'apples', normalizedInput: 'apples' },
      'cf',
    );
    expect(e).not.toHaveProperty('canon_normalized');
  });

  it('omits winning-stage/confidence and result when nothing matched', () => {
    const created: MatchLogEntry = {
      ...fixture,
      stages: [
        {
          stage: 1,
          stageName: 'exact_name',
          threshold: 1.0,
          passed: false,
          consideredCount: 0,
          durationMs: 1,
          topCandidates: [],
          bestScore: null,
          gap: null,
          skipReason: 'no_items',
        },
      ],
      finalDecision: 'created',
      finalItemId: 'new-1',
      finalItemName: 'Dragonfruit',
    };
    const e = toCanonMatchEvent(created, 'fast');
    expect(e.canon_decision).toBe('created');
    expect(e).not.toHaveProperty('canon_winning_stage');
    expect(e).not.toHaveProperty('canon_winning_stage_name');
    expect(e).not.toHaveProperty('canon_confidence');
    // A created item still records its new id/name.
    expect(e.canon_result_id).toBe('new-1');
    expect(e.canon_result).toBe('Dragonfruit');
  });

  it('exposes a stable event name', () => {
    expect(CANON_MATCH_EVENT).toBe('canon.match');
  });
});
