import { describe, it, expect } from 'vitest';
import { miseProgress } from '@salt/domain';
import type { IngredientDoc, IngredientGroupDoc } from '@salt/domain/schemas';

// Mise-en-place progress (issue #556), counted over the RECIPE rather than over
// the session's id list — stale ids for edited-out ingredients must not inflate
// the count or make an incomplete list read as fully ticked.

function ingredient(id: string): IngredientDoc {
  return {
    id,
    rawText: `${id} raw text`,
    parsed: null,
    canonId: null,
    matchState: 'pending',
    isOptional: false,
    firstUsedInStepId: null,
  };
}

function group(id: string, itemIds: string[]): IngredientGroupDoc {
  return { id, name: null, items: itemIds.map(ingredient) };
}

const GROUPS = [group('g1', ['i1', 'i2']), group('g2', ['i3'])];

describe('miseProgress', () => {
  // [label, checked ids, total, checked, allChecked]
  const cases: Array<[string, string[], number, number, boolean]> = [
    ['nothing ticked', [], 3, 0, false],
    ['one ticked', ['i1'], 3, 1, false],
    ['two ticked, across one group', ['i1', 'i2'], 3, 2, false],
    ['two ticked, spanning groups', ['i1', 'i3'], 3, 2, false],
    ['everything ticked', ['i1', 'i2', 'i3'], 3, 3, true],
    // Stale ids: ticked ingredients since edited out of the recipe.
    ['a stale id only', ['gone'], 3, 0, false],
    ['live and stale ids mixed', ['i1', 'gone'], 3, 1, false],
    ['all live ids plus a stale one still reads complete', ['i1', 'i2', 'i3', 'gone'], 3, 3, true],
  ];

  it.each(cases)('%s', (_label, checked, total, checkedCount, allChecked) => {
    expect(miseProgress(GROUPS, new Set(checked))).toEqual({
      total,
      checked: checkedCount,
      allChecked,
    });
  });

  it('counts across every group', () => {
    const groups = [group('g1', ['a', 'b']), group('g2', ['c', 'd']), group('g3', ['e'])];
    expect(miseProgress(groups, new Set()).total).toBe(5);
  });

  it('reports nothing for a recipe with no ingredients — and NOT allChecked', () => {
    // "0 of 0 ready" is not an accomplishment, and the bulk-tick control it
    // drives has nothing to tick.
    expect(miseProgress([], new Set())).toEqual({ total: 0, checked: 0, allChecked: false });
  });

  it('is not fooled into allChecked by stale ids on an empty recipe', () => {
    expect(miseProgress([], new Set(['gone']))).toEqual({
      total: 0,
      checked: 0,
      allChecked: false,
    });
  });

  it('skips empty groups without disturbing the count', () => {
    const groups = [group('g1', ['i1']), group('empty', []), group('g2', ['i2'])];
    expect(miseProgress(groups, new Set(['i1']))).toEqual({
      total: 2,
      checked: 1,
      allChecked: false,
    });
  });

  it('is pure — does not mutate the groups or the checked set', () => {
    const groups = [group('g1', ['i1'])];
    const checked = new Set(['i1']);
    miseProgress(groups, checked);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(1);
    expect([...checked]).toEqual(['i1']);
  });
});
