import { describe, it, expect } from 'vitest';
import { scheduleFor, type Recipe } from '@salt/domain';

// A meal's cook plan (issue #752, phase 4): one serve time, and every dish worked
// backwards from it so they all finish together. Pure — the clock is injected as
// `serveAtMs`, so no fake timers are needed here either.

function dish(id: string, cookTimeMinutes: number | null): Recipe {
  return {
    id,
    title: id,
    kind: 'recipe',
    componentRecipeIds: [],
    metadata: { servings: 4, cookTimeMinutes },
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
    const rows = [dish('chicken', 90), dish('potatoes', 50), dish('gravy', 10)];
    expect(scheduleFor(rows, SERVE_AT)).toEqual([
      { recipeId: 'chicken', startAtMs: at('2026-08-16T17:30:00.000Z') },
      { recipeId: 'potatoes', startAtMs: at('2026-08-16T18:10:00.000Z') },
      { recipeId: 'gravy', startAtMs: at('2026-08-16T18:50:00.000Z') },
    ]);
  });

  it('answers null for every row while no serve time is set', () => {
    const rows = [dish('chicken', 90), dish('gravy', 10)];
    expect(scheduleFor(rows, null)).toEqual([
      { recipeId: 'chicken', startAtMs: null },
      { recipeId: 'gravy', startAtMs: null },
    ]);
  });

  it('KEEPS a dish with no cook time, answering null for it — "start when you like"', () => {
    // Dropping the row would hide a dish from the plan for the crime of having an
    // incomplete recipe. The meal still has to be cooked.
    const rows = [dish('chicken', 90), dish('salad', null), dish('gravy', 10)];
    const out = scheduleFor(rows, SERVE_AT);
    expect(out.map((r) => r.recipeId)).toEqual(['chicken', 'salad', 'gravy']);
    expect(out[1]).toEqual({ recipeId: 'salad', startAtMs: null });
  });

  it('NEVER SORTS — input order is the running order the user dragged', () => {
    // Deliberately shortest-first, which is the reverse of what a helpful sort
    // would do. A later attach must not silently undo an afternoon of arranging.
    const rows = [dish('gravy', 10), dish('chicken', 90), dish('potatoes', 50)];
    expect(scheduleFor(rows, SERVE_AT).map((r) => r.recipeId)).toEqual([
      'gravy',
      'chicken',
      'potatoes',
    ]);
  });

  it('returns an empty schedule for an empty meal', () => {
    expect(scheduleFor([], SERVE_AT)).toEqual([]);
  });

  it('is pure: same inputs, same output, and nothing is mutated', () => {
    const rows = [dish('chicken', 90), dish('gravy', 10)];
    const before = JSON.stringify(rows);

    const first = scheduleFor(rows, SERVE_AT);
    const second = scheduleFor(rows, SERVE_AT);

    expect(second).toEqual(first);
    expect(JSON.stringify(rows)).toBe(before);
  });
});
