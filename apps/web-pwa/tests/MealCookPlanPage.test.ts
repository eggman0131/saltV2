import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { emptyRecipe } from '@salt/domain';
import type { Recipe, Step } from '@salt/domain';
import type { CookSessionDoc } from '@salt/domain/schemas';

// A meal's cook plan (issue #752, phase 4) — `/recipes/:id/cook-plan`.
//
// The arithmetic is `scheduleFor`'s and is tested in the domain suite. What this
// asserts is the SCREEN, and specifically the five promises the phase makes:
//
//   • the meal and its dishes in RUNNING order — the stored order, never re-sorted;
//   • a start clock time per row, counted back from one serve time;
//   • a dish already on the go shows "Step N of M" and goes back into ITS cook mode,
//     while one not started goes to the recipe;
//   • every timer in the meal in one list, cancellable from here;
//   • and — the one that is easy to get wrong — OPENING THE PAGE WRITES NOTHING.
//     A session created on a mere visit would advertise the user as "Cooking now"
//     in Kitchen for having looked at a plan.

const {
  mockRecipes,
  mockIsLoadingRecipes,
  mockCookSession,
  mockLiveCooks,
  mockMyTimers,
  mockKitchenWeeks,
  mockKitchenAnchorDate,
  mockAuth,
  mockPush,
  mockPersist,
  mockInitCookSessionSync,
  mockCookSessionTeardown,
  mockSubscribeKitchenWeeks,
  mockKitchenTeardown,
  mockAddToast,
} = await vi.hoisted(async () => {
  const { makeStore } = await import('./support/testStore.js');
  const mockCookSessionTeardown = vi.fn();
  const mockKitchenTeardown = vi.fn();
  return {
    mockRecipes: makeStore<readonly Recipe[]>([]),
    mockIsLoadingRecipes: makeStore<boolean>(false),
    mockCookSession: makeStore<CookSessionDoc | null>(null),
    mockLiveCooks: makeStore<unknown[]>([]),
    mockMyTimers: makeStore<unknown[]>([]),
    mockKitchenWeeks: makeStore<unknown[]>([]),
    mockKitchenAnchorDate: makeStore<string>(''),
    mockAuth: { user: { uid: 'user-1' } as { uid: string } | null },
    mockPush: vi.fn(),
    mockPersist: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
    mockInitCookSessionSync: vi.fn(() => mockCookSessionTeardown),
    mockCookSessionTeardown,
    mockSubscribeKitchenWeeks: vi.fn(() => mockKitchenTeardown),
    mockKitchenTeardown,
    mockAddToast: vi.fn(),
  };
});

vi.mock('svelte-spa-router', () => ({ push: mockPush }));
vi.mock('../src/lib/nav.js', () => ({ goBack: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: mockAddToast }));
vi.mock('../src/lib/auth.svelte.js', () => ({ auth: mockAuth }));
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
  isLoadingRecipes: mockIsLoadingRecipes,
}));
vi.mock('../src/lib/cookSessionService.js', () => ({
  cookSession: mockCookSession,
  initCookSessionSync: mockInitCookSessionSync,
  persistCookSession: mockPersist,
}));
vi.mock('../src/lib/personalViewService.js', () => ({
  liveCooks: mockLiveCooks,
  myTimers: mockMyTimers,
}));
vi.mock('../src/lib/mealPlanService.js', () => ({
  flushMealPlanWrites: vi.fn().mockResolvedValue(undefined),
  kitchenWeeks: mockKitchenWeeks,
  kitchenAnchorDate: mockKitchenAnchorDate,
  subscribeKitchenWeeks: mockSubscribeKitchenWeeks,
}));

import MealCookPlanPage from '../src/routes/recipes/MealCookPlanPage.svelte';

const MEAL_ID = 'roast';
const UID = 'user-1';

// The page renders clock times in the device's own zone; deriving the expectation
// the same way keeps the assertions true wherever CI happens to be sitting.
const CLOCK = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function dish(id: string, title: string, overrides: Partial<Recipe> = {}): Recipe {
  const base = emptyRecipe(id, '2026-08-01T09:00:00.000Z');
  return {
    ...base,
    title,
    metadata: { ...base.metadata, servings: 4 },
    updatedAt: '2026-08-01T09:00:00.000Z',
    ...overrides,
  };
}

function withCookTime(id: string, title: string, minutes: number | null): Recipe {
  return dish(id, title, {
    metadata: {
      servings: 4,
      cookTimeMinutes: minutes,
      prepTimeMinutes: null,
      totalTimeMinutes: null,
      tags: [],
    },
  });
}

function step(id: string): Step {
  return { id, text: 'do a thing', timer: null, note: null };
}

