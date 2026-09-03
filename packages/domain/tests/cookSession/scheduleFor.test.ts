import { describe, it, expect } from 'vitest';
import {
  insertComponentByCookTime,
  recipePhaseTotals,
  scheduleFor,
  type Recipe,
  type RecipePhase,
} from '@salt/domain';

// A meal's cook plan (issue #752, phase 4): one serve time, and every dish worked
// backwards from it so they all finish together. Pure — the clock is injected as
// `serveAtMs`, so no fake timers are needed here either.
//
// Since #1213 the figure it works back from is the sum of the dish's PHASES —
// the whole process, start to serve — rather than the stored cook time it used
// to read. The two claims that reversal rests on are pinned at the bottom of this
// file rather than left to the header comments in `scheduleFor.ts` and
// `components.ts` (CLAUDE.md rule 12): start times move EARLIER, and the running
// order agrees with the clock.

function phase(handsOnMinutes: number, handsOffMinutes: number): RecipePhase {
  return { label: 'Block', handsOnMinutes, handsOffMinutes };
}

/** A dish stating its timing as phases. No phases at all = `dish(id)`. */
function dish(id: string, ...phases: RecipePhase[]): Recipe {
  return {
    id,
    title: id,
    kind: 'recipe',
    componentRecipeIds: [],
    metadata: { servings: 4, phases },
    ingredients: [],
    steps: [],
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
  } as unknown as Recipe;
}

/** A dish whose whole timing is one unattended block of `n` minutes. */
function takes(id: string, n: number): Recipe {
  return dish(id, phase(0, n));
}

// The issue's own worked example: a Sunday roast served at 19:00.
const SERVE_AT = Date.parse('2026-08-16T19:00:00.000Z');
const at = (iso: string) => Date.parse(iso);

describe('scheduleFor', () => {
  it('is the issue’s worked example: 1 h 30 m → 17:30, 50 m → 18:10, 10 m → 18:50', () => {
    const rows = [takes('chicken', 90), takes('potatoes', 50), takes('gravy', 10)];
    expect(scheduleFor(rows, SERVE_AT)).toEqual([
      { recipeId: 'chicken', startAtMs: at('2026-08-16T17:30:00.000Z') },
      { recipeId: 'potatoes', startAtMs: at('2026-08-16T18:10:00.000Z') },
      { recipeId: 'gravy', startAtMs: at('2026-08-16T18:50:00.000Z') },
    ]);
  });

  it('sums every phase, hands-on and hands-off alike', () => {
    // 25 + 65 = 90 minutes of elapsed time across two blocks, which is the same
    // 17:30 the single-block bird above gets. Which half of a block is the cook
    // changes nothing about when it has to begin.
    const rows = [dish('chicken', phase(25, 0), phase(0, 65))];
    expect(scheduleFor(rows, SERVE_AT)).toEqual([
      { recipeId: 'chicken', startAtMs: at('2026-08-16T17:30:00.000Z') },
    ]);
  });

  it('answers null for every row while no serve time is set', () => {
    const rows = [takes('chicken', 90), takes('gravy', 10)];
    expect(scheduleFor(rows, null)).toEqual([
      { recipeId: 'chicken', startAtMs: null },
      { recipeId: 'gravy', startAtMs: null },
    ]);
  });

  it('KEEPS a dish with no phases, answering null for it — "start when you like"', () => {
    // Dropping the row would hide a dish from the plan for the crime of having an
    // incomplete recipe. The meal still has to be cooked.
    const rows = [takes('chicken', 90), dish('salad'), takes('gravy', 10)];
    const out = scheduleFor(rows, SERVE_AT);
    expect(out.map((r) => r.recipeId)).toEqual(['chicken', 'salad', 'gravy']);
    expect(out[1]).toEqual({ recipeId: 'salad', startAtMs: null });
  });

  it('starts a hand-zeroed strip AT serve time, rather than reading it as unknown', () => {
    // `hasPhases` is not `elapsedMinutes > 0`: a cook who zeroed every block has
    // stated a timing of nothing, which is a different answer from "does not say".
    const rows = [dish('dressing', phase(0, 0))];
    expect(scheduleFor(rows, SERVE_AT)).toEqual([{ recipeId: 'dressing', startAtMs: SERVE_AT }]);
  });

  it('NEVER SORTS — input order is the running order the user dragged', () => {
    // Deliberately shortest-first, which is the reverse of what a helpful sort
    // would do. A later attach must not silently undo an afternoon of arranging.
    const rows = [takes('gravy', 10), takes('chicken', 90), takes('potatoes', 50)];
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
    const rows = [takes('chicken', 90), takes('gravy', 10)];
    const before = JSON.stringify(rows);

    const first = scheduleFor(rows, SERVE_AT);
    const second = scheduleFor(rows, SERVE_AT);

    expect(second).toEqual(first);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

// ── The two claims #1213 reverses, pinned (CLAUDE.md rule 12) ────────────────
describe('scheduleFor and insertComponentByCookTime read the same figure', () => {
  // A roast whose hands-off cooking is 90 minutes and whose knife work is another
  // 25. Under the old rule the clock saw only the 90.
  const ROAST = dish('roast', phase(25, 0), phase(0, 90));

  it('starts a dish EARLIER than its time on heat alone would put it (#953)', () => {
    const onHeatOnly = SERVE_AT - 90 * 60_000;
    const [row] = scheduleFor([ROAST], SERVE_AT);

    expect(row!.startAtMs).toBe(SERVE_AT - 115 * 60_000);
    expect(row!.startAtMs!).toBeLessThan(onHeatOnly);
  });

  // The running order and the clock times cannot disagree, because they are the
  // same number. Asserted over fixtures where the two rules would ORDER
  // DIFFERENTLY: `slow` has the longer whole process, `hot` the longer time on
  // heat, so an implementation that quietly went back to cook time would put
  // `hot` first here and fail.
  it('orders the dishes exactly as the start clock does, longest first', () => {
    const slow = dish('slow', phase(50, 0), phase(0, 40)); // 90 elapsed, 40 on heat
    const hot = dish('hot', phase(5, 0), phase(0, 60)); // 65 elapsed, 60 on heat
    const quick = takes('quick', 10);
    const all = [slow, hot, quick];

    const order = ['quick', 'hot'].reduce(
      (ids, id) => insertComponentByCookTime('meal', ids, id, all),
      insertComponentByCookTime('meal', [], 'slow', all),
    );

    const starts = new Map(scheduleFor(all, SERVE_AT).map((r) => [r.recipeId, r.startAtMs!]));
    expect(order).toEqual([...order].sort((a, b) => starts.get(a)! - starts.get(b)!));
    expect(order).toEqual(['slow', 'hot', 'quick']);
  });

  it('leads with a dish that has no phases, the same answer the clock gives it', () => {
    // `startAtMs: null` — "start when you like" — and Infinity in the sort, so the
    // row is at the top where it can be read rather than buried at the bottom.
    const salad = dish('salad');
    const all = [takes('chicken', 90), salad];

    expect(insertComponentByCookTime('meal', ['chicken'], 'salad', all)).toEqual([
      'salad',
      'chicken',
    ]);
    expect(recipePhaseTotals(salad.metadata.phases).hasPhases).toBe(false);
    expect(scheduleFor([salad], SERVE_AT)[0]!.startAtMs).toBeNull();
  });
});
