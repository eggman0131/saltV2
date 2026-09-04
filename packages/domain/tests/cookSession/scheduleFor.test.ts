import { describe, it, expect } from 'vitest';
import { scheduleFor, type Recipe, type RecipePhase } from '@salt/domain';

// A meal's cook plan (issue #752, phase 4): one serve time, and every dish worked
// backwards from it so they all finish together. Pure — the clock is injected as
// `serveAtMs`, so no fake timers are needed here either.
//
// Issue #1233 moved the figure it works back from onto the phase strip, so what is
// pinned below is the arithmetic AND the three contracts that did not move:
// null-is-an-answer, it-does-not-sort, and one-rule-per-row.

function phase(handsOnMinutes: number, handsOffMinutes: number): RecipePhase {
  return { label: 'block', handsOnMinutes, handsOffMinutes };
}

/** `phases: undefined` is the pre-#1122 document; `[]` is the empty strip. */
function dish(id: string, phases: RecipePhase[] | undefined): Recipe {
  return {
    id,
    title: id,
    kind: 'recipe',
    componentRecipeIds: [],
    // The strip is the only timing a recipe carries (#1211), so every expectation
    // below is reachable from it and from nothing else.
    metadata: { servings: 4, phases },
    ingredients: [],
    steps: [],
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
  } as unknown as Recipe;
}

// The issue's own worked example: a Sunday roast served at 19:00.
const SERVE_AT = Date.parse('2026-08-16T19:00:00.000Z');
const at = (iso: string) => Date.parse(iso);

describe('scheduleFor', () => {
  it('is the issue’s worked example: 1 h 30 m → 17:30, 50 m → 18:10, 10 m → 18:50', () => {
    const rows = [
      dish('chicken', [phase(10, 80)]),
      dish('potatoes', [phase(10, 20), phase(5, 15)]),
      dish('gravy', [phase(10, 0)]),
    ];
    expect(scheduleFor(rows, SERVE_AT)).toEqual([
      { recipeId: 'chicken', startAtMs: at('2026-08-16T17:30:00.000Z') },
      { recipeId: 'potatoes', startAtMs: at('2026-08-16T18:10:00.000Z') },
      { recipeId: 'gravy', startAtMs: at('2026-08-16T18:50:00.000Z') },
    ]);
  });

  it('WORKS BACK FROM THE WHOLE PROCESS, not the cooking alone (#953)', () => {
    // The behaviour change #1233 carries `breaking-change` for. A roast whose strip
    // is 25 min of preparation and 90 min in the oven starts at 17:05 for a 19:00
    // serve, not the 17:30 the old stored cook time gave.
    const rows = [dish('roast', [phase(25, 0), phase(5, 85)])];
    expect(scheduleFor(rows, SERVE_AT)[0]).toEqual({
      recipeId: 'roast',
      startAtMs: at('2026-08-16T17:05:00.000Z'),
    });
  });

  it('answers null for every row while no serve time is set', () => {
    const rows = [dish('chicken', [phase(10, 80)]), dish('gravy', [phase(10, 0)])];
    expect(scheduleFor(rows, null)).toEqual([
      { recipeId: 'chicken', startAtMs: null },
      { recipeId: 'gravy', startAtMs: null },
    ]);
  });

  it('KEEPS a dish with no phase strip, answering null for it — "start when you like"', () => {
    // NULL IS AN ANSWER, NOT AN ERROR. Dropping the row would hide a dish from the
    // plan for the crime of having an incomplete recipe. The meal still has to be
    // cooked. Both no-strip states — the key absent, and an empty list — answer the
    // same way.
    const rows = [
      dish('chicken', [phase(10, 80)]),
      dish('salad', undefined),
      dish('bread', []),
      dish('gravy', [phase(10, 0)]),
    ];
    const out = scheduleFor(rows, SERVE_AT);
    expect(out.map((r) => r.recipeId)).toEqual(['chicken', 'salad', 'bread', 'gravy']);
    expect(out[1]).toEqual({ recipeId: 'salad', startAtMs: null });
    expect(out[2]).toEqual({ recipeId: 'bread', startAtMs: null });
  });

  it('reads a strip zeroed by hand as "start at serve time", never as unknown', () => {
    // `hasPhases`, not `elapsedMinutes >= 1`: a cook who typed three named blocks
    // and zeroed them has stated a timing of nothing, which is a different answer
    // from having stated nothing at all.
    const rows = [dish('assembly', [phase(0, 0), phase(0, 0)])];
    expect(scheduleFor(rows, SERVE_AT)[0]).toEqual({
      recipeId: 'assembly',
      startAtMs: SERVE_AT,
    });
  });

  it('NEVER SORTS — input order is the running order the user dragged', () => {
    // Deliberately shortest-first, which is the reverse of what a helpful sort
    // would do. A later attach must not silently undo an afternoon of arranging.
    const rows = [
      dish('gravy', [phase(10, 0)]),
      dish('chicken', [phase(10, 80)]),
      dish('potatoes', [phase(10, 40)]),
    ];
    expect(scheduleFor(rows, SERVE_AT).map((r) => r.recipeId)).toEqual([
      'gravy',
      'chicken',
      'potatoes',
    ]);
  });

  it('applies ONE RULE PER ROW — a row’s answer never depends on its neighbours', () => {
    // Per-row independent: the same dish scheduled alone and scheduled in company
    // gets the same instant, so nothing here has quietly become an aggregation.
    const chicken = dish('chicken', [phase(10, 80)]);
    const alone = scheduleFor([chicken], SERVE_AT);
    const inCompany = scheduleFor([dish('gravy', [phase(10, 0)]), chicken], SERVE_AT);
    expect(inCompany[1]).toEqual(alone[0]);
  });

  it('returns an empty schedule for an empty meal', () => {
    expect(scheduleFor([], SERVE_AT)).toEqual([]);
  });

  it('is pure: same inputs, same output, and nothing is mutated', () => {
    const rows = [dish('chicken', [phase(10, 80)]), dish('gravy', [phase(10, 0)])];
    const before = JSON.stringify(rows);

    const first = scheduleFor(rows, SERVE_AT);
    const second = scheduleFor(rows, SERVE_AT);

    expect(second).toEqual(first);
    expect(JSON.stringify(rows)).toBe(before);
  });
});
