import { describe, it, expect } from 'vitest';
import { guidedMiseProgress, guidedPrepBoard, unpreppedIngredients } from '@salt/domain';
import type { Recipe } from '@salt/domain';
import type { GuidedPlanDoc, GuidedPrepEntryDoc, IngredientDoc } from '@salt/domain/schemas';

// The pure questions guided mise asks: what the plan accounts for nowhere ("Also
// get out", issue #751 Phase 2), how the bench is laid out (`guidedPrepBoard`,
// issue #767), and how much of the resulting screen is ticked.

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

function prep(
  id: string,
  ingredientIds: string[],
  container: string | null = 'small bowl',
): GuidedPrepEntryDoc {
  return { id, text: `do ${id}`, container, ingredientIds };
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

describe('guidedPrepBoard', () => {
  const R = recipe([
    { id: 'g1', name: null, items: [ingredient('i1'), ingredient('i2'), ingredient('i3')] },
  ]);

  it('gives one card per container, in the order the plan first names each', () => {
    const board = guidedPrepBoard(R, [
      prep('p1', ['i1'], 'jug'),
      prep('p2', ['i2'], 'small bowl'),
      prep('p3', ['i3'], 'jug'),
    ]);
    expect(board.map((g) => g.name)).toEqual(['jug', 'small bowl']);
    expect(board[0]!.jobs.map((j) => j.entry.id)).toEqual(['p1', 'p3']);
  });

  it('groups two spellings of the same bowl into one card, under the name as authored', () => {
    const board = guidedPrepBoard(R, [
      prep('p1', ['i1'], 'Onion  Bowl'),
      prep('p2', ['i2'], 'onion bowl'),
    ]);
    expect(board).toHaveLength(1);
    expect(board[0]!.key).toBe('onion bowl');
    // The words the plan says, from the job that said them first — never the
    // normalised form, which is a matching key and not a label.
    expect(board[0]!.name).toBe('Onion  Bowl');
  });

  it('collects every job that sets nothing aside into ONE unheaded card', () => {
    const board = guidedPrepBoard(R, [
      prep('p1', ['i1'], null),
      prep('p2', ['i2'], 'jug'),
      prep('p3', ['i3'], '   '),
    ]);
    expect(board.map((g) => g.key)).toEqual(['', 'jug']);
    expect(board[0]!.name).toBeNull();
    expect(board[0]!.jobs.map((j) => j.entry.id)).toEqual(['p1', 'p3']);
  });

  it('ticks a job by its INGREDIENTS, in recipe order, with the recipe-s amounts', () => {
    const board = guidedPrepBoard(R, [prep('p1', ['i3', 'i1'])]);
    const job = board[0]!.jobs[0]!;
    expect(job.ingredients.map((i) => i.id)).toEqual(['i1', 'i3']);
    expect(job.tickIds).toEqual(['i1', 'i3']);
  });

  it('ticks a job that prepares nothing by its own id — it has nothing else', () => {
    const board = guidedPrepBoard(R, [prep('p1', [])]);
    expect(board[0]!.jobs[0]!.ingredients).toEqual([]);
    expect(board[0]!.jobs[0]!.tickIds).toEqual(['p1']);
  });

  it('falls back to the job-s own id when every id it holds is for a lost ingredient', () => {
    // Otherwise the job would have no tick at all and could never be cleared.
    const board = guidedPrepBoard(R, [prep('p1', ['i-gone'])]);
    expect(board[0]!.jobs[0]!.tickIds).toEqual(['p1']);
  });

  it('drops an id the recipe no longer has, keeping the ones it still does', () => {
    const board = guidedPrepBoard(R, [prep('p1', ['i1', 'i-gone'])]);
    expect(board[0]!.jobs[0]!.tickIds).toEqual(['i1']);
  });

  it('flattens the card-s ticks, which is what "is this bowl done?" is asked of', () => {
    const board = guidedPrepBoard(R, [prep('p1', ['i1'], 'jug'), prep('p2', ['i2', 'i3'], 'jug')]);
    expect(board[0]!.tickIds).toEqual(['i1', 'i2', 'i3']);
  });

  it('is empty for a plan with no prep at all', () => {
    expect(guidedPrepBoard(R, [])).toEqual([]);
  });

  it('is pure — reads its inputs and writes nothing', () => {
    const entries = [prep('p1', ['i1'])];
    guidedPrepBoard(R, entries);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.ingredientIds).toEqual(['i1']);
  });
});

describe('guidedMiseProgress', () => {
  const R = recipe([
    {
      id: 'g1',
      name: null,
      items: [ingredient('i1'), ingredient('i2'), ingredient('i3'), ingredient('i4')],
    },
  ]);
  const BOARD = guidedPrepBoard(R, [prep('p1', ['i1', 'i2']), prep('p2', [])]);
  const REMAINDER = [ingredient('i4')];

  it('counts TICK ROWS — a job that dices two things is two of them', () => {
    expect(guidedMiseProgress(BOARD, REMAINDER, new Set(['i1']))).toEqual({
      total: 4,
      checked: 1,
      allChecked: false,
    });
  });

  it('is allChecked only when every row on the screen is ticked', () => {
    expect(guidedMiseProgress(BOARD, REMAINDER, new Set(['i1', 'i2', 'p2']))).toMatchObject({
      checked: 3,
      allChecked: false,
    });
    expect(guidedMiseProgress(BOARD, REMAINDER, new Set(['i1', 'i2', 'p2', 'i4']))).toEqual({
      total: 4,
      checked: 4,
      allChecked: true,
    });
  });

  it('a plan in sync has no remainder and can still finish', () => {
    expect(guidedMiseProgress(BOARD, [], new Set(['i1', 'i2', 'p2']))).toEqual({
      total: 3,
      checked: 3,
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

  it('counts over the bench, not over the tick list — stale ids never inflate it', () => {
    expect(guidedMiseProgress(BOARD, [], new Set(['i1', 'p-gone', 'i-gone']))).toEqual({
      total: 3,
      checked: 1,
      allChecked: false,
    });
  });

  it('is pure — reads its inputs and writes nothing', () => {
    const checked = new Set(['i1']);
    guidedMiseProgress(BOARD, REMAINDER, checked);
    expect([...checked]).toEqual(['i1']);
    expect(BOARD.map((g) => g.key)).toEqual(['small bowl']);
  });
});
