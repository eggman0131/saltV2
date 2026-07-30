import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Day, MealPlanWeek, Member, Recipe, ShoppingListItem } from '@salt/domain';
import type { CookSessionDoc, ShoppingDayDoc } from '@salt/domain/schemas';

// The personal view's composition layer (issue #634). Everything it reads is a
// store that is already subscribed app-wide, so these tests drive fake stores and
// assert the PROJECTION: same family-shared data, two different members, two
// different screens.

const {
  mockCurrentMember,
  mockMembers,
  mockWeek,
  mockItems,
  mockRecipes,
  mockSessions,
  mockUpcomingShopDay,
  mockWeekShopDay,
  mockForecast,
} = vi.hoisted(() => {
  function makeStore<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      subscribe(fn: (v: T) => void) {
        subs.add(fn);
        fn(value);
        return () => {
          subs.delete(fn);
        };
      },
      _set(v: T) {
        value = v;
        subs.forEach((f) => f(v));
      },
    };
  }
  return {
    mockCurrentMember: makeStore<unknown>(null),
    mockMembers: makeStore<unknown[]>([]),
    mockWeek: makeStore<unknown>(null),
    mockItems: makeStore<unknown[]>([]),
    mockRecipes: makeStore<unknown[]>([]),
    mockSessions: makeStore<unknown[]>([]),
    mockUpcomingShopDay: makeStore<unknown>(undefined),
    mockWeekShopDay: makeStore<unknown>(null),
    mockForecast: makeStore<unknown>(null),
  };
});

vi.mock('../src/lib/membersService.js', () => ({
  currentMember: mockCurrentMember,
  members: mockMembers,
}));
vi.mock('../src/lib/mealPlanService.js', () => ({ currentWeek: mockWeek }));
vi.mock('../src/lib/shoppingListService.svelte.js', () => ({ itemsForActiveList: mockItems }));
vi.mock('../src/lib/recipeService.js', () => ({ recipes: mockRecipes }));
vi.mock('../src/lib/cookSessionService.js', () => ({ myCookSessions: mockSessions }));
vi.mock('../src/lib/shoppingDayService.js', () => ({
  upcomingShopDay: mockUpcomingShopDay,
  weekShopDay: mockWeekShopDay,
}));
vi.mock('../src/lib/weatherService.js', () => ({ weatherForecast: mockForecast }));

import {
  liveCooks,
  mineOpenCount,
  needsYou,
  tonight,
  yourWeek,
} from '../src/lib/personalViewService.js';

// ─── Fixtures anchored on the real "today", since the service reads the clock ──

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const TODAY = new Date().toLocaleDateString('en-CA');
const TOMORROW = addDays(TODAY, 1);
const IN_TWO = addDays(TODAY, 2);
const IN_THREE = addDays(TODAY, 3);

function day(overrides: Partial<Day> = {}): Day {
  return { note: '', recipeIds: [], chefs: [], attendees: [], guests: 0, ...overrides };
}

// A week that starts today, so every fixture date is inside it.
function week(days: Record<string, Day>): MealPlanWeek {
  const filled: Record<string, Day> = {};
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(TODAY, i);
    filled[date] = days[date] ?? day();
  }
  return { id: TODAY, schemaVersion: 1, startDate: TODAY, days: filled, updatedAt: '' };
}

function member(id: string, name: string): Member {
  return {
    id,
    schemaVersion: 1,
    name,
    email: id,
    admin: false,
    sortOrder: 0,
    icon: null,
    updatedAt: '',
  };
}

function recipe(id: string, title: string, ingredients = 3, steps = 0): Recipe {
  return {
    id,
    schemaVersion: 1,
    title,
    description: null,
    ingredients: [
      {
        id: `${id}-g`,
        name: null,
        items: Array.from({ length: ingredients }, (_u, i) => ({
          id: `${id}-i${i}`,
          rawText: 'x',
          parsed: null,
          canonId: null,
          matchState: 'pending' as const,
          isOptional: false,
          firstUsedInStepId: null,
        })),
      },
    ],
    steps: Array.from({ length: steps }, (_u, i) => ({
      id: `${id}-s${i}`,
      text: `step ${i}`,
      timer: null,
      note: null,
    })),
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
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  } as Recipe;
}

function item(overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id: crypto.randomUUID(),
    rawText: 'thing',
    notes: '',
    sources: [],
    canonId: null,
    matchState: 'matched',
    checked: false,
    needsCheck: false,
    schemaVersion: 1,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  } as ShoppingListItem;
}

