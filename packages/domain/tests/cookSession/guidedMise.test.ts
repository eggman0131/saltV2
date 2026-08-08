import { describe, it, expect } from 'vitest';
import { guidedMiseProgress, unpreppedIngredients } from '@salt/domain';
import type { Recipe } from '@salt/domain';
import type { GuidedPlanDoc, GuidedPrepEntryDoc, IngredientDoc } from '@salt/domain/schemas';

// The two pure questions guided mise asks (issue #751, Phase 2): what the plan
// accounts for nowhere ("Also get out"), and how much of the resulting screen is
// ticked.

function ingredient(id: string, over: Partial<IngredientDoc> = {}): IngredientDoc {
  return {
    id,
    rawText: `${id} of something`,
    parsed: null,
    canonId: null,
    matchState: 'matched',
    isOptional: false,
    firstUsedInStepId: null,
    ...over,
  };
}

function recipe(
  groups: Array<{ id: string; name: string | null; items: IngredientDoc[] }>,
): Recipe {
  return {
    id: 'r1',
    schemaVersion: 1,
    kind: 'recipe',
    title: 'Weeknight ragù',
    description: null,
    ingredients: groups,
    steps: [],
    metadata: {
      servings: null,
      totalTimeMinutes: null,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      tags: [],
    },
    source: null,
    notes: null,
    producesCanonId: null,
    image: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
  };
}

function prep(id: string, ingredientIds: string[]): GuidedPrepEntryDoc {
  return { id, text: `do ${id}`, container: 'small bowl', ingredientIds };
}

function plan(entries: GuidedPrepEntryDoc[]): GuidedPlanDoc {
  return {
    id: 'r1',
    schemaVersion: 1,
    recipeId: 'r1',
    recipeUpdatedAtAtSave: '2026-08-01T09:00:00.000Z',
    prep: entries,
    stepNotes: [],
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
  };
}

describe('unpreppedIngredients', () => {
  it('is empty when every ingredient is named in some prep job', () => {
    const r = recipe([{ id: 'g1', name: null, items: [ingredient('i1'), ingredient('i2')] }]);
    expect(unpreppedIngredients(r, plan([prep('p1', ['i1']), prep('p2', ['i2'])]))).toEqual([]);
  });

  it('lists an ingredient the plan predates, in the recipe-s own order', () => {
    const r = recipe([
      { id: 'g1', name: 'For the sauce', items: [ingredient('i1'), ingredient('i2')] },
      { id: 'g2', name: 'To serve', items: [ingredient('i3')] },
    ]);
    const result = unpreppedIngredients(r, plan([prep('p1', ['i2'])]));
    expect(result.map((i) => i.id)).toEqual(['i1', 'i3']);
  });

  it('counts an ingredient once however many jobs claim it (duplicate ids)', () => {
    const r = recipe([{ id: 'g1', name: null, items: [ingredient('i1'), ingredient('i2')] }]);
    const result = unpreppedIngredients(r, plan([prep('p1', ['i1']), prep('p2', ['i1'])]));
    expect(result.map((i) => i.id)).toEqual(['i2']);
  });

  it('ignores an id for an ingredient the recipe no longer has', () => {
    const r = recipe([{ id: 'g1', name: null, items: [ingredient('i1')] }]);
    const result = unpreppedIngredients(r, plan([prep('p1', ['i-gone'])]));
    expect(result.map((i) => i.id)).toEqual(['i1']);
  });

  it('INCLUDES optional ingredients — the section is the floor normal mise gives', () => {
    const r = recipe([
      { id: 'g1', name: null, items: [ingredient('i1'), ingredient('i2', { isOptional: true })] },
    ]);
    const result = unpreppedIngredients(r, plan([]));
    expect(result.map((i) => i.id)).toEqual(['i1', 'i2']);
  });

  it('returns every ingredient when the plan has no prep at all', () => {
    const r = recipe([{ id: 'g1', name: null, items: [ingredient('i1'), ingredient('i2')] }]);
    expect(unpreppedIngredients(r, plan([])).map((i) => i.id)).toEqual(['i1', 'i2']);
  });

  it('skips empty groups without tripping over them', () => {
    const r = recipe([
      { id: 'g0', name: 'Empty', items: [] },
      { id: 'g1', name: null, items: [ingredient('i1')] },
    ]);
    expect(unpreppedIngredients(r, plan([])).map((i) => i.id)).toEqual(['i1']);
  });
});

describe('guidedMiseProgress', () => {
  const PREP = [prep('p1', ['i1']), prep('p2', ['i2'])];
  const REMAINDER = [ingredient('i3')];

  it('counts prep jobs and the remainder as one list', () => {
    expect(guidedMiseProgress(PREP, REMAINDER, new Set(['p1']))).toEqual({
      total: 3,
      checked: 1,
      allChecked: false,
    });
  });

  it('is allChecked only when every row on the screen is ticked', () => {
    expect(guidedMiseProgress(PREP, REMAINDER, new Set(['p1', 'p2']))).toMatchObject({
      checked: 2,
      allChecked: false,
    });
    expect(guidedMiseProgress(PREP, REMAINDER, new Set(['p1', 'p2', 'i3']))).toEqual({
      total: 3,
      checked: 3,
      allChecked: true,
    });
  });

  it('a plan in sync has no remainder and can still finish', () => {
    expect(guidedMiseProgress(PREP, [], new Set(['p1', 'p2']))).toEqual({
      total: 2,
      checked: 2,
      allChecked: true,
    });
  });

  it('"0 of 0 ready" is not an accomplishment', () => {
    expect(guidedMiseProgress([], [], new Set())).toEqual({
      total: 0,
      checked: 0,
      allChecked: false,
    });
  });

  it('is not fooled into allChecked by stale ids on an empty plan', () => {
    expect(guidedMiseProgress([], [], new Set(['p-gone']))).toEqual({
      total: 0,
      checked: 0,
      allChecked: false,
    });
  });

  it('counts over the plan, not over the tick list — stale ids never inflate it', () => {
    expect(guidedMiseProgress(PREP, [], new Set(['p1', 'p-gone', 'i-gone']))).toEqual({
      total: 2,
      checked: 1,
      allChecked: false,
    });
  });

  it('is pure — reads its inputs and writes nothing', () => {
    const checked = new Set(['p1']);
    guidedMiseProgress(PREP, REMAINDER, checked);
    expect([...checked]).toEqual(['p1']);
    expect(PREP.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});
