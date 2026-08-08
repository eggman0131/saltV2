import { describe, it, expect } from 'vitest';
import { withTimerStarted, withTimerDismissed } from '@salt/domain';
import type { CookActiveTimerDoc, CookSessionDoc } from '@salt/domain/schemas';

// Step timers (issue #556, widened in #748). `endsAt` is an ABSOLUTE end-time
// supplied by the caller — the module never computes it from a clock — which is
// what lets a reload reconstruct the remaining time. The whole entry comes from
// the caller, and `id` is its identity: one live timer per id (and since a step
// timer's id IS its step id, that still means one live timer per step).

function timer(id: string, endsAt: string, overrides: Partial<CookActiveTimerDoc> = {}) {
  return {
    id,
    stepId: id,
    label: null,
    durationMinutes: null,
    endsAt,
    notify: false,
    ...overrides,
  } satisfies CookActiveTimerDoc;
}

function session(activeTimers: CookActiveTimerDoc[]): CookSessionDoc {
  return {
    id: 'r1_u1',
    schemaVersion: 1,
    ownerUid: 'u1',
    recipeId: 'r1',
    recipeUpdatedAtAtStart: '2026-07-01T09:00:00.000Z',
    checkedIngredientIds: ['i1'],
    checkedPrepIds: [],
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
    expect(withTimerStarted(session([]), timer('s1', T1)).activeTimers).toEqual([timer('s1', T1)]);
  });

  it('carries the whole entry through verbatim', () => {
    const entry = timer('s7', T3, {
      notify: true,
      label: 'Simmer the sauce',
      durationMinutes: 25,
    });
    const [written] = withTimerStarted(session([]), entry).activeTimers;
    expect(written).toEqual(entry);
  });

  it('carries an ad-hoc timer — minted id, no step — through untouched', () => {
    const adHoc = timer('adhoc-1', T2, { stepId: null, label: 'Rice', durationMinutes: 12 });
    expect(withTimerStarted(session([]), adHoc).activeTimers).toEqual([adHoc]);
  });

  it('keeps timers running under other ids', () => {
    const next = withTimerStarted(session([timer('s1', T1)]), timer('s2', T2, { notify: true }));
    expect(next.activeTimers).toEqual([timer('s1', T1), timer('s2', T2, { notify: true })]);
  });

  it('REPLACES an existing timer with the same id — one live timer per id', () => {
    const restarted = timer('s1', T2, { notify: true, durationMinutes: 9 });
    const next = withTimerStarted(session([timer('s1', T1)]), restarted);
    expect(next.activeTimers).toEqual([restarted]);
  });

  it('moves a restarted timer to the end of the list', () => {
    // The timers bar reads in list order, so the freshly started one lands last.
    const next = withTimerStarted(session([timer('s1', T1), timer('s2', T2)]), timer('s1', T3));
    expect(next.activeTimers.map((t) => t.id)).toEqual(['s2', 's1']);
  });

  it('is pure — never mutates the input session', () => {
    const s = session([timer('s1', T1)]);
    withTimerStarted(s, timer('s2', T2));
    withTimerStarted(s, timer('s1', T3, { notify: true }));
    expect(s.activeTimers).toEqual([timer('s1', T1)]);
  });

  it('does not stamp updatedAt or disturb tick / step state', () => {
    const s = session([]);
    const next = withTimerStarted(s, timer('s1', T1));
    expect(next.updatedAt).toBe(s.updatedAt);
    expect(next.checkedIngredientIds).toEqual(s.checkedIngredientIds);
    expect(next.completedStepIds).toEqual(s.completedStepIds);
  });
});

describe('withTimerDismissed', () => {
  it('removes the timer with the given id', () => {
    expect(withTimerDismissed(session([timer('s1', T1)]), 's1').activeTimers).toEqual([]);
  });

  it('removes an ad-hoc timer by its minted id', () => {
    const adHoc = timer('adhoc-1', T2, { stepId: null });
    const next = withTimerDismissed(session([timer('s1', T1), adHoc]), 'adhoc-1');
    expect(next.activeTimers).toEqual([timer('s1', T1)]);
  });

  it('leaves every other timer running', () => {
    const next = withTimerDismissed(session([timer('s1', T1), timer('s2', T2)]), 's1');
    expect(next.activeTimers).toEqual([timer('s2', T2)]);
  });

  it('is idempotent — dismissing an unknown id changes nothing', () => {
    const next = withTimerDismissed(session([timer('s1', T1)]), 's9');
    expect(next.activeTimers).toEqual([timer('s1', T1)]);
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