function session(recipeId: string, completedStepIds: string[] = []): CookSessionDoc {
  return {
    id: `${recipeId}_uid-a`,
    schemaVersion: 1,
    ownerUid: 'uid-a',
    recipeId,
    recipeUpdatedAtAtStart: '2026-07-01T00:00:00.000Z',
    checkedIngredientIds: [],
    completedStepIds,
    activeTimers: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

const shopDay = (date: string): ShoppingDayDoc => ({
  date,
  slot: 'am',
  schemaVersion: 1,
  setBy: 'uid-a',
  setAt: '',
});

const alex = member('alex@e.org', 'Alex Green');
const sam = member('sam@e.org', 'Sam Blue');

beforeEach(() => {
  mockCurrentMember._set(alex);
  mockMembers._set([alex, sam]);
  mockWeek._set(week({}));
  mockItems._set([]);
  mockRecipes._set([]);
  mockSessions._set([]);
  mockUpcomingShopDay._set(undefined);
  mockWeekShopDay._set(null);
  mockForecast._set(null);
});

describe('liveCooks', () => {
  it('resumes a session at the first step not yet done', () => {
    const r = recipe('r1', 'Noodle Bowl', 3, 5);
    mockRecipes._set([r]);
    mockSessions._set([session('r1', ['r1-s0', 'r1-s1'])]);

    expect(get(liveCooks)[0]).toMatchObject({
      stepNumber: 3,
      stepCount: 5,
      completedCount: 2,
    });
    expect(get(liveCooks)[0]?.recipe.title).toBe('Noodle Bowl');
  });

  it('carries EVERY open cook, newest first — a two-pan dinner is two cooks', () => {
    mockRecipes._set([recipe('r1', 'Noodle Bowl', 3, 5), recipe('r2', 'Side Salad', 2, 2)]);
    // The adapter query orders newest-first; the projection preserves that order.
    mockSessions._set([session('r2'), session('r1', ['r1-s0'])]);

    expect(get(liveCooks).map((c) => c.recipe.title)).toEqual(['Side Salad', 'Noodle Bowl']);
  });

  it('ignores step ids that are no longer in the recipe', () => {
    // A step edited out from under the cook must not inflate progress.
    mockRecipes._set([recipe('r1', 'Noodle Bowl', 3, 2)]);
    mockSessions._set([session('r1', ['r1-s0', 'gone-1', 'gone-2'])]);
    expect(get(liveCooks)[0]?.completedCount).toBe(1);
  });

  it('skips a session whose recipe was deleted rather than showing a broken card', () => {
    mockRecipes._set([recipe('r2', 'Still here', 3, 2)]);
    mockSessions._set([session('deleted'), session('r2')]);
    expect(get(liveCooks).map((c) => c.recipe.id)).toEqual(['r2']);
  });

  it('is empty with no sessions — another member does not see my cook', () => {
    expect(get(liveCooks)).toEqual([]);
  });
});

describe('tonight', () => {
  it("marks the night yours when you're the chef, and not when you aren't", () => {
    mockWeek._set(week({ [TODAY]: day({ chefs: [alex.id] }) }));
    expect(get(tonight)?.mine).toBe(true);

    mockCurrentMember._set(sam);
    expect(get(tonight)?.mine).toBe(false);
  });

  it('resolves the planned recipes and chefs, and reports an empty night as unplanned', () => {
    mockRecipes._set([recipe('r1', 'Noodle Bowl')]);
    mockWeek._set(week({ [TODAY]: day({ recipeIds: ['r1'], chefs: [sam.id] }) }));

    const t = get(tonight);
    expect(t?.recipes.map((r) => r.title)).toEqual(['Noodle Bowl']);
    expect(t?.chefs.map((c) => c.name)).toEqual(['Sam Blue']);
    expect(t?.planned).toBe(true);

    mockWeek._set(week({}));
    expect(get(tonight)?.planned).toBe(false);
  });
});

describe('yourWeek', () => {
  it('highlights only my nights and marks the shop', () => {
    mockWeek._set(
      week({
        [TOMORROW]: day({ chefs: [alex.id] }),
        [IN_THREE]: day({ chefs: [sam.id] }),
      }),
    );
    mockWeekShopDay._set(shopDay(IN_TWO));

    const mine = get(yourWeek);
    expect(mine.chefDates).toEqual([TOMORROW]);
    expect(mine.days).toHaveLength(7);
    expect(mine.days.find((d) => d.date === IN_TWO)?.isShopDay).toBe(true);
    expect(mine.days.find((d) => d.date === TODAY)?.isToday).toBe(true);

    mockCurrentMember._set(sam);
    expect(get(yourWeek).chefDates).toEqual([IN_THREE]);
  });
});

describe('needsYou', () => {
  it('leads with the unshopped recipe you are cooking', () => {
    mockRecipes._set([recipe('r1', 'Noodle Bowl', 4)]);
    mockWeek._set(week({ [IN_TWO]: day({ recipeIds: ['r1'], chefs: [alex.id] }) }));

    const cards = get(needsYou);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: 'unshopped-mine', missingCount: 4, urgent: false });
  });

  it('ranks somebody else s night below the list, and shows only one of them', () => {
    mockRecipes._set([
      recipe('r1', 'Pulled Chicken'),
      recipe('r2', 'Fish Pie'),
      recipe('r3', 'Mine'),
    ]);
    mockWeek._set(
      week({
        [TOMORROW]: day({ recipeIds: ['r1'], chefs: [sam.id] }),
        [IN_TWO]: day({ recipeIds: ['r2'], chefs: [sam.id] }),
        [IN_THREE]: day({ recipeIds: ['r3'], chefs: [alex.id] }),
      }),
    );
    mockItems._set([item({ needsCheck: true })]);

    expect(get(needsYou).map((c) => c.kind)).toEqual([
      'unshopped-mine',
      'needs-check',
      'unshopped-other',
    ]);
  });

  it('counts only unchecked flagged items, and says nothing when there are none', () => {
    mockItems._set([
      item({ needsCheck: true }),
      item({ needsCheck: true }),
      item({ needsCheck: true, checked: true }),
      item(),
    ]);
    expect(get(needsYou)).toMatchObject([{ kind: 'needs-check', count: 2 }]);

    mockItems._set([item()]);
    expect(get(needsYou)).toEqual([]);
  });

  it('escalates when the shop is today or tomorrow, but not later in the week', () => {
    mockItems._set([item({ needsCheck: true })]);

    mockUpcomingShopDay._set(shopDay(TOMORROW));
    expect(get(needsYou)[0]?.urgent).toBe(true);

    mockUpcomingShopDay._set(shopDay(IN_THREE));
    expect(get(needsYou)[0]?.urgent).toBe(false);
  });

  it('says nothing about a planned night that has nothing to buy (#637)', () => {
    // A "When you CBA" night — a takeaway, a picnic — is a planned entry with no
    // ingredients, so nothing can ever be added for it and no item can ever carry
    // a source back to it: an unshopped card for it would sit there for ever
    // saying "0 to add". The night alongside it, which DOES have ingredients,
    // still nags. The rule is content-based, never kind-based (`kind` is absent
    // from these fixtures on purpose) — a half-written recipe with no ingredient
    // lines yet is the same non-problem, and the domain layer never learns about
    // recipe kinds to get this right.
    mockRecipes._set([recipe('o1', 'Takeaway — Indian', 0), recipe('r1', 'Noodle Bowl', 4)]);
    mockWeek._set(
      week({
        [TOMORROW]: day({ recipeIds: ['o1'], chefs: [alex.id] }),
        [IN_TWO]: day({ recipeIds: ['r1'], chefs: [alex.id] }),
      }),
    );

    expect(get(needsYou)).toMatchObject([
      { kind: 'unshopped-mine', id: 'unshopped:r1', missingCount: 4 },
    ]);
  });

  it('drops a recipe as soon as anything on the list came from it', () => {
    mockRecipes._set([recipe('r1', 'Noodle Bowl')]);
    mockWeek._set(week({ [IN_TWO]: day({ recipeIds: ['r1'], chefs: [alex.id] }) }));
    expect(get(needsYou)).toHaveLength(1);

    mockItems._set([item({ sources: [{ kind: 'recipe', recipeId: 'r1', servings: 2 }] })]);
    expect(get(needsYou)).toEqual([]);
  });
});

describe('mineOpenCount', () => {
  it('counts every live cook plus the queue, and nothing else', () => {
    expect(get(mineOpenCount)).toBe(0);

    mockRecipes._set([recipe('r1', 'Noodle Bowl', 3, 4), recipe('r2', 'Side Salad', 2, 2)]);
    mockSessions._set([session('r1')]);
    expect(get(mineOpenCount)).toBe(1);

    mockSessions._set([session('r1'), session('r2')]);
    expect(get(mineOpenCount)).toBe(2);

    mockItems._set([item({ needsCheck: true })]);
    expect(get(mineOpenCount)).toBe(3);
  });
});
