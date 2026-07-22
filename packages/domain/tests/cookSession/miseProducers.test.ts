import { describe, it, expect } from 'vitest';
import { withIngredientChecked, withAllIngredientsChecked } from '@salt/domain';
import type { CookSessionDoc } from '@salt/domain/schemas';

// Mise-en-place tick state (issue #556): the single toggle and the symmetric
// bulk tick. Both immutable, neither stamps `updatedAt`.

function session(checkedIngredientIds: string[]): CookSessionDoc {
  return {
    id: 'r1_u1',
    schemaVersion: 1,
    ownerUid: 'u1',
    recipeId: 'r1',
    recipeUpdatedAtAtStart: '2026-07-01T09:00:00.000Z',
    checkedIngredientIds,
    completedStepIds: ['s1'],
    activeTimers: [{ stepId: 's1', endsAt: '2026-07-22T18:35:00.000Z', notify: true }],
    createdAt: '2026-07-22T18:30:00.000Z',
    updatedAt: '2026-07-22T18:30:00.000Z',
  };
}

describe('withIngredientChecked', () => {
  // [starting checked ids, toggled id, expected checked ids]
  const cases: Array<[string[], string, string[]]> = [
    [[], 'i1', ['i1']],
    [['i1'], 'i2', ['i1', 'i2']],
    [['i1'], 'i1', []],
    [['i1', 'i2', 'i3'], 'i2', ['i1', 'i3']],
    [['i1', 'i2'], 'i3', ['i1', 'i2', 'i3']],
  ];

  it.each(cases)('%j toggled by %s = %j', (start, id, expected) => {
    expect(withIngredientChecked(session(start), id).checkedIngredientIds).toEqual(expected);
  });

  it('round-trips: toggling the same id twice restores the original set', () => {
    const s = session(['i1', 'i2']);
    const there = withIngredientChecked(s, 'i3');
    const back = withIngredientChecked(there, 'i3');
    expect(back.checkedIngredientIds).toEqual(s.checkedIngredientIds);
  });

  it('is pure — never mutates the input session', () => {
    const s = session(['i1']);
    withIngredientChecked(s, 'i2');
    withIngredientChecked(s, 'i1');
    expect(s.checkedIngredientIds).toEqual(['i1']);
  });

  it('returns a new session and leaves updatedAt / step state alone', () => {
    const s = session([]);
    const next = withIngredientChecked(s, 'i1');
    expect(next).not.toBe(s);
    expect(next.updatedAt).toBe(s.updatedAt);
    expect(next.completedStepIds).toEqual(s.completedStepIds);
    expect(next.activeTimers).toEqual(s.activeTimers);
  });
});

describe('withAllIngredientsChecked', () => {
  const ALL = ['i1', 'i2', 'i3'];

  it('ticks everything when not everything is currently ticked', () => {
    expect(withAllIngredientsChecked(session(['i1']), ALL, false).checkedIngredientIds).toEqual(
      ALL,
    );
  });

  it('clears everything when everything is currently ticked (symmetric)', () => {
    expect(withAllIngredientsChecked(session(ALL), ALL, true).checkedIngredientIds).toEqual([]);
  });

  it('ticks from an empty start', () => {
    expect(withAllIngredientsChecked(session([]), ALL, false).checkedIngredientIds).toEqual(ALL);
  });

  it('replaces rather than merges — stale ids for deleted ingredients are dropped', () => {
    // 'gone' refers to an ingredient edited out of the recipe since the session
    // started; a bulk tick is a clean rewrite of the whole set.
    const next = withAllIngredientsChecked(session(['gone']), ALL, false);
    expect(next.checkedIngredientIds).toEqual(ALL);
    expect(next.checkedIngredientIds).not.toContain('gone');
  });

  it('copies the id list instead of aliasing the caller’s array', () => {
    const allIds = [...ALL];
    const next = withAllIngredientsChecked(session([]), allIds, false);
    expect(next.checkedIngredientIds).not.toBe(allIds);
  });

  it('is pure — never mutates the input session', () => {
    const s = session(['i1']);
    withAllIngredientsChecked(s, ALL, false);
    expect(s.checkedIngredientIds).toEqual(['i1']);
  });

  it('does not stamp updatedAt', () => {
    const s = session([]);
    expect(withAllIngredientsChecked(s, ALL, false).updatedAt).toBe(s.updatedAt);
  });
});
