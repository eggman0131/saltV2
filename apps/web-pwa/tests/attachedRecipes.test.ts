import { describe, it, expect } from 'vitest';
import { emptyRecipe } from '@salt/domain';
import type { Recipe } from '@salt/domain';
import { recipeIndex, resolveRecipeIds } from '../src/lib/attachedRecipes.js';

// The resolution five surfaces share (issue #1055). The page-level tables in
// `MealDayEditor.summary.test.ts`, `MealDayEditor.placeholder.test.ts`,
// `MealPlanWeekPage.test.ts` and `personalViewService.test.ts` assert that each
// surface still reaches these answers; what is asserted here is the answers.

const NOW = '2026-08-28T00:00:00.000Z';
const roast: Recipe = { ...emptyRecipe('r1', NOW), title: 'Sunday Roast', updatedAt: NOW };
const pie: Recipe = { ...emptyRecipe('r2', NOW), title: 'Steak Pie', updatedAt: NOW };
const index = new Map([
  [roast.id, roast],
  [pie.id, pie],
]);

describe('resolveRecipeIds', () => {
  it('follows the order of the IDS, not the order of the index', () => {
    // The day's order is the plan's order. The store's is arbitrary.
    expect(resolveRecipeIds(['r2', 'r1'], index)).toEqual([pie, roast]);
  });

  it('skips an id that resolves to nothing rather than yielding a hole', () => {
    // The property the whole helper exists for: a recipe deleted since it was
    // attached leaves its id behind, and a blank row in the middle of a night's
    // plan is worse than no row at all. Deleting the filter used to fail no test
    // anywhere in the repo — only the typechecker noticed.
    const resolved = resolveRecipeIds(['ghost', 'r1', 'also-ghost'], index);

    expect(resolved).toEqual([roast]);
    expect(resolved).not.toContain(undefined);
  });

  it('yields nothing at all when no id resolves', () => {
    expect(resolveRecipeIds(['ghost'], index)).toEqual([]);
  });

  it('yields nothing for no ids', () => {
    expect(resolveRecipeIds([], index)).toEqual([]);
  });

  it('preserves a duplicated id as two entries', () => {
    // Inherited, not chosen — and worth knowing, because a caller rendering a
    // KEYED `{#each}` over the result would throw on it. Nothing in the app can
    // produce a duplicate today (the picker excludes what is attached), so this
    // pins the behaviour rather than endorsing the input.
    expect(resolveRecipeIds(['r1', 'r1'], index)).toEqual([roast, roast]);
  });
});

describe('recipeIndex', () => {
  it('uses the shared index when the caller has one', () => {
    // Identity, not equality: the whole point of #940 is that the index is built
    // once per change to `recipes`, never per component instance.
    expect(recipeIndex(index, [])).toBe(index);
  });

  it('builds one from the list when the caller has none', () => {
    const built = recipeIndex(undefined, [roast, pie]);

    expect(built.get('r1')).toBe(roast);
    expect(built.get('r2')).toBe(pie);
    expect(built.size).toBe(2);
  });

  it('prefers the shared index even when a list is also given', () => {
    // Both planner pages pass both. A caller that supplies the index must not
    // silently get a second one built from a prop that may be a subset.
    expect(recipeIndex(index, [roast])).toBe(index);
  });

  it('is an empty index, not a crash, when the caller has neither', () => {
    expect(recipeIndex(undefined, []).size).toBe(0);
  });
});