function session(overrides: Partial<CookSessionDoc> = {}): CookSessionDoc {
  return {
    id: `${MEAL_ID}_${UID}`,
    schemaVersion: 1,
    ownerUid: UID,
    recipeId: MEAL_ID,
    recipeUpdatedAtAtStart: '2026-08-01T09:00:00.000Z',
    checkedIngredientIds: [],
    checkedPrepIds: [],
    completedStepIds: [],
    activeTimers: [],
    serveAt: null,
    createdAt: '2026-08-15T15:00:00.000Z',
    updatedAt: '2026-08-15T15:00:00.000Z',
    ...overrides,
  } as CookSessionDoc;
}

/** A meal built from the three dishes of the issue's worked example. */
function seedRoast(mealOverrides: Partial<Recipe> = {}): void {
  mockRecipes._set([
    dish(MEAL_ID, 'Sunday roast', {
      componentRecipeIds: ['chicken', 'potatoes', 'gravy'],
      ...mealOverrides,
    }),
    withCookTime('chicken', 'Roast chicken', 90),
    withCookTime('potatoes', 'Roast potatoes', 50),
    withCookTime('gravy', 'Onion gravy', 10),
  ]);
}

function renderPage() {
  return render(MealCookPlanPage, { props: { params: { id: MEAL_ID } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPersist.mockResolvedValue({ kind: 'ok', value: undefined });
  mockInitCookSessionSync.mockReturnValue(mockCookSessionTeardown);
  mockSubscribeKitchenWeeks.mockReturnValue(mockKitchenTeardown);
  mockAuth.user = { uid: UID };
  mockRecipes._set([]);
  mockIsLoadingRecipes._set(false);
  mockCookSession._set(null);
  mockLiveCooks._set([]);
  mockMyTimers._set([]);
  mockKitchenWeeks._set([]);
  mockKitchenAnchorDate._set('');
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('MealCookPlanPage — what it is for', () => {
  it('refuses to be a manager for something that is not a meal', () => {
    mockRecipes._set([dish(MEAL_ID, 'Just a curry')]);
    const { getByTestId, queryByTestId } = renderPage();
    expect(getByTestId('cook-plan-not-a-meal')).toHaveTextContent("This isn't a meal");
    expect(queryByTestId('cook-plan-rows')).not.toBeInTheDocument();
  });

  it('OPENING THE PAGE WRITES NOTHING — a visit is not a cook', () => {
    // A session created here would put the user in Kitchen's "Cooking now" for
    // having looked at a plan. Setting a serve time is what creates it.
    seedRoast();
    renderPage();
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("reads the MEAL's own session by deterministic id, and drops it on unmount", () => {
    // Not from `myCookSessions`: that query is capped at five, and a serve time set
    // this morning has to still be there tonight.
    seedRoast();
    const { unmount } = renderPage();
    expect(mockInitCookSessionSync).toHaveBeenCalledWith(`${MEAL_ID}_${UID}`);
    unmount();
    expect(mockCookSessionTeardown).toHaveBeenCalled();
  });

  it('holds the meal-plan weeks only while it is open — they only seed the default', () => {
    seedRoast();
    const { unmount } = renderPage();
    expect(mockSubscribeKitchenWeeks).toHaveBeenCalledTimes(1);
    expect(mockKitchenTeardown).not.toHaveBeenCalled();
    unmount();
    expect(mockKitchenTeardown).toHaveBeenCalledTimes(1);
  });
});

describe('MealCookPlanPage — the running order', () => {
  it('lists the components in STORED order, never re-sorted by cook time', () => {
    // Seeded shortest-first on purpose: a helpful sort would reverse it, and the
    // stored order is the order the user dragged them into.
    mockRecipes._set([
      dish(MEAL_ID, 'Sunday roast', { componentRecipeIds: ['gravy', 'chicken', 'potatoes'] }),
      withCookTime('chicken', 'Roast chicken', 90),
      withCookTime('potatoes', 'Roast potatoes', 50),
      withCookTime('gravy', 'Onion gravy', 10),
    ]);
    const { getAllByTestId } = renderPage();
    expect(getAllByTestId('cook-plan-row-title').map((n) => n.textContent?.trim())).toEqual([
      'Onion gravy',
      'Roast chicken',
      'Roast potatoes',
    ]);
  });

  it('leaves the meal OUT when it is purely a bundle — nothing there to start', () => {
    seedRoast();
    const { getAllByTestId } = renderPage();
    expect(getAllByTestId('cook-plan-row-title').map((n) => n.textContent?.trim())).toEqual([
      'Roast chicken',
      'Roast potatoes',
      'Onion gravy',
    ]);
  });

  it('puts the meal FIRST when it has a method of its own', () => {
    seedRoast({ steps: [step('s1')] });
    const { getAllByTestId } = renderPage();
    expect(getAllByTestId('cook-plan-row-title').map((n) => n.textContent?.trim())).toEqual([
      'Sunday roast',
      'Roast chicken',
      'Roast potatoes',
      'Onion gravy',
    ]);
  });

  it('says every dish is gone rather than rendering an empty plan', () => {
    mockRecipes._set([dish(MEAL_ID, 'Sunday roast', { componentRecipeIds: ['ghost'] })]);
    const { queryAllByTestId, getByTestId } = renderPage();
    expect(queryAllByTestId('cook-plan-row')).toHaveLength(0);
    expect(getByTestId('cook-plan')).toHaveTextContent('Nothing to schedule');
  });
});

describe('MealCookPlanPage — the serve time and the clock', () => {
  it('asks for a serve time before it can schedule anything', () => {
    seedRoast();
    const { getByTestId, getAllByTestId } = renderPage();
    expect(getByTestId('cook-plan-serve-trigger')).toHaveTextContent('Set serve time');
    expect(getByTestId('cook-plan-no-serve-time')).toBeInTheDocument();
    for (const cell of getAllByTestId('cook-plan-row-start')) {
      expect(cell).toHaveTextContent('start when you like');
    }
  });

  it('counts every dish back from the serve time so they all finish together', () => {
    const serveAt = new Date('2026-08-16T19:00:00.000Z');
    seedRoast();
    mockCookSession._set(session({ serveAt: serveAt.toISOString() }));

    const { getByTestId, getAllByTestId } = renderPage();
    expect(getByTestId('cook-plan-serve-trigger')).toHaveTextContent(
      `serving ${CLOCK.format(serveAt)}`,
    );
    const expected = [90, 50, 10].map(
      (m) => `start ${CLOCK.format(new Date(serveAt.getTime() - m * 60_000))}`,
    );
    expect(getAllByTestId('cook-plan-row-start').map((n) => n.textContent?.trim())).toEqual(
      expected,
    );
  });

  it('leaves a dish with no cook time unscheduled rather than dropping it', () => {
    mockRecipes._set([
      dish(MEAL_ID, 'Sunday roast', { componentRecipeIds: ['chicken', 'salad'] }),
      withCookTime('chicken', 'Roast chicken', 90),
      withCookTime('salad', 'Green salad', null),
    ]);
    mockCookSession._set(session({ serveAt: '2026-08-16T19:00:00.000Z' }));

    const { getAllByTestId } = renderPage();
    expect(getAllByTestId('cook-plan-row-title').map((n) => n.textContent?.trim())).toEqual([
      'Roast chicken',
      'Green salad',
    ]);
    expect(getAllByTestId('cook-plan-row-start')[1]).toHaveTextContent('start when you like');
    expect(getAllByTestId('cook-plan-row-cook-time')[1]).toHaveTextContent('No cook time');
  });

  it('calls out the dish whose moment has arrived, and counts the rest down', () => {
    // Serve in an hour: the 90-minute bird is already late, the 30-minute potatoes
    // are half an hour off. Anchored to the real clock so the page's own ticker
    // needs no faking.
    const serveAt = new Date(Date.now() + 60 * 60_000);
    mockRecipes._set([
      dish(MEAL_ID, 'Sunday roast', { componentRecipeIds: ['chicken', 'potatoes'] }),
      withCookTime('chicken', 'Roast chicken', 90),
      withCookTime('potatoes', 'Roast potatoes', 30),
    ]);
    mockCookSession._set(session({ serveAt: serveAt.toISOString() }));

    const { getAllByTestId } = renderPage();
    const when = getAllByTestId('cook-plan-row-when').map((n) => n.textContent?.trim());
    expect(when[0]).toBe('START NOW');
    expect(when[1]).toMatch(/^in 30 min$/);
  });
});

describe('MealCookPlanPage — where a row goes, and how far it has got', () => {
  it('sends a dish already on the go back into ITS cook mode, showing where it is', async () => {
    seedRoast();
    mockLiveCooks._set([
      {
        session: { id: 'chicken_user-1' },
        recipe: withCookTime('chicken', 'Roast chicken', 90),
        stepNumber: 3,
        stepCount: 8,
        completedCount: 2,
      },
    ]);
    const { getAllByTestId, getByTestId } = renderPage();

    expect(getByTestId('cook-plan-row-step')).toHaveTextContent('Step 3 of 8');
    await fireEvent.click(getAllByTestId('cook-plan-row')[0]!);
    expect(mockPush).toHaveBeenCalledWith('/recipes/chicken/cook');
  });

  it('sends a dish nobody has started to the recipe, with no progress claimed', async () => {
    seedRoast();
    const { getAllByTestId, queryByTestId } = renderPage();

    expect(queryByTestId('cook-plan-row-step')).not.toBeInTheDocument();
    await fireEvent.click(getAllByTestId('cook-plan-row')[1]!);
    expect(mockPush).toHaveBeenCalledWith('/recipes/potatoes');
  });

  it('ignores a cook of something that is not in this meal', () => {
    seedRoast();
    mockLiveCooks._set([
      {
        session: { id: 'other_user-1' },
        recipe: dish('other', 'Someone else’s stew'),
        stepNumber: 1,
        stepCount: 4,
        completedCount: 0,
      },
    ]);
    const { queryByTestId } = renderPage();
    expect(queryByTestId('cook-plan-row-step')).not.toBeInTheDocument();
  });
});

describe('MealCookPlanPage — every timer in the meal, in one place', () => {
  function mealTimer(recipeId: string, title: string, endsInMs: number) {
    const sessionDoc = session({ id: `${recipeId}_${UID}`, recipeId });
    return {
      kind: 'cook',
      id: `${recipeId}_${UID}::t1`,
      session: sessionDoc,
      recipe: withCookTime(recipeId, title, 90),
      timer: {
        id: 't1',
        stepId: 's1',
        label: 'Rest the bird',
        durationMinutes: 20,
        endsAt: new Date(Date.now() + endsInMs).toISOString(),
        notify: false,
      },
      label: 'Rest the bird',
      durationMs: 20 * 60_000,
    };
  }

  it('lists a timer running on a component dish', () => {
    seedRoast();
    mockMyTimers._set([mealTimer('chicken', 'Roast chicken', 5 * 60_000)]);
    const { getByTestId } = renderPage();
    expect(getByTestId('cook-plan-timers')).toBeInTheDocument();
    expect(getByTestId('cook-plan-timer-label')).toHaveTextContent('Rest the bird');
    expect(getByTestId('cook-plan-timer-dismiss')).toHaveTextContent('Cancel');
  });

  it('cancels it with the same write that dismisses a fired one — no second mechanism', async () => {
    seedRoast();
    mockMyTimers._set([mealTimer('chicken', 'Roast chicken', 5 * 60_000)]);
    const { getByTestId } = renderPage();

    await fireEvent.click(getByTestId('cook-plan-timer-dismiss'));
    expect(mockPersist).toHaveBeenCalledTimes(1);
    expect(mockPersist.mock.calls[0]?.[0]).toMatchObject({
      id: `chicken_${UID}`,
      activeTimers: [],
    });
  });

  it('says so when the cancel fails rather than pretending it worked', async () => {
    mockPersist.mockResolvedValue({ kind: 'failure', error: { kind: 'StorageError' } });
    seedRoast();
    mockMyTimers._set([mealTimer('chicken', 'Roast chicken', 5 * 60_000)]);
    const { getByTestId } = renderPage();

    await fireEvent.click(getByTestId('cook-plan-timer-dismiss'));
    expect(mockAddToast).toHaveBeenCalledWith("Couldn't update that timer.", 'destructive');
  });

  it('shows a fired-but-undismissed timer as Finished', () => {
    seedRoast();
    mockMyTimers._set([mealTimer('gravy', 'Onion gravy', -30_000)]);
    const { getByTestId } = renderPage();
    expect(getByTestId('cook-plan-timer-time')).toHaveTextContent('Finished');
    expect(getByTestId('cook-plan-timer-dismiss')).toHaveTextContent('Dismiss');
  });

  it('leaves out a timer belonging to a dish outside this meal', () => {
    seedRoast();
    mockMyTimers._set([mealTimer('other', 'Someone else’s stew', 5 * 60_000)]);
    const { queryByTestId } = renderPage();
    expect(queryByTestId('cook-plan-timers')).not.toBeInTheDocument();
  });

  // A standalone kitchen timer (issue #842) rides the same `myTimers` list. It
  // belongs to nobody's cook and therefore to no meal — My Kitchen is its
  // surface, and this page is a meal's timers.
  it('leaves out a standalone kitchen timer, which belongs to no meal at all', () => {
    seedRoast();
    mockMyTimers._set([
      {
        kind: 'kitchen',
        id: 'kitchen::k1',
        timer: {
          id: 'k1',
          label: 'Eggs',
          endsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          durationMinutes: 10,
          notify: true,
        },
        label: 'Eggs',
        durationMs: 600_000,
      },
    ]);
    const { queryByTestId } = renderPage();
    expect(queryByTestId('cook-plan-timers')).not.toBeInTheDocument();
  });
});
