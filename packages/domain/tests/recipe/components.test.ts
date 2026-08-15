import { describe, it, expect } from 'vitest';
import {
  canBeComponentOf,
  hasComponents,
  insertComponentByCookTime,
  resolveComponents,
} from '@salt/domain';
import type { Recipe } from '@salt/domain';

// Meals — a dinner built from several dishes (issue #752). The whole module rests
// on one invariant, and most of what is pinned here is that invariant seen from a
// different angle: NOTHING AGGREGATES, NOTHING RECURSES.

function makeRecipe(over: {
  id: string;
  title?: string;
  cookTimeMinutes?: number | null;
  componentRecipeIds?: string[];
}): Recipe {
  return {
    id: over.id,
    schemaVersion: 1,
    kind: 'recipe',
    title: over.title ?? over.id,
    description: null,
    ingredients: [],
    steps: [],
    metadata: {
      servings: null,
      totalTimeMinutes: null,
      prepTimeMinutes: null,
      cookTimeMinutes: over.cookTimeMinutes ?? null,
      tags: [],
    },
    source: null,
    notes: null,
    producesCanonId: null,
    componentRecipeIds: over.componentRecipeIds ?? [],
    image: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const CHICKEN = makeRecipe({ id: 'chicken', title: 'Roast chicken', cookTimeMinutes: 90 });
const POTATOES = makeRecipe({ id: 'potatoes', title: 'Roast potatoes', cookTimeMinutes: 45 });
const GRAVY = makeRecipe({ id: 'gravy', title: 'Onion gravy', cookTimeMinutes: 20 });
// No cook time at all — "start when you like", which sorts to the TOP.
const SALAD = makeRecipe({ id: 'salad', title: 'Green salad', cookTimeMinutes: null });

const LIBRARY = [CHICKEN, POTATOES, GRAVY, SALAD];

describe('hasComponents', () => {
  it('is false for an ordinary recipe — a meal is derived, never declared', () => {
    expect(hasComponents(makeRecipe({ id: 'r' }))).toBe(false);
  });

  it('is true the moment one dish is attached', () => {
    expect(hasComponents(makeRecipe({ id: 'r', componentRecipeIds: ['chicken'] }))).toBe(true);
  });

  it('answers from the ids alone, never from what they resolve to', () => {
    // A meal all of whose dishes were deleted elsewhere is still a meal: the
    // document says so. Resolution is a display concern and happens separately.
    expect(hasComponents(makeRecipe({ id: 'r', componentRecipeIds: ['gone'] }))).toBe(true);
  });
});

describe('resolveComponents', () => {
  it('returns the components in stored order, not in cook-time order', () => {
    // The stored order IS the user's drag order. Nothing re-sorts it on the way
    // out, or an afternoon of arranging would be undone at every render.
    const roast = makeRecipe({
      id: 'roast',
      componentRecipeIds: ['gravy', 'chicken', 'potatoes'],
    });
    expect(resolveComponents(roast, LIBRARY).map((r) => r.id)).toEqual([
      'gravy',
      'chicken',
      'potatoes',
    ]);
  });

  it('skips an id that resolves to nothing rather than rendering a broken row', () => {
    const roast = makeRecipe({
      id: 'roast',
      componentRecipeIds: ['chicken', 'deleted-elsewhere', 'gravy'],
    });
    expect(resolveComponents(roast, LIBRARY).map((r) => r.id)).toEqual(['chicken', 'gravy']);
  });

  it('returns an empty list when every component has been deleted', () => {
    const roast = makeRecipe({ id: 'roast', componentRecipeIds: ['gone-a', 'gone-b'] });
    expect(resolveComponents(roast, LIBRARY)).toEqual([]);
  });

  it('resolves EXACTLY ONE LEVEL — a component of a component never appears', () => {
    // The invariant the whole feature rests on. It is what makes the read O(1) and
    // what makes a reference cycle inert.
    const sides = makeRecipe({ id: 'sides', componentRecipeIds: ['potatoes', 'gravy'] });
    const roast = makeRecipe({ id: 'roast', componentRecipeIds: ['chicken', 'sides'] });
    const resolved = resolveComponents(roast, [...LIBRARY, sides]);
    expect(resolved.map((r) => r.id)).toEqual(['chicken', 'sides']);
    expect(resolved.map((r) => r.id)).not.toContain('potatoes');
  });

  it('renders one card each for a reference cycle rather than looping', () => {
    const a = makeRecipe({ id: 'a', componentRecipeIds: ['b'] });
    const b = makeRecipe({ id: 'b', componentRecipeIds: ['a'] });
    expect(resolveComponents(a, [a, b]).map((r) => r.id)).toEqual(['b']);
    expect(resolveComponents(b, [a, b]).map((r) => r.id)).toEqual(['a']);
  });

  it('does not mutate the recipe it is handed', () => {
    const roast = makeRecipe({ id: 'roast', componentRecipeIds: ['chicken', 'gone'] });
    const before = structuredClone(roast);
    resolveComponents(roast, LIBRARY);
    expect(roast).toEqual(before);
  });
});

describe('canBeComponentOf', () => {
  it('refuses a recipe as its own component', () => {
    expect(canBeComponentOf('roast', 'roast')).toBe(false);
  });

  it('allows any other dish', () => {
    expect(canBeComponentOf('roast', 'chicken')).toBe(true);
  });

  it('allows A→B even when B already points at A — a cycle is inert, not illegal', () => {
    expect(canBeComponentOf('a', 'b')).toBe(true);
  });
});

describe('insertComponentByCookTime', () => {
  it('inserts longest-cooking first, so the thing you start first leads', () => {
    let ids = insertComponentByCookTime('roast', [], 'gravy', LIBRARY);
    ids = insertComponentByCookTime('roast', ids, 'chicken', LIBRARY);
    ids = insertComponentByCookTime('roast', ids, 'potatoes', LIBRARY);
    expect(ids).toEqual(['chicken', 'potatoes', 'gravy']);
  });

  it('sorts a component with NO cook time to the top — "start when you like"', () => {
    const ids = insertComponentByCookTime('roast', ['chicken', 'potatoes'], 'salad', LIBRARY);
    expect(ids).toEqual(['salad', 'chicken', 'potatoes']);
  });

  it('uses cook time, not total time — prep is done ahead and in any order', () => {
    // A dish with a huge total time but a short cook still goes last: the number
    // that matters is when it has to go ON, not how long it took to get ready.
    const marinated = makeRecipe({ id: 'marinated', cookTimeMinutes: 5 });
    const library = [
      ...LIBRARY,
      { ...marinated, metadata: { ...marinated.metadata, totalTimeMinutes: 600 } },
    ];
    const ids = insertComponentByCookTime('roast', ['chicken', 'gravy'], 'marinated', library);
    expect(ids).toEqual(['chicken', 'gravy', 'marinated']);
  });

  it('appends when nothing already attached cooks for less time', () => {
    expect(insertComponentByCookTime('roast', ['chicken'], 'gravy', LIBRARY)).toEqual([
      'chicken',
      'gravy',
    ]);
  });

  it('is a no-op when the id is already attached', () => {
    const ids = ['chicken', 'gravy'];
    expect(insertComponentByCookTime('roast', ids, 'chicken', LIBRARY)).toEqual(ids);
  });

  it('refuses to attach a recipe to itself — the guard is folded in, not merely advised', () => {
    // The same answer `canBeComponentOf` gives the picker, enforced again here so
    // a caller that forgot to ask cannot write a self-reference.
    const ids = ['chicken'];
    expect(insertComponentByCookTime('roast', ids, 'roast', LIBRARY)).toEqual(ids);
  });

  it('never re-sorts the existing array — the drag order survives a later attach', () => {
    // gravy(20) before chicken(90) is not cook-time order; it is what the user
    // dragged, and attaching potatoes must not quietly undo it. potatoes(45) lands
    // before the first entry that cooks for less, which is gravy.
    const dragged = ['gravy', 'chicken'];
    expect(insertComponentByCookTime('roast', dragged, 'potatoes', LIBRARY)).toEqual([
      'potatoes',
      'gravy',
      'chicken',
    ]);
  });

  it('does not crash on an already-attached id that no longer resolves', () => {
    const ids = ['deleted-elsewhere', 'gravy'];
    expect(insertComponentByCookTime('roast', ids, 'chicken', LIBRARY)).toEqual([
      'deleted-elsewhere',
      'chicken',
      'gravy',
    ]);
  });

  it('treats an unknown NEW id as having no cook time and leads with it', () => {
    expect(insertComponentByCookTime('roast', ['chicken'], 'unknown', LIBRARY)).toEqual([
      'unknown',
      'chicken',
    ]);
  });

  it('returns a new array and never mutates the one it was given', () => {
    const ids = ['chicken'];
    const out = insertComponentByCookTime('roast', ids, 'gravy', LIBRARY);
    expect(out).not.toBe(ids);
    expect(ids).toEqual(['chicken']);
  });
});
