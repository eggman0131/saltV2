import { describe, it, expect } from 'vitest';
import {
  canBeComponentOf,
  componentDisplayLines,
  expandForPlanner,
  hasComponents,
  insertComponentByCookTime,
  mergePlannerRecipeIds,
  resolveComponents,
} from '@salt/domain';
import type { Recipe } from '@salt/domain';

// Meals — a dinner built from several dishes (issue #752). The whole module rests
// on one invariant, and most of what is pinned here is that invariant seen from a
// different angle: NOTHING AGGREGATES, NOTHING RECURSES.

function makeRecipe(over: {
  id: string;
  title?: string;
  description?: string | null;
  cookTimeMinutes?: number | null;
  componentRecipeIds?: string[];
  ingredients?: Recipe['ingredients'];
  steps?: Recipe['steps'];
}): Recipe {
  return {
    id: over.id,
    schemaVersion: 1,
    kind: 'recipe',
    title: over.title ?? over.id,
    description: over.description ?? null,
    ingredients: over.ingredients ?? [],
    steps: over.steps ?? [],
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
    kit: [],
    createdBy: '',
    lastEditedBy: '',
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

// How a resolved dish reads to something OUTSIDE the app (issue #838) — today the
// hero art director, which is handed the dishes so a Sunday roast is photographed
// as the bird, the potatoes and the jug of gravy rather than whatever the model
// guesses. It lives in the domain because it has two callers on opposite sides of
// the app — the browser's brief dialog and the onRecipeWritten trigger — that must
// describe the same dinner in the same words; what is pinned here is the shape
// both of them are held to.
describe('componentDisplayLines', () => {
  it('is the title alone when a dish has no description', () => {
    // Most dishes have none. A trailing em-dash with nothing after it would be
    // noise in the prompt and would read to the model as a missing detail.
    expect(componentDisplayLines([makeRecipe({ id: 'gravy', title: 'Onion gravy' })])).toEqual([
      'Onion gravy',
    ]);
  });

  it('joins title and description with an em-dash when there is one', () => {
    // The description is the only thing that says what the dish LOOKS like, which
    // is the whole reason the art director is given the dishes at all.
    expect(
      componentDisplayLines([
        makeRecipe({
          id: 'chicken',
          title: 'Roast chicken',
          description: 'Lemon and thyme, skin crisp and burnished.',
        }),
      ]),
    ).toEqual(['Roast chicken — Lemon and thyme, skin crisp and burnished.']);
  });

  it('keeps the order it was handed', () => {
    // `resolveComponents` preserves the user's drag order, which is roughly the
    // running order of the dinner; re-ordering here would quietly undo it and
    // change which dish the brief treats as leading the table.
    const lines = componentDisplayLines([
      makeRecipe({ id: 'chicken', title: 'Roast chicken' }),
      makeRecipe({ id: 'potatoes', title: 'Roast potatoes' }),
      makeRecipe({ id: 'gravy', title: 'Onion gravy' }),
    ]);
    expect(lines).toEqual(['Roast chicken', 'Roast potatoes', 'Onion gravy']);
  });

  it('renders nothing for a recipe that is not a meal', () => {
    // The empty case is load-bearing rather than trivial: every caller omits the
    // whole "Dishes in this meal" block on an empty array, so an ordinary recipe
    // sends byte-for-byte the prompt it sent before meals existed.
    expect(componentDisplayLines([])).toEqual([]);
  });

  it('emits NO ingredient and NO step content, however much the dish carries', () => {
    // The invariant the meals feature rests on, seen from the prompt side: nothing
    // aggregates. A brief describes what is on the table, not a merged recipe —
    // and a dish's own lines reaching the meal is exactly how a dinner gets
    // shopped twice (the planner attaches the meal AND its dishes).
    const chicken = makeRecipe({
      id: 'chicken',
      title: 'Roast chicken',
      description: 'Lemon and thyme.',
      ingredients: [
        {
          id: 'g1',
          name: null,
          items: [
            {
              id: 'i1',
              rawText: '1 whole chicken, about 1.6kg',
              parsed: null,
              canonId: null,
              matchState: 'pending',
              isOptional: false,
              firstUsedInStepId: null,
            },
          ],
        },
      ],
      steps: [{ id: 's1', text: 'Roast at 200°C for 90 minutes.', timer: null, note: null }],
    });

    const lines = componentDisplayLines([chicken]);

    expect(lines).toEqual(['Roast chicken — Lemon and thyme.']);
    for (const line of lines) {
      expect(line).not.toContain('1 whole chicken');
      expect(line).not.toContain('Roast at 200°C');
    }
  });

  it('does not mutate the components it is handed', () => {
    const chicken = makeRecipe({ id: 'chicken', description: 'Lemon and thyme.' });
    const before = structuredClone(chicken);
    componentDisplayLines([chicken]);
    expect(chicken).toEqual(before);
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

describe('expandForPlanner', () => {
  it('puts the MEAL first, then its dishes', () => {
    // The order is load-bearing, not cosmetic: the planner seeds the night's note
    // from the first attached recipe's title and the day's card from the first
    // attached hero, so meal-first is what makes both of them say "Sunday roast"
    // without either mechanic knowing meals exist.
    const roast = makeRecipe({
      id: 'roast',
      title: 'Sunday roast',
      componentRecipeIds: ['chicken', 'potatoes', 'gravy'],
    });
    expect(expandForPlanner(roast)).toEqual(['roast', 'chicken', 'potatoes', 'gravy']);
  });

  it('expands an ordinary recipe to just itself', () => {
    expect(expandForPlanner(CHICKEN)).toEqual(['chicken']);
  });

  it('expands EXACTLY ONE LEVEL — a component of a component is not planned', () => {
    const sides = makeRecipe({ id: 'sides', componentRecipeIds: ['potatoes', 'gravy'] });
    const roast = makeRecipe({ id: 'roast', componentRecipeIds: ['chicken', 'sides'] });
    expect(expandForPlanner(roast)).toEqual(['roast', 'chicken', 'sides']);
  });

  it('keeps a dangling id rather than filtering it out', () => {
    // Deliberately store-free: filtering would make a planner WRITE depend on
    // store hydration, so a half-hydrated app would silently plan fewer dishes
    // than the user picked. A dangling id is inert — every planner consumer
    // already skips one — and that is much the lesser failure.
    const roast = makeRecipe({ id: 'roast', componentRecipeIds: ['deleted-elsewhere', 'gravy'] });
    expect(expandForPlanner(roast)).toEqual(['roast', 'deleted-elsewhere', 'gravy']);
  });

  it('does not mutate the recipe it is handed', () => {
    const roast = makeRecipe({ id: 'roast', componentRecipeIds: ['chicken'] });
    const before = structuredClone(roast);
    const out = expandForPlanner(roast);
    out.push('extra');
    expect(roast).toEqual(before);
  });
});

describe('mergePlannerRecipeIds', () => {
  it('appends what is new, in the order it was offered', () => {
    expect(mergePlannerRecipeIds(['pie'], ['roast', 'chicken'])).toEqual([
      'pie',
      'roast',
      'chicken',
    ]);
  });

  it('adds only the missing part of a meal already half on the night', () => {
    // "Remove the gravy from Tuesday, then attach the roast again": the meal and
    // the potatoes stay where they are, the gravy comes back at the end.
    expect(
      mergePlannerRecipeIds(
        ['roast', 'chicken', 'potatoes'],
        ['roast', 'chicken', 'potatoes', 'gravy'],
      ),
    ).toEqual(['roast', 'chicken', 'potatoes', 'gravy']);
  });

  it('never re-sorts what is already there', () => {
    expect(mergePlannerRecipeIds(['gravy', 'chicken'], ['chicken', 'gravy'])).toEqual([
      'gravy',
      'chicken',
    ]);
  });

  it('dedupes within the additions too', () => {
    expect(mergePlannerRecipeIds([], ['roast', 'gravy', 'roast'])).toEqual(['roast', 'gravy']);
  });

  it('handles both empty cases', () => {
    expect(mergePlannerRecipeIds([], [])).toEqual([]);
    expect(mergePlannerRecipeIds([], ['roast'])).toEqual(['roast']);
    expect(mergePlannerRecipeIds(['roast'], [])).toEqual(['roast']);
  });

  it('mutates neither argument', () => {
    const existing = ['pie'];
    const additions = ['roast'];
    const out = mergePlannerRecipeIds(existing, additions);
    expect(out).not.toBe(existing);
    expect(existing).toEqual(['pie']);
    expect(additions).toEqual(['roast']);
  });
});
