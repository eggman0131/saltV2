import { describe, it, expect } from 'vitest';
import type { BatchDoc, BatchStageDoc } from '@salt/domain/schemas';
import {
  formatStatedDuration,
  formatWhen,
  nextAction,
  orderBatches,
  yieldSummary,
} from '../src/routes/batches/batchDisplay.js';

// The words and formats the two batch screens share (issue #812, phase 1 of epic
// #778). Pure, and the clock is injected, so every case here is a fixed string.
//
// Every instant below is built with the local-time `Date` constructor and rendered
// in local time, so none of these assertions depends on the machine's timezone —
// which is the same reason `formatWhen` compares local calendar days rather than
// UTC ones. "Tomorrow" is a fact about the kitchen's morning.

function at(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function stage(over: Partial<BatchStageDoc> = {}): BatchStageDoc {
  return {
    id: 'stage-1',
    label: 'Bulk ferment',
    kind: 'wait',
    environment: null,
    duration: { kind: 'fixed', minutes: 180 },
    until: null,
    stepId: null,
    plannedStartAt: '2026-08-14T09:00:00.000Z',
    plannedEndAt: '2026-08-14T12:00:00.000Z',
    actualStartAt: null,
    actualEndAt: null,
    ...over,
  };
}

function batch(over: Partial<BatchDoc> = {}): BatchDoc {
  return {
    id: 'batch-1',
    schemaVersion: 1,
    recipeId: 'recipe-1',
    recipeTitle: 'Overnight white tin',
    state: 'running',
    quantities: [],
    totals: { basisGrams: 841, totalGrams: 1483, usableGrams: 1440, units: null },
    stages: [stage()],
    rationale: null,
    createdAt: '2026-08-14T08:00:00.000Z',
    updatedAt: '2026-08-14T08:00:00.000Z',
    ...over,
  };
}

describe('formatWhen', () => {
  const now = at(2026, 8, 14, 9, 0);

  it('gives today and tomorrow their words', () => {
    expect(formatWhen(at(2026, 8, 14, 12, 30).toISOString(), now)).toBe('today 12:30');
    expect(formatWhen(at(2026, 8, 15, 7, 30).toISOString(), now)).toBe('tomorrow 07:30');
    expect(formatWhen(at(2026, 8, 13, 22, 0).toISOString(), now)).toBe('yesterday 22:00');
  });

  it('names the weekday once a run reaches past tomorrow — a cure runs for weeks', () => {
    expect(formatWhen(at(2026, 8, 21, 7, 30).toISOString(), now)).toBe('Fri 21 Aug, 07:30');
  });

  it('never renders an unreadable instant as a date', () => {
    expect(formatWhen('not a time', now)).toBe('—');
  });
});

describe('formatStatedDuration', () => {
  it('keeps a range as a range — the recipe said 45 to 60, not 52.5', () => {
    expect(formatStatedDuration({ kind: 'range', minMinutes: 45, maxMinutes: 60 })).toBe(
      '45 min – 1 h',
    );
  });

  it('reads a hand-typed range backwards without printing a negative span', () => {
    expect(formatStatedDuration({ kind: 'range', minMinutes: 60, maxMinutes: 45 })).toBe(
      '45 min – 1 h',
    );
  });

  it('says nothing at all for a stage with no duration', () => {
    // "Until doubled" has no length. The caller says so in words rather than
    // printing a figure nobody gave.
    expect(formatStatedDuration(null)).toBeNull();
  });

  it('spells a fixed duration in hours and minutes', () => {
    expect(formatStatedDuration({ kind: 'fixed', minutes: 90 })).toBe('1 h 30 min');
    expect(formatStatedDuration({ kind: 'fixed', minutes: 15 })).toBe('15 min');
  });
});

describe('nextAction', () => {
  it('is the first stage not yet marked done', () => {
    const action = nextAction(
      batch({
        stages: [
          stage({ id: 's1', label: 'Mix', actualEndAt: '2026-08-14T09:10:00.000Z' }),
          stage({ id: 's2', label: 'Bulk ferment' }),
        ],
      }),
    );
    expect(action).toEqual({ kind: 'stage', stage: expect.objectContaining({ id: 's2' }) });
  });

  it('is "done" when every stage is finished — there is no finished STATE', () => {
    expect(
      nextAction(batch({ stages: [stage({ actualEndAt: '2026-08-14T12:00:00.000Z' })] })).kind,
    ).toBe('done');
  });

  it('is "abandoned" for a stopped run, whatever its stages say', () => {
    expect(nextAction(batch({ state: 'abandoned' })).kind).toBe('abandoned');
  });
});

describe('orderBatches', () => {
  it('puts what needs doing soonest first, and everything finished at the bottom', () => {
    const soon = batch({ id: 'soon', stages: [stage({ plannedStartAt: '2026-08-14T09:00:00Z' })] });
    const later = batch({
      id: 'later',
      stages: [stage({ plannedStartAt: '2026-08-14T18:00:00Z' })],
    });
    const done = batch({
      id: 'done',
      createdAt: '2026-08-10T08:00:00.000Z',
      stages: [stage({ actualEndAt: '2026-08-10T12:00:00.000Z' })],
    });
    const stopped = batch({
      id: 'stopped',
      state: 'abandoned',
      createdAt: '2026-08-12T08:00:00.000Z',
    });

    expect(orderBatches([done, later, stopped, soon]).map((b) => b.id)).toEqual([
      'soon',
      'later',
      // The ended ones read as a log: most recently started first.
      'stopped',
      'done',
    ]);
  });
});

describe('yieldSummary', () => {
  it('counts the shapes when the solve had one', () => {
    expect(
      yieldSummary({
        basisGrams: 841,
        totalGrams: 1483,
        usableGrams: 1440,
        units: { label: '120 g roll', count: 12, unitDoughGrams: 120, bakedUnitGrams: 108 },
      }),
    ).toBe('12 × 120 g roll');
  });

  it('falls back to the weight for a basis-driven run — a cure yields no count', () => {
    expect(
      yieldSummary({ basisGrams: 2400, totalGrams: 2460, usableGrams: 2460, units: null }),
    ).toBe('2460 g');
  });
});
