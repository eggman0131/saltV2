import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Recipe } from '@salt/domain';
import type { CookActiveTimerDoc, CookSessionDoc } from '@salt/domain/schemas';

// The personal view's composition layer (issues #634, #682). Everything it reads
// is a store that is already subscribed app-wide, so these tests drive fake stores
// and assert the projection: my timers, my open cooks, and what still wants a look.

const { mockRecipes, mockSessions } = vi.hoisted(() => {
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
    mockRecipes: makeStore<unknown[]>([]),
    mockSessions: makeStore<unknown[]>([]),
  };
});

vi.mock('../src/lib/recipeService.js', () => ({ recipes: mockRecipes }));
vi.mock('../src/lib/cookSessionService.js', () => ({ myCookSessions: mockSessions }));

import {
  firedTimers,
  liveCooks,
  mineOpenCount,
  myTimers,
  needsReviewRecipes,
  timerNowMs,
} from '../src/lib/personalViewService.js';

const NOW = Date.parse('2026-08-05T12:00:00.000Z');

function recipe(id: string, title: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    id,
    schemaVersion: 1,
    kind: 'recipe',
    title,
    description: null,
    ingredients: [],
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
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  } as Recipe;
}

function withSteps(id: string, title: string, count: number, overrides: Partial<Recipe> = {}) {
  return recipe(id, title, {
    steps: Array.from({ length: count }, (_u, i) => ({
      id: `${id}-s${i}`,
      text: `step ${i}`,
      timer: null,
      note: null,
    })),
    ...overrides,
  } as Partial<Recipe>);
}

