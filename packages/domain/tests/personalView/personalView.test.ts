import { describe, it, expect } from 'vitest';
import {
  chefDaysForMember,
  unshoppedPlannedRecipes,
  isUnopenedImport,
  rankPersonalCards,
  UNOPENED_IMPORT_WINDOW_MS,
  type Day,
  type MealPlanWeek,
  type Recipe,
  type ShoppingListItem,
} from '../../src/index.js';

// The projections behind "Mine" (issue #634). The point of the whole feature is
// that two members looking at the SAME family-shared week see different screens,
// so most of these assert the difference rather than a single answer.

const MON = '2026-08-03';
const TUE = '2026-08-04';
const WED = '2026-08-05';
const THU = '2026-08-06';
const FRI = '2026-08-07';

function day(overrides: Partial<Day> = {}): Day {
  return { note: '', recipeIds: [], chefs: [], attendees: [], guests: 0, ...overrides };
}

function week(days: Record<string, Day>): MealPlanWeek {
  return {
    id: MON,
    schemaVersion: 1,
    startDate: MON,
    days,
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function recipe(id: string, ingredientCount: number, overrides: Partial<Recipe> = {}): Recipe {
  return {
    id,
    schemaVersion: 1,
    kind: 'recipe',
    title: id,
    description: null,
    ingredients: [
      {
        id: `${id}-g1`,
        name: null,
        items: Array.from({ length: ingredientCount }, (_unused, i) => ({
          id: `${id}-i${i}`,
          rawText: `ingredient ${i}`,
          parsed: null,
          canonId: null,
          matchState: 'pending' as const,
          isOptional: false,
          firstUsedInStepId: null,
        })),
      },
    ],
    steps: [],
    metadata: {
      servings: 2,
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
    ...overrides,
  } as Recipe;
}

function item(overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id: 'item-1',
    rawText: 'thing',
    notes: '',
    sources: [],
    canonId: null,
    matchState: 'matched',
    checked: false,
    needsCheck: false,
    schemaVersion: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as ShoppingListItem;
}

describe('chefDaysForMember', () => {
  const w = week({
    [MON]: day({ chefs: ['alex'] }),
    [TUE]: day({ chefs: ['sam'] }),
    [WED]: day({ chefs: ['alex', 'sam'] }),
    [THU]: day(),
  });

  it('returns only the nights that member is down to cook, in calendar order', () => {
    expect(chefDaysForMember(w, 'alex')).toEqual([MON, WED]);
    expect(chefDaysForMember(w, 'sam')).toEqual([TUE, WED]);
  });

  it('gives the same week two different answers for two members', () => {
    expect(chefDaysForMember(w, 'alex')).not.toEqual(chefDaysForMember(w, 'sam'));
  });

  it('matches nothing when nobody is resolved', () => {
    // An unresolved member must not read as "every night is yours".
    expect(chefDaysForMember(w, '')).toEqual([]);
    expect(chefDaysForMember(w, 'nobody')).toEqual([]);
  });
});

describe('unshoppedPlannedRecipes', () => {
  const noodles = recipe('noodles', 4);
  const chicken = recipe('chicken', 6);
  const recipes = [noodles, chicken];

  it('reports a planned recipe nothing on the list came from, with what an add would write', () => {
    const w = week({ [WED]: day({ recipeIds: ['noodles'] }) });
    expect(unshoppedPlannedRecipes(w, [], recipes, MON)).toEqual([
      { date: WED, recipeId: 'noodles', missingCount: 4 },
    ]);
  });

  it('treats any item sourced from the recipe as shopped for', () => {
    const w = week({ [WED]: day({ recipeIds: ['noodles'] }) });
    const items = [item({ sources: [{ kind: 'recipe', recipeId: 'noodles', servings: 2 }] })];
    expect(unshoppedPlannedRecipes(w, items, recipes, MON)).toEqual([]);
  });

  it('counts a checked-off item as shopped — it was bought', () => {
    const w = week({ [WED]: day({ recipeIds: ['noodles'] }) });
    const items = [
      item({ checked: true, sources: [{ kind: 'recipe', recipeId: 'noodles', servings: 2 }] }),
    ];
    expect(unshoppedPlannedRecipes(w, items, recipes, MON)).toEqual([]);
  });

  it('ignores a manual item that happens to be on the list', () => {
    const w = week({ [WED]: day({ recipeIds: ['noodles'] }) });
    const items = [item({ sources: [{ kind: 'manual', addedBy: 'Alex' }] })];
    expect(unshoppedPlannedRecipes(w, items, recipes, MON)).toHaveLength(1);
  });

  it('never nags about a night already past', () => {
    const w = week({
      [MON]: day({ recipeIds: ['noodles'] }),
      [FRI]: day({ recipeIds: ['chicken'] }),
    });
    expect(unshoppedPlannedRecipes(w, [], recipes, WED).map((r) => r.recipeId)).toEqual([
      'chicken',
    ]);
  });

  it('collapses the same dish planned twice onto its earliest night', () => {
    const w = week({
      [WED]: day({ recipeIds: ['noodles'] }),
      [FRI]: day({ recipeIds: ['noodles'] }),
    });
    expect(unshoppedPlannedRecipes(w, [], recipes, MON)).toEqual([
      { date: WED, recipeId: 'noodles', missingCount: 4 },
    ]);
  });

  it('says nothing about a planned recipe that no longer exists', () => {
    const w = week({ [WED]: day({ recipeIds: ['deleted'] }) });
    expect(unshoppedPlannedRecipes(w, [], recipes, MON)).toEqual([]);
  });

  // A planned entry with no ingredient lines used to emit a permanently stuck
  // "needs you" card: an add-to-list writes nothing, so no item can ever carry a
  // source back to it and the card can never clear. Nothing to buy, nothing to say.
  it('says nothing about a planned recipe with no ingredients at all', () => {
    const empty = recipe('empty', 0);
    const w = week({ [WED]: day({ recipeIds: ['empty'] }) });
    expect(unshoppedPlannedRecipes(w, [], [...recipes, empty], MON)).toEqual([]);
  });

  it('still reports the other planned recipes alongside an empty one', () => {
    const empty = recipe('empty', 0);
    const w = week({ [WED]: day({ recipeIds: ['empty', 'noodles'] }) });
    expect(unshoppedPlannedRecipes(w, [], [...recipes, empty], MON)).toEqual([
      { date: WED, recipeId: 'noodles', missingCount: 4 },
    ]);
  });

  it('keeps an empty recipe deduped across days rather than re-testing it each night', () => {
    // The skip sits AFTER the dedupe, so an empty dish planned twice is still
    // one decision — and stays silent on both nights.
    const empty = recipe('empty', 0);
    const w = week({
      [WED]: day({ recipeIds: ['empty'] }),
      [FRI]: day({ recipeIds: ['empty'] }),
    });
    expect(unshoppedPlannedRecipes(w, [], [...recipes, empty], MON)).toEqual([]);
  });
});

describe('isUnopenedImport', () => {
  const NOW = Date.parse('2026-08-01T12:00:00.000Z');
  const imported = (createdAt: string, updatedAt = createdAt): Recipe =>
    recipe('imported', 3, {
      createdAt,
      updatedAt,
      source: { type: 'url', url: 'https://example.com/r' },
    });

  it('surfaces an import that landed minutes ago and has not been touched', () => {
    expect(isUnopenedImport(imported('2026-08-01T11:56:00.000Z'), NOW)).toBe(true);
  });

  it('stops surfacing it once somebody has saved it', () => {
    // The editor save IS the opening; the recovery path has done its job.
    expect(
      isUnopenedImport(imported('2026-08-01T11:56:00.000Z', '2026-08-01T11:58:00.000Z'), NOW),
    ).toBe(false);
  });

  it('stops after 24 hours — by then it is just a recipe in the cookbook', () => {
    const old = imported(new Date(NOW - UNOPENED_IMPORT_WINDOW_MS - 1000).toISOString());
    expect(isUnopenedImport(old, NOW)).toBe(false);
  });

  it('ignores a recipe written by hand', () => {
    // Whoever typed it in has, by definition, just looked at it.
    const manual = recipe('typed', 3, {
      createdAt: '2026-08-01T11:56:00.000Z',
      updatedAt: '2026-08-01T11:56:00.000Z',
      source: { type: 'manual' },
    });
    expect(isUnopenedImport(manual, NOW)).toBe(false);
    expect(isUnopenedImport(recipe('sourceless', 3), NOW)).toBe(false);
  });

  it('tolerates a clock-skewed future timestamp rather than hiding the recipe', () => {
    expect(isUnopenedImport(imported('2026-08-01T12:05:00.000Z'), NOW)).toBe(true);
  });

  it('does not throw on an unparseable timestamp', () => {
    expect(isUnopenedImport(imported('not-a-date'), NOW)).toBe(false);
  });
});

describe('rankPersonalCards', () => {
  const card = (
    id: string,
    kind: 'unshopped-mine' | 'needs-check' | 'unshopped-other',
    date: string | null = null,
    urgent = false,
  ) => ({ id, kind, date, urgent });

  it('puts your own nights first, then the list, then somebody else s', () => {
    const ranked = rankPersonalCards([
      card('c', 'unshopped-other', FRI),
      card('b', 'needs-check'),
      card('a', 'unshopped-mine', THU),
    ]);
    expect(ranked.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('never lets an urgent card of somebody else s outrank one of yours', () => {
    const ranked = rankPersonalCards([
      card('theirs', 'unshopped-other', THU, true),
      card('mine', 'unshopped-mine', FRI, false),
    ]);
    expect(ranked[0]?.id).toBe('mine');
  });

  it('escalates within a tier when the shop is imminent', () => {
    const ranked = rankPersonalCards([
      card('later', 'unshopped-mine', THU, false),
      card('urgent', 'unshopped-mine', FRI, true),
    ]);
    expect(ranked.map((c) => c.id)).toEqual(['urgent', 'later']);
  });

  it('orders by soonest night within a tier, then deterministically by id', () => {
    const ranked = rankPersonalCards([
      card('z', 'unshopped-mine', WED),
      card('a', 'unshopped-mine', WED),
      card('early', 'unshopped-mine', TUE),
    ]);
    expect(ranked.map((c) => c.id)).toEqual(['early', 'a', 'z']);
  });

  it('caps the queue at three so the page never becomes a backlog', () => {
    const many = Array.from({ length: 6 }, (_unused, i) => card(`c${i}`, 'unshopped-mine', WED));
    expect(rankPersonalCards(many)).toHaveLength(3);
  });

  it('leaves the input array untouched', () => {
    const cards = [card('b', 'needs-check'), card('a', 'unshopped-mine', WED)];
    rankPersonalCards(cards);
    expect(cards.map((c) => c.id)).toEqual(['b', 'a']);
  });
});
