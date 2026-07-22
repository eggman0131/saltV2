import { describe, it, expect } from 'vitest';
import { firstUseByStep } from '@salt/domain';
import type { IngredientDoc, IngredientGroupDoc } from '@salt/domain/schemas';

// Ingredients grouped by the step they are first needed in (issue #556), so a
// guided step can surface exactly the items it introduces.

function ingredient(id: string, firstUsedInStepId: string | null): IngredientDoc {
  return {
    id,
    rawText: `${id} raw text`,
    parsed: null,
    canonId: null,
    matchState: 'pending',
    isOptional: false,
    firstUsedInStepId,
  };
}

function group(id: string, items: IngredientDoc[]): IngredientGroupDoc {
  return { id, name: null, items };
}

describe('firstUseByStep', () => {
  it('returns an empty map for a recipe with no ingredients', () => {
    expect(firstUseByStep([]).size).toBe(0);
  });

  it('returns an empty map when a group has no items', () => {
    expect(firstUseByStep([group('g1', [])]).size).toBe(0);
  });

  it('keys each ingredient by its first-use step', () => {
    const a = ingredient('i1', 's1');
    const b = ingredient('i2', 's2');
    const map = firstUseByStep([group('g1', [a, b])]);
    expect(map.get('s1')).toEqual([a]);
    expect(map.get('s2')).toEqual([b]);
  });

  it('collects several ingredients onto the same step, in recipe order', () => {
    const a = ingredient('i1', 's1');
    const b = ingredient('i2', 's1');
    const c = ingredient('i3', 's1');
    expect(firstUseByStep([group('g1', [a, b, c])]).get('s1')).toEqual([a, b, c]);
  });

  it('OMITS ingredients with no first-use step — they are mise-only', () => {
    const used = ingredient('i1', 's1');
    const unused = ingredient('i2', null);
    const map = firstUseByStep([group('g1', [used, unused])]);
    expect(map.get('s1')).toEqual([used]);
    expect([...map.values()].flat()).not.toContain(unused);
  });

  it('has no entry at all for a step that introduces nothing', () => {
    const map = firstUseByStep([group('g1', [ingredient('i1', 's1')])]);
    expect(map.has('s2')).toBe(false);
    expect(map.get('s2')).toBeUndefined();
  });

  it('walks groups in order, so a step spanning groups keeps recipe order', () => {
    const fromFirstGroup = ingredient('i1', 's1');
    const fromSecondGroup = ingredient('i2', 's1');
    const map = firstUseByStep([group('g1', [fromFirstGroup]), group('g2', [fromSecondGroup])]);
    expect(map.get('s1')).toEqual([fromFirstGroup, fromSecondGroup]);
  });

  it('is pure — does not mutate the input groups', () => {
    const items = [ingredient('i1', 's1')];
    const groups = [group('g1', items)];
    firstUseByStep(groups);
    expect(groups).toHaveLength(1);
    expect(items).toHaveLength(1);
    expect(groups[0]?.items).toBe(items);
  });

  it('is deterministic — identical input yields an identical map', () => {
    const groups = [group('g1', [ingredient('i1', 's1'), ingredient('i2', 's1')])];
    expect(firstUseByStep(groups)).toEqual(firstUseByStep(groups));
  });
});