function session(
  recipeId: string,
  completedStepIds: string[] = [],
  activeTimers: CookActiveTimerDoc[] = [],
): CookSessionDoc {
  return {
    id: `${recipeId}_uid-a`,
    schemaVersion: 1,
    ownerUid: 'uid-a',
    recipeId,
    recipeUpdatedAtAtStart: '2026-07-01T00:00:00.000Z',
    checkedIngredientIds: [],
    completedStepIds,
    activeTimers,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

const timer = (
  stepId: string,
  offsetMs: number,
  overrides: Partial<CookActiveTimerDoc> = {},
): CookActiveTimerDoc => ({
  id: stepId,
  stepId,
  label: null,
  durationMinutes: null,
  endsAt: new Date(NOW + offsetMs).toISOString(),
  notify: false,
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mockRecipes._set([]);
  mockSessions._set([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('liveCooks', () => {
  it('resumes a session at the first step not yet done', () => {
    mockRecipes._set([withSteps('r1', 'Noodle Bowl', 5)]);
    mockSessions._set([session('r1', ['r1-s0', 'r1-s1'])]);

    expect(get(liveCooks)[0]).toMatchObject({
      stepNumber: 3,
      stepCount: 5,
      completedCount: 2,
    });
    expect(get(liveCooks)[0]?.recipe.title).toBe('Noodle Bowl');
  });

  it('carries EVERY open cook, newest first — a two-pan dinner is two cooks', () => {
    mockRecipes._set([withSteps('r1', 'Noodle Bowl', 5), withSteps('r2', 'Side Salad', 2)]);
    // The adapter query orders newest-first; the projection preserves that order.
    mockSessions._set([session('r2'), session('r1', ['r1-s0'])]);

    expect(get(liveCooks).map((c) => c.recipe.title)).toEqual(['Side Salad', 'Noodle Bowl']);
  });

  it('ignores step ids that are no longer in the recipe', () => {
    // A step edited out from under the cook must not inflate progress.
    mockRecipes._set([withSteps('r1', 'Noodle Bowl', 2)]);
    mockSessions._set([session('r1', ['r1-s0', 'gone-1', 'gone-2'])]);
    expect(get(liveCooks)[0]?.completedCount).toBe(1);
  });

  it('skips a session whose recipe was deleted rather than showing a broken card', () => {
    mockRecipes._set([withSteps('r2', 'Still here', 2)]);
    mockSessions._set([session('deleted'), session('r2')]);
    expect(get(liveCooks).map((c) => c.recipe.id)).toEqual(['r2']);
  });

  it('is empty with no sessions — another member does not see my cook', () => {
    expect(get(liveCooks)).toEqual([]);
  });
});

describe('myTimers', () => {
  function timedRecipe(id: string, title: string) {
    return recipe(id, title, {
      steps: [
        {
          id: `${id}-s0`,
          text: 'simmer',
          timer: { durationMinutes: 10, description: 'Simmer the sauce' },
          note: null,
        },
        { id: `${id}-s1`, text: 'rest', timer: { durationMinutes: 5 }, note: null },
      ],
    } as Partial<Recipe>);
  }

  it('lists a running timer with its label, recipe and duration', () => {
    mockRecipes._set([timedRecipe('r1', 'Ragu')]);
    mockSessions._set([session('r1', [], [timer('r1-s0', 4 * 60_000)])]);

    expect(get(myTimers)).toMatchObject([
      { id: 'r1_uid-a::r1-s0', label: 'Simmer the sauce', durationMs: 600_000 },
    ]);
    expect(get(myTimers)[0]?.recipe.title).toBe('Ragu');
  });

  it('lists a fired-but-undismissed timer alongside the running ones (#682)', () => {
    // The gap this phase closes: an expired timer stays in `activeTimers` until it
    // is dismissed, and "fired" is derived from the clock, not from a field.
    mockRecipes._set([timedRecipe('r1', 'Ragu')]);
    mockSessions._set([session('r1', [], [timer('r1-s0', -30_000), timer('r1-s1', 60_000)])]);

    expect(get(myTimers)).toHaveLength(2);
    expect(get(firedTimers).map((t) => t.timer.id)).toEqual(['r1-s0']);
  });

  it('sorts soonest-ending first, so anything already fired floats to the top', () => {
    mockRecipes._set([timedRecipe('r1', 'Ragu')]);
    mockSessions._set([session('r1', [], [timer('r1-s1', 60_000), timer('r1-s0', -30_000)])]);
    expect(get(myTimers).map((t) => t.timer.id)).toEqual(['r1-s0', 'r1-s1']);
  });

  it('falls back to "Step N" without a label, and "Timer" once the step is gone', () => {
    mockRecipes._set([timedRecipe('r1', 'Ragu')]);
    mockSessions._set([session('r1', [], [timer('r1-s1', 60_000), timer('deleted', 90_000)])]);

    expect(get(myTimers).map((t) => t.label)).toEqual(['Step 2', 'Timer']);
    // No step means no duration to scale a progress fill against.
    expect(get(myTimers)[1]?.durationMs).toBeNull();
  });

  it('skips timers on a session whose recipe was deleted', () => {
    mockSessions._set([session('gone', [], [timer('s0', 60_000)])]);
    expect(get(myTimers)).toEqual([]);
  });
});

describe('timerNowMs', () => {
  it('does not tick while nothing is running, and ticks every second once one is', () => {
    // The badge subscribes this from every page, so an interval that ran for ever
    // to serve a badge reading zero would be pure waste.
    const seen: number[] = [];
    const unsub = timerNowMs.subscribe((v) => seen.push(v));
    seen.length = 0;

    vi.advanceTimersByTime(5_000);
    expect(seen).toEqual([]);

    mockRecipes._set([recipe('r1', 'Ragu')]);
    mockSessions._set([session('r1', [], [timer('s0', 60_000)])]);
    seen.length = 0;
    const from = Date.now();

    vi.advanceTimersByTime(3_000);
    expect(seen).toEqual([from + 1_000, from + 2_000, from + 3_000]);

    // Dismissing the last timer disarms it again.
    mockSessions._set([session('r1')]);
    seen.length = 0;
    vi.advanceTimersByTime(5_000);
    expect(seen).toEqual([]);

    unsub();
  });
});

describe('needsReviewRecipes', () => {
  const unreviewed = (id: string, title: string, overrides: Partial<Recipe> = {}) =>
    recipe(id, title, { needs_approval: true, ...overrides } as Partial<Recipe>);

  it('lists what carries the flag, newest first, with no time limit', () => {
    mockRecipes._set([
      unreviewed('old', 'Ancient import', { createdAt: '2025-01-01T00:00:00.000Z' }),
      unreviewed('new', 'Yesterday', { createdAt: '2026-08-04T00:00:00.000Z' }),
    ]);

    expect(get(needsReviewRecipes).map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('leaves out everything the flag is not set on (issue #755)', () => {
    // The queue is the stored flag now, not "updatedAt === createdAt". A recipe
    // typed in by hand and never touched again has been read by the person who
    // typed it — it was never a review item, and used to be one.
    mockRecipes._set([
      unreviewed('flagged', 'URL import'),
      recipe('handwritten', 'Never edited'),
      recipe('cleared', 'Already reviewed', { needs_approval: false } as Partial<Recipe>),
    ]);
    expect(get(needsReviewRecipes).map((r) => r.id)).toEqual(['flagged']);
  });

  it('does not gate on kind — a flagged entry of any kind is in the queue', () => {
    // The isCookable gate went with the derived predicate: only the import flows
    // set the flag, so there is nothing to keep out.
    mockRecipes._set([
      unreviewed('c1', 'Negroni', { kind: 'cocktail' } as Partial<Recipe>),
      recipe('p1', 'Generic Comfort', { kind: 'placeholder' } as Partial<Recipe>),
      recipe('o1', 'Takeaway', { kind: 'outing' } as Partial<Recipe>),
    ]);
    expect(get(needsReviewRecipes).map((r) => r.id)).toEqual(['c1']);
  });
});

describe('mineOpenCount', () => {
  it('counts every open cook plus every FIRED timer, and nothing else', () => {
    expect(get(mineOpenCount)).toBe(0);

    mockRecipes._set([withSteps('r1', 'Noodle Bowl', 4), withSteps('r2', 'Side Salad', 2)]);
    mockSessions._set([session('r1')]);
    expect(get(mineOpenCount)).toBe(1);

    mockSessions._set([session('r1'), session('r2')]);
    expect(get(mineOpenCount)).toBe(2);

    // A timer still counting down is running to plan — it does not want a hand.
    mockSessions._set([session('r1', [], [timer('r1-s0', 60_000)]), session('r2')]);
    expect(get(mineOpenCount)).toBe(2);

    // Once it fires, it does.
    mockSessions._set([session('r1', [], [timer('r1-s0', -1_000)]), session('r2')]);
    expect(get(mineOpenCount)).toBe(3);
  });

  it('leaves the review queue out — a standing queue must not pin a badge', () => {
    mockRecipes._set([recipe('r1', 'Never reviewed', { needs_approval: true } as Partial<Recipe>)]);
    expect(get(needsReviewRecipes)).toHaveLength(1);
    expect(get(mineOpenCount)).toBe(0);
  });
});
