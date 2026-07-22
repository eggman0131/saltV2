import { describe, it, expect } from 'vitest';
import { withTimerStarted, withTimerDismissed } from '@salt/domain';
import type { CookActiveTimerDoc, CookSessionDoc } from '@salt/domain/schemas';

// Step timers (issue #556). `endsAt` is an ABSOLUTE end-time supplied by the
// caller — the module never computes it from a clock — which is what lets a
// reload reconstruct the remaining time. One live timer per step.

function timer(stepId: string, endsAt: string, notify = false): CookActiveTimerDoc {
  return { stepId, endsAt, notify };
}

function session(activeTimers: CookActiveTimerDoc[]): CookSessionDoc {
  return {
    id: 'r1_u1',
    schemaVersion: 1,
    ownerUid: 'u1',
    recipeId: 'r1',
    recipeUpdatedAtAtStart: '2026-07-01T09:00:00.000Z',
    checkedIngredientIds: ['i1'],
    completedStepIds: ['s1'],
    activeTimers,
    createdAt: '2026-07-22T18:30:00.000Z',
    updatedAt: '2026-07-22T18:30:00.000Z',
  };
}

const T1 = '2026-07-22T18:35:00.000Z';
const T2 = '2026-07-22T18:40:00.000Z';
const T3 = '2026-07-22T19:10:00.000Z';

describe('withTimerStarted', () => {
  it('adds a timer to an empty session', () => {
    expect(withTimerStarted(session([]), 's1', T1, false).activeTimers).toEqual([
      { stepId: 's1', endsAt: T1, notify: false },
    ]);
  });

  it('carries the endsAt and notify flag through verbatim', () => {
    const [entry] = withTimerStarted(session([]), 's7', T3, true).activeTimers;
    expect(entry).toEqual({ stepId: 's7', endsAt: T3, notify: true });
  });

  it('keeps timers running on other steps', () => {
    const next = withTimerStarted(session([timer('s1', T1)]), 's2', T2, true);
    expect(next.activeTimers).toEqual([
      { stepId: 's1', endsAt: T1, notify: false },
      { stepId: 's2', endsAt: T2, notify: true },
    ]);
  });

  it('REPLACES an existing timer for the same step — one live timer per step', () => {
    const next = withTimerStarted(session([timer('s1', T1)]), 's1', T2, true);
    expect(next.activeTimers).toEqual([{ stepId: 's1', endsAt: T2, notify: true }]);
  });

  it('moves a restarted step to the end of the list', () => {
    // The timers bar reads in list order, so the freshly started one lands last.
    const next = withTimerStarted(session([timer('s1', T1), timer('s2', T2)]), 's1', T3, false);
    expect(next.activeTimers.map((t) => t.stepId)).toEqual(['s2', 's1']);
  });

  it('is pure — never mutates the input session', () => {
    const s = session([timer('s1', T1)]);
    withTimerStarted(s, 's2', T2, false);
    withTimerStarted(s, 's1', T3, true);
    expect(s.activeTimers).toEqual([{ stepId: 's1', endsAt: T1, notify: false }]);
  });

  it('does not stamp updatedAt or disturb tick / step state', () => {
    const s = session([]);
    const next = withTimerStarted(s, 's1', T1, false);
    expect(next.updatedAt).toBe(s.updatedAt);
    expect(next.checkedIngredientIds).toEqual(s.checkedIngredientIds);
    expect(next.completedStepIds).toEqual(s.completedStepIds);
  });
});

describe('withTimerDismissed', () => {
  it('removes the timer for the given step', () => {
    expect(withTimerDismissed(session([timer('s1', T1)]), 's1').activeTimers).toEqual([]);
  });

  it('leaves every other step’s timer running', () => {
    const next = withTimerDismissed(session([timer('s1', T1), timer('s2', T2)]), 's1');
    expect(next.activeTimers).toEqual([{ stepId: 's2', endsAt: T2, notify: false }]);
  });

  it('is idempotent — dismissing an unknown step changes nothing', () => {
    const next = withTimerDismissed(session([timer('s1', T1)]), 's9');
    expect(next.activeTimers).toEqual([{ stepId: 's1', endsAt: T1, notify: false }]);
  });

  it('handles a session with no timers at all', () => {
    expect(withTimerDismissed(session([]), 's1').activeTimers).toEqual([]);
  });

  it('is pure — never mutates the input session', () => {
    const s = session([timer('s1', T1)]);
    withTimerDismissed(s, 's1');
    expect(s.activeTimers).toHaveLength(1);
  });

  it('does not stamp updatedAt', () => {
    const s = session([timer('s1', T1)]);
    expect(withTimerDismissed(s, 's1').updatedAt).toBe(s.updatedAt);
  });
});
