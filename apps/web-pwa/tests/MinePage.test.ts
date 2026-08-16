import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Member, Recipe } from '@salt/domain';

// "Mine" (issues #634, #682): what of mine is running right now, and what needs a
// look. The projections are tested in personalViewService.test.ts and the domain
// suite — these assert the SCREEN: three sections, both timer states and their
// actions, cancelling a cook, and the review copy the signal can actually support.

const {
  mockLiveCooks,
  mockMyTimers,
  mockNeedsReview,
  mockRecentChats,
  mockUpcomingNights,
  mockTonight,
  mockTimerNowMs,
  mockCurrentMember,
  mockPush,
  mockPersist,
  mockRemove,
  mockAddToast,
  mockRecipes,
  mockPersistRecipe,
  mockKitchenTeardown,
  mockSubscribeKitchenWeeks,
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
  const mockKitchenTeardown = vi.fn();
  return {
    mockLiveCooks: makeStore<unknown[]>([]),
    mockMyTimers: makeStore<unknown[]>([]),
    mockNeedsReview: makeStore<unknown[]>([]),
    mockRecentChats: makeStore<unknown[]>([]),
    mockUpcomingNights: makeStore<unknown[]>([]),
    mockTonight: makeStore<unknown>(null),
    mockTimerNowMs: makeStore<number>(Date.parse('2026-08-05T12:00:00.000Z')),
    mockCurrentMember: makeStore<unknown>(null),
    mockPush: vi.fn(),
    mockPersist: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
    mockRemove: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
    mockAddToast: vi.fn(),
    mockRecipes: makeStore<unknown[]>([]),
    mockPersistRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
    mockKitchenTeardown,
    mockSubscribeKitchenWeeks: vi.fn(() => mockKitchenTeardown),
  };
});

vi.mock('svelte-spa-router', () => ({ push: mockPush }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: mockAddToast }));
vi.mock('../src/lib/personalViewService.js', () => ({
  liveCooks: mockLiveCooks,
  myTimers: mockMyTimers,
  needsReviewRecipes: mockNeedsReview,
  recentChats: mockRecentChats,
  timerNowMs: mockTimerNowMs,
  tonight: mockTonight,
  upcomingChefNights: mockUpcomingNights,
}));
// Since #828 the page's heading and the header's link read ONE derivation of the
// name, so mirror it here over the same mocked member rather than stubbing a
// string — the heading tests below still drive it from `currentMember`.
vi.mock('../src/lib/membersService.js', async () => {
  const { derived } = await import('svelte/store');
  return {
    currentMember: mockCurrentMember,
    kitchenLabel: derived(mockCurrentMember, ($m) => {
      const name = ($m as Member | null)?.name;
      return name ? `${name.split(' ')[0]}'s Kitchen` : 'My Kitchen';
    }),
  };
});
// The page owns the meal-plan week subscriptions "Cooking soon" projects over.
vi.mock('../src/lib/mealPlanService.js', () => ({
  subscribeKitchenWeeks: mockSubscribeKitchenWeeks,
}));
vi.mock('../src/lib/cookSessionService.js', () => ({
  persistCookSession: mockPersist,
  removeCookSession: mockRemove,
}));
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
  persistRecipe: mockPersistRecipe,
}));

import MinePage from '../src/routes/mine/MinePage.svelte';
import { kitchenPrefs } from '../src/lib/kitchenDashboardPrefs.svelte.js';

const NOW = Date.parse('2026-08-05T12:00:00.000Z');

function recipe(id: string, title: string, overrides: Record<string, unknown> = {}): Recipe {
  return {
    id,
    title,
    kind: 'recipe',
    metadata: { servings: 2 },
    ingredients: [],
    steps: [],
    createdAt: '2026-08-01T11:56:00.000Z',
    updatedAt: '2026-08-01T11:56:00.000Z',
    ...overrides,
  } as unknown as Recipe;
}

/** A recipe as it sits in the review queue: AI-authored, unread. */
function unreviewed(id: string, title: string): Recipe {
  return recipe(id, title, { needs_approval: true });
}

const alex = { id: 'alex@e.org', name: 'Alex Green' } as Member;

function session(recipeId: string) {
  return {
    id: `${recipeId}_uid`,
    recipeId,
    activeTimers: [],
    completedStepIds: [],
    checkedIngredientIds: [],
    checkedPrepIds: [],
  };
}

function liveCook(id: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    session: session(id),
    recipe: recipe(id, title),
    stepNumber: 3,
    stepCount: 12,
    completedCount: 2,
    ...overrides,
  };
}

function mineTimer(
  recipeId: string,
  stepId: string,
  offsetMs: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `${recipeId}_uid::${stepId}`,
    session: session(recipeId),
    recipe: recipe(recipeId, 'Ragu'),
    timer: {
      id: stepId,
      stepId,
      label: null,
      durationMinutes: null,
      endsAt: new Date(NOW + offsetMs).toISOString(),
      notify: false,
    },
    label: 'Simmer the sauce',
    durationMs: 600_000,
    ...overrides,
  };
}

function chefNight(
  date: string,
  daysAway: number,
  day: Partial<{ note: string; recipeIds: string[]; chefs: string[] }> = {},
  recipes: Recipe[] = [],
) {
  return {
    date,
    daysAway,
    recipes,
    day: {
      note: '',
      recipeIds: [],
      chefs: ['alex@e.org'],
      attendees: [],
      guests: 0,
      ...day,
    },
  };
}

function chatDoc(id: string, title: string) {
  return {
    id,
    schemaVersion: 1,
    ownerUid: 'uid',
    recipeId: null,
    title,
    messages: [],
    createdAt: '2026-08-01T11:56:00.000Z',
    updatedAt: '2026-08-04T11:56:00.000Z',
    expiresAt: '2026-08-18T11:56:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPersist.mockResolvedValue({ kind: 'ok', value: undefined });
  mockRemove.mockResolvedValue({ kind: 'ok', value: undefined });
  mockPersistRecipe.mockResolvedValue({ kind: 'ok', value: undefined });
  mockLiveCooks._set([]);
  mockMyTimers._set([]);
  mockNeedsReview._set([]);
  mockRecentChats._set([]);
  mockUpcomingNights._set([]);
  mockTonight._set(null);
  mockRecipes._set([]);
  mockSubscribeKitchenWeeks.mockReturnValue(mockKitchenTeardown);
  mockTimerNowMs._set(NOW);
  mockCurrentMember._set(alex);
  // The workbench is a module-level singleton (in-memory only, CLAUDE.md Rule 3),
  // so it has to be put back to defaults between tests same as any mocked store.
  kitchenPrefs.reset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('MinePage — the sections', () => {
  it('is these sections and nothing else — no week grid, no shopping list', () => {
    mockMyTimers._set([mineTimer('r1', 'r1-s0', 4 * 60_000)]);
    mockLiveCooks._set([liveCook('r2', 'Noodle Bowl')]);
    mockUpcomingNights._set([chefNight('2026-08-08', 3)]);
    mockNeedsReview._set([unreviewed('r3', 'Lemon drizzle traybake')]);
    mockRecentChats._set([chatDoc('c1', 'Sourdough starter')]);

    const { getByTestId, queryByTestId } = render(MinePage);
    expect(getByTestId('mine-timers')).toBeInTheDocument();
    expect(getByTestId('mine-live')).toBeInTheDocument();
    expect(getByTestId('mine-upcoming')).toBeInTheDocument();
    expect(getByTestId('mine-needs-review')).toBeInTheDocument();
    expect(getByTestId('mine-chats')).toBeInTheDocument();

    for (const gone of ['mine-tonight', 'mine-week', 'mine-needs-you', 'mine-footer']) {
      expect(queryByTestId(gone)).not.toBeInTheDocument();
    }
  });

  it('reads an empty page as an achievement, not an absence', () => {
    const { getByTestId, queryByTestId } = render(MinePage);
    expect(getByTestId('mine-empty')).toHaveTextContent("You're all caught up");
    expect(queryByTestId('mine-timers')).not.toBeInTheDocument();
    expect(queryByTestId('mine-live')).not.toBeInTheDocument();
    expect(queryByTestId('mine-upcoming')).not.toBeInTheDocument();
    expect(queryByTestId('mine-needs-review')).not.toBeInTheDocument();
    expect(queryByTestId('mine-chats')).not.toBeInTheDocument();
  });

  it('drops the empty state as soon as anything is live', () => {
    mockMyTimers._set([mineTimer('r1', 'r1-s0', 60_000)]);
    const { queryByTestId } = render(MinePage);
    expect(queryByTestId('mine-empty')).not.toBeInTheDocument();
  });
});

describe('MinePage — the heading', () => {
  it('is the member first name, possessive, over their kitchen', () => {
    const { getByTestId } = render(MinePage);
    expect(getByTestId('mine-page')).toHaveTextContent("Alex's Kitchen");
  });

  it('falls back to "My Kitchen" before the roster has loaded', () => {
    // The members subscription can still be in flight on a cold launch; the page
    // must never render a headless possessive.
    mockCurrentMember._set(null);
    const { getByTestId } = render(MinePage);
    expect(getByTestId('mine-page')).toHaveTextContent('My Kitchen');
  });
});

describe('MinePage — cooking soon', () => {
  it('holds the meal-plan weeks only while the page is mounted', () => {
    // A live week subscription kept alive for a page nobody is looking at is the
    // failure mode; the planner's extension week is unmounted the same way.
    const { unmount } = render(MinePage);
    expect(mockSubscribeKitchenWeeks).toHaveBeenCalledTimes(1);
    expect(mockKitchenTeardown).not.toHaveBeenCalled();

    unmount();
    expect(mockKitchenTeardown).toHaveBeenCalledTimes(1);
  });

  it('names tonight and tomorrow, and dates the rest', () => {
    mockUpcomingNights._set([
      chefNight('2026-08-05', 0),
      chefNight('2026-08-06', 1),
      chefNight('2026-08-09', 4),
    ]);
    const { getAllByTestId } = render(MinePage);

    expect(getAllByTestId('mine-upcoming-when').map((n) => n.textContent?.trim())).toEqual([
      'Tonight',
      'Tomorrow',
      'Sun 9 Aug',
    ]);
  });

  it('says what is planned: the entries, else the note, else nothing yet', () => {
    mockUpcomingNights._set([
      chefNight('2026-08-05', 0, { recipeIds: ['r1', 'r2'] }, [
        recipe('r1', 'Ragu'),
        recipe('r2', 'Focaccia'),
      ]),
      chefNight('2026-08-06', 1, { note: 'something with the leeks' }),
      chefNight('2026-08-07', 2),
    ]);
    const { getAllByTestId } = render(MinePage);

    expect(getAllByTestId('mine-upcoming-meal').map((n) => n.textContent?.trim())).toEqual([
      'Ragu · Focaccia',
      'something with the leeks',
      'Nothing planned yet',
    ]);
  });

  it('opens the recipe when the night has one', async () => {
    mockUpcomingNights._set([
      chefNight('2026-08-06', 1, { recipeIds: ['r1'] }, [recipe('r1', 'Ragu')]),
    ]);
    const { getByTestId } = render(MinePage);

    await fireEvent.click(getByTestId('mine-upcoming-open'));
    expect(mockPush).toHaveBeenCalledWith('/recipes/r1');
  });

  it('opens that day in the planner when the night is a note', async () => {
    // A note lives on the plan document; the planner day is the only place it can
    // be read in full or changed.
    mockUpcomingNights._set([chefNight('2026-08-06', 1, { note: 'leeks' })]);
    const { getByTestId } = render(MinePage);

    await fireEvent.click(getByTestId('mine-upcoming-open'));
    expect(mockPush).toHaveBeenCalledWith('/mealplan/2026-08-06');
  });

  it('is absent entirely when no upcoming night is mine', () => {
    const { queryByTestId } = render(MinePage);
    expect(queryByTestId('mine-upcoming')).not.toBeInTheDocument();
  });

  it('stops the page reading as all-clear — three nights of cooking is not caught up', () => {
    mockUpcomingNights._set([chefNight('2026-08-06', 1)]);
    const { getByTestId, queryByTestId } = render(MinePage);
    expect(queryByTestId('mine-empty')).not.toBeInTheDocument();
    expect(getByTestId('mine-upcoming')).toBeInTheDocument();
  });
});

describe('MinePage — recent chats', () => {
  it('lists the conversations in the order the store hands them over', () => {
    mockRecentChats._set([chatDoc('c1', 'Sourdough starter'), chatDoc('c2', 'Braising a shin')]);
    const { getAllByTestId } = render(MinePage);
    expect(getAllByTestId('mine-chat-title').map((n) => n.textContent?.trim())).toEqual([
      'Sourdough starter',
      'Braising a shin',
    ]);
  });

  it('opens that conversation', async () => {
    mockRecentChats._set([chatDoc('c1', 'Sourdough starter')]);
    const { getByTestId } = render(MinePage);
    await fireEvent.click(getByTestId('mine-chat-open'));
    expect(mockPush).toHaveBeenCalledWith('/chat/c1');
  });

  it('survives the long naive title a chat carries before it is retitled', () => {
    // `text.slice(0, 60)` of the first message, until generateChatTitle replaces it.
    const naive = 'how do i stop my sourdough starter from smelling like ac';
    mockRecentChats._set([chatDoc('c1', naive)]);
    const { getByTestId } = render(MinePage);
    const title = getByTestId('mine-chat-title');
    expect(title).toHaveTextContent(naive);
    // One line, clipped — never wrapped into a growing row.
    expect(title.className).toContain('truncate');
  });

  it('is absent entirely when there are none', () => {
    const { queryByTestId } = render(MinePage);
    expect(queryByTestId('mine-chats')).not.toBeInTheDocument();
  });

  it('does not stop the page reading as all-clear — a chat is not a chore', () => {
    mockRecentChats._set([chatDoc('c1', 'Sourdough starter')]);
    const { getByTestId } = render(MinePage);
    expect(getByTestId('mine-empty')).toHaveTextContent("You're all caught up");
    expect(getByTestId('mine-chats')).toBeInTheDocument();
  });
});

describe('MinePage — timers', () => {
  it('counts a running timer down, and names its action for screen readers', async () => {
    // The buttons are icon-only now, so the accessible name is the ONLY name —
    // asserting it here is what stops the icons becoming unlabelled mystery meat.
    mockMyTimers._set([mineTimer('r1', 'r1-s0', 4 * 60_000 + 500)]);
    const { getByTestId } = render(MinePage);

    expect(getByTestId('mine-timer-label')).toHaveTextContent('Simmer the sauce');
    expect(getByTestId('mine-timer-time')).toHaveTextContent('4:01');
    expect(getByTestId('mine-timer-dismiss')).toHaveAttribute(
      'aria-label',
      'Cancel Simmer the sauce',
    );

    // The clock is shared, not per-card: a tick moves the countdown.
    mockTimerNowMs._set(NOW + 60_000);
    await tick();
    expect(getByTestId('mine-timer-time')).toHaveTextContent('3:01');
  });

  it('says the heat in words, never in colour alone', () => {
    // ui-spec-v02 §7: the ramp is a second encoding on top of the word, never a
    // replacement for it.
    // Soonest-ending first, as `myTimers` really delivers them — which floats the
    // fired one to the top, because whatever ended earliest ended first.
    mockMyTimers._set([
      mineTimer('r1', 'r1-s3', -30_000, { label: 'Step 4' }),
      mineTimer('r1', 'r1-s2', 45_000, { label: 'Step 3' }),
      mineTimer('r1', 'r1-s1', 5 * 60_000, { label: 'Step 2' }),
      mineTimer('r1', 'r1-s0', 40 * 60_000),
    ]);
    const { getAllByTestId } = render(MinePage);

    expect(getAllByTestId('mine-timer-state').map((n) => n.textContent?.trim())).toEqual([
      'Finished',
      'Imminent',
      'Soon',
      'Resting',
    ]);
  });

  it('shows a fired-but-undismissed timer as Finished, and flips Cancel to Dismiss', () => {
    // The gap this closes: the doc has no `firedAt`, so "fired" is derived from the
    // clock — an expired timer sits in `activeTimers` until somebody dismisses it.
    mockMyTimers._set([mineTimer('r1', 'r1-s0', -30_000)]);
    const { getByTestId } = render(MinePage);
    expect(getByTestId('mine-timer-state')).toHaveTextContent('Finished');
    expect(getByTestId('mine-timer-dismiss')).toHaveAttribute(
      'aria-label',
      'Dismiss Simmer the sauce',
    );
  });

  it('lists both states at once, each with its own actions', () => {
    mockMyTimers._set([
      mineTimer('r1', 'r1-s0', -30_000),
      mineTimer('r1', 'r1-s1', 90_000, { label: 'Step 2' }),
    ]);
    const { getAllByTestId } = render(MinePage);

    expect(getAllByTestId('mine-timer-state').map((n) => n.textContent?.trim())).toEqual([
      'Finished',
      'Imminent',
    ]);
    expect(getAllByTestId('mine-timer-goto')).toHaveLength(2);
  });

  it('has no progress bar under a timer — the dial is the progress', () => {
    // The bar that used to sit flush to the card's bottom edge is gone: it was a
    // second, differently-shaped progress language for the same number.
    mockMyTimers._set([mineTimer('r1', 'r1-s0', 90_000)]);
    const { queryByTestId } = render(MinePage);
    expect(queryByTestId('mine-timer-progress')).not.toBeInTheDocument();
  });

  it('dismisses a timer with the same write that cancels one', async () => {
    mockMyTimers._set([mineTimer('r1', 'r1-s0', -30_000)]);
    const { getByTestId } = render(MinePage);

    await fireEvent.click(getByTestId('mine-timer-dismiss'));
    expect(mockPersist).toHaveBeenCalledTimes(1);
    expect(mockPersist.mock.calls[0]?.[0]).toMatchObject({ id: 'r1_uid', activeTimers: [] });
  });

  it('says so when the dismiss write fails rather than pretending it worked', async () => {
    mockPersist.mockResolvedValue({ kind: 'failure', error: { kind: 'StorageError' } });
    mockMyTimers._set([mineTimer('r1', 'r1-s0', -30_000)]);
    const { getByTestId } = render(MinePage);

    await fireEvent.click(getByTestId('mine-timer-dismiss'));
    expect(mockAddToast).toHaveBeenCalledWith("Couldn't update that timer.", 'destructive');
  });

  it('takes you to the cook for that timer', async () => {
    mockMyTimers._set([mineTimer('r1', 'r1-s0', 60_000)]);
    const { getByTestId } = render(MinePage);
    await fireEvent.click(getByTestId('mine-timer-goto'));
    expect(mockPush).toHaveBeenCalledWith('/recipes/r1/cook');
  });
});

describe('MinePage — cooking now', () => {
  it('shows EVERY open cook, each with Go to and Cancel', async () => {
    // A two-pan dinner is two open cooks; showing one and hiding the other would
    // misreport the kitchen.
    mockLiveCooks._set([
      liveCook('r2', 'Side Salad', { stepNumber: 1, stepCount: 3, completedCount: 0 }),
      liveCook('r1', 'Noodle Bowl'),
    ]);
    const { getByTestId, getAllByTestId } = render(MinePage);
    expect(getByTestId('mine-live')).toHaveTextContent('2 on the go');
    expect(getAllByTestId('mine-live-step').map((n) => n.textContent?.trim())).toEqual([
      'Step 1 of 3',
      'Step 3 of 12',
    ]);

    await fireEvent.click(getAllByTestId('mine-live-resume')[1]!);
    expect(mockPush).toHaveBeenCalledWith('/recipes/r1/cook');
  });

  it('cancels a cook by deleting its session', async () => {
    mockLiveCooks._set([liveCook('r1', 'Noodle Bowl')]);
    const { getByTestId } = render(MinePage);

    await fireEvent.click(getByTestId('mine-live-cancel'));
    expect(mockRemove).toHaveBeenCalledWith('r1_uid');
  });

  it('reports a failed cancel', async () => {
    mockRemove.mockResolvedValue({ kind: 'failure', error: { kind: 'StorageError' } });
    mockLiveCooks._set([liveCook('r1', 'Noodle Bowl')]);
    const { getByTestId } = render(MinePage);

    await fireEvent.click(getByTestId('mine-live-cancel'));
    expect(mockAddToast).toHaveBeenCalledWith("Couldn't cancel that cook.", 'destructive');
  });
});

describe('MinePage — needs review', () => {
  it('says what the flag means and offers both ways out of the queue', async () => {
    // The signal is the stored `needs_approval` flag (issue #755): AI-authored,
    // unread. Two ways to clear it, and the copy has to offer both — opening one
    // to fix something, or marking it reviewed from here.
    mockNeedsReview._set([unreviewed('r9', 'Lemon drizzle traybake')]);
    const { getByTestId } = render(MinePage);

    const section = getByTestId('mine-needs-review');
    expect(section).toHaveTextContent('Lemon drizzle traybake');
    expect(section).toHaveTextContent('Not reviewed yet');
    expect(getByTestId('mine-needs-review-hint')).toHaveTextContent(
      "These were written by AI and nobody's read them yet. Open one to fix anything that's off, or mark it reviewed if it looks right.",
    );

    await fireEvent.click(getByTestId('mine-needs-review-open'));
    expect(mockPush).toHaveBeenCalledWith('/recipes/r9');
  });

  it('has no time limit — an ancient unreviewed import still shows', () => {
    mockNeedsReview._set([unreviewed('r9', 'Ancient import')]);
    const { getByTestId, queryByText } = render(MinePage);
    expect(getByTestId('mine-needs-review')).toHaveTextContent('Ancient import');
    // Nothing relative-time about it any more; it is a queue, not news.
    expect(queryByText(/ago/)).not.toBeInTheDocument();
  });

  it('clears the flag from the row, without an editor round-trip', async () => {
    mockNeedsReview._set([unreviewed('r9', 'Lemon drizzle traybake')]);
    mockRecipes._set([unreviewed('r9', 'Lemon drizzle traybake')]);
    const { getByTestId } = render(MinePage);

    await fireEvent.click(getByTestId('mine-needs-review-clear'));

    expect(mockPersistRecipe).toHaveBeenCalledTimes(1);
    const saved = mockPersistRecipe.mock.calls[0]?.[0] as Record<string, unknown>;
    // Dropped, not set false — absent means reviewed. `false` would still be a
    // written field, and nothing in the app reads it that way.
    expect('needs_approval' in saved).toBe(false);
    expect(saved).toMatchObject({ id: 'r9', title: 'Lemon drizzle traybake' });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockAddToast).not.toHaveBeenCalled();
  });

  it('writes the LIVE document, not the row it rendered from', async () => {
    // persistRecipe writes the whole doc, so saving the stale card would roll back
    // whatever onRecipeWritten wrote alongside us.
    mockNeedsReview._set([unreviewed('r9', 'Lemon drizzle traybake')]);
    mockRecipes._set([
      recipe('r9', 'Lemon drizzle traybake', {
        needs_approval: true,
        image: { url: 'https://example.test/hero.webp' },
      }),
    ]);
    const { getByTestId } = render(MinePage);

    await fireEvent.click(getByTestId('mine-needs-review-clear'));
    expect(mockPersistRecipe.mock.calls[0]?.[0]).toMatchObject({
      image: { url: 'https://example.test/hero.webp' },
    });
  });

  it('says so when the clear fails rather than pretending it worked', async () => {
    mockPersistRecipe.mockResolvedValue({ kind: 'failure', error: { kind: 'StorageError' } });
    mockNeedsReview._set([unreviewed('r9', 'Lemon drizzle traybake')]);
    mockRecipes._set([unreviewed('r9', 'Lemon drizzle traybake')]);
    const { getByTestId } = render(MinePage);

    await fireEvent.click(getByTestId('mine-needs-review-clear'));
    expect(mockAddToast).toHaveBeenCalledWith("Couldn't mark that as reviewed.", 'destructive');
    // The row stays put: the store still holds it, so nothing here removes it.
    expect(getByTestId('mine-needs-review')).toHaveTextContent('Lemon drizzle traybake');
  });

  it('ignores a second tap while the first write is in flight', async () => {
    let release: (() => void) | undefined;
    mockPersistRecipe.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ kind: 'ok', value: undefined });
      }),
    );
    mockNeedsReview._set([unreviewed('r9', 'Lemon drizzle traybake')]);
    mockRecipes._set([unreviewed('r9', 'Lemon drizzle traybake')]);
    const { getByTestId } = render(MinePage);

    await fireEvent.click(getByTestId('mine-needs-review-clear'));
    await fireEvent.click(getByTestId('mine-needs-review-clear'));
    expect(mockPersistRecipe).toHaveBeenCalledTimes(1);

    release?.();
  });
});

describe('MinePage — the workbench', () => {
  it('opens the customize sheet from the header', async () => {
    const { getByTestId, getByText } = render(MinePage);
    await fireEvent.click(getByTestId('mine-customize-open'));
    expect(getByText('Customize your kitchen')).toBeInTheDocument();
  });

  it('hides a section the moment its switch is turned off, without touching the others', async () => {
    mockMyTimers._set([mineTimer('r1', 'r1-s0', 4 * 60_000)]);
    mockLiveCooks._set([liveCook('r2', 'Noodle Bowl')]);
    const { getByTestId, queryByTestId } = render(MinePage);

    await fireEvent.click(getByTestId('mine-customize-open'));
    const timersToggle = within(getByTestId('mine-customize-section-timers')).getByRole('switch');
    await fireEvent.click(timersToggle);

    expect(queryByTestId('mine-timers')).not.toBeInTheDocument();
    expect(getByTestId('mine-live')).toBeInTheDocument();
  });

  it('does not repaint a hidden section as "all caught up" — it is still there, just hidden', async () => {
    mockLiveCooks._set([liveCook('r2', 'Noodle Bowl')]);
    const { getByTestId, queryByTestId } = render(MinePage);

    await fireEvent.click(getByTestId('mine-customize-open'));
    const liveToggle = within(getByTestId('mine-customize-section-live')).getByRole('switch');
    await fireEvent.click(liveToggle);

    expect(queryByTestId('mine-live')).not.toBeInTheDocument();
    expect(queryByTestId('mine-empty')).not.toBeInTheDocument();
  });

  it('banners the dish on a cook that is actually under way', () => {
    mockLiveCooks._set([
      liveCook('r2', 'Noodle Bowl', {
        recipe: recipe('r2', 'Noodle Bowl', {
          image: { url: 'https://example.test/noodles.webp', source: 'ai' },
          updatedAt: '2026-08-01T11:56:00.000Z',
        }),
      }),
    ]);
    const { getByTestId } = render(MinePage);
    expect(getByTestId('mine-live-banner')).toHaveAttribute(
      'src',
      expect.stringContaining('https://example.test/noodles.webp'),
    );
  });

  it('puts a photograph nowhere else — a night and an unread import get icons', () => {
    // Photography earns its bytes on the dish in front of you and nowhere else:
    // a 40px crop of a generated hero says less than a calendar glyph, and an
    // unreviewed import's image is itself unreviewed.
    const withImage = { image: { url: 'https://example.test/x.webp', source: 'ai' } };
    mockUpcomingNights._set([
      chefNight('2026-08-06', 1, { recipeIds: ['r1'] }, [recipe('r1', 'Ragu', withImage)]),
    ]);
    mockNeedsReview._set([recipe('r9', 'Traybake', { ...withImage, needs_approval: true })]);

    const { getByTestId } = render(MinePage);
    expect(within(getByTestId('mine-upcoming')).queryByRole('img')).not.toBeInTheDocument();
    expect(within(getByTestId('mine-needs-review')).queryByRole('img')).not.toBeInTheDocument();
  });

  it('drops the cook banner once the imagery switch is off, section stays', async () => {
    mockLiveCooks._set([
      liveCook('r2', 'Noodle Bowl', {
        recipe: recipe('r2', 'Noodle Bowl', {
          image: { url: 'https://example.test/noodles.webp', source: 'ai' },
        }),
      }),
    ]);
    const { getByTestId, queryByTestId } = render(MinePage);
    expect(getByTestId('mine-live-banner')).toBeInTheDocument();

    await fireEvent.click(getByTestId('mine-customize-open'));
    const imageryToggle = within(getByTestId('mine-customize-imagery')).getByRole('switch');
    await fireEvent.click(imageryToggle);

    expect(queryByTestId('mine-live-banner')).not.toBeInTheDocument();
    expect(getByTestId('mine-live')).toBeInTheDocument();
  });

  it('shows a glance tile for a switched-on, non-zero section, and drops it once switched off', async () => {
    mockMyTimers._set([mineTimer('r1', 'r1-s0', 4 * 60_000)]);
    const { getByTestId, queryByTestId } = render(MinePage);
    expect(getByTestId('mine-stats')).toHaveTextContent('1 timer');

    await fireEvent.click(getByTestId('mine-customize-open'));
    const timersToggle = within(getByTestId('mine-customize-section-timers')).getByRole('switch');
    await fireEvent.click(timersToggle);

    expect(queryByTestId('mine-stats')).not.toBeInTheDocument();
  });

  it('restores every default when Reset is pressed', async () => {
    mockMyTimers._set([mineTimer('r1', 'r1-s0', 4 * 60_000)]);
    const { getByTestId, queryByTestId } = render(MinePage);

    await fireEvent.click(getByTestId('mine-customize-open'));
    const timersToggle = within(getByTestId('mine-customize-section-timers')).getByRole('switch');
    await fireEvent.click(timersToggle);
    expect(queryByTestId('mine-timers')).not.toBeInTheDocument();

    await fireEvent.click(getByTestId('mine-customize-reset'));
    expect(getByTestId('mine-timers')).toBeInTheDocument();
  });
});

describe('MinePage — the header', () => {
  it('drops the sub-line when the chips are already saying it', () => {
    // The chips ARE the summary; a sentence counting the same things underneath
    // is the same information twice.
    mockMyTimers._set([mineTimer('r1', 'r1-s0', 60_000)]);
    const { queryByTestId, getByTestId } = render(MinePage);

    expect(getByTestId('mine-stats')).toBeInTheDocument();
    expect(queryByTestId('mine-subhead')).not.toBeInTheDocument();
  });

  it('speaks the sub-line when there are no chips to say it', () => {
    const { getByTestId, queryByTestId } = render(MinePage);
    expect(queryByTestId('mine-stats')).not.toBeInTheDocument();
    expect(getByTestId('mine-subhead')).toHaveTextContent("Nothing's waiting on you.");
  });

  it('makes each chip a jump to the section it counts', async () => {
    mockMyTimers._set([mineTimer('r1', 'r1-s0', 60_000)]);
    mockNeedsReview._set([unreviewed('r9', 'Traybake')]);
    const { getAllByTestId, getByTestId } = render(MinePage);

    const chips = getAllByTestId('mine-stat-chip');
    expect(chips.map((c) => c.textContent?.trim())).toEqual(['1 timer', '1 to review']);

    // jsdom has no layout, so scrollIntoView is a stub — the observable contract
    // is that the target exists, is focusable, and receives focus.
    const target = getByTestId('mine-needs-review');
    target.scrollIntoView = vi.fn();
    expect(target).toHaveAttribute('id', 'mine-section-review');
    expect(target).toHaveAttribute('tabindex', '-1');

    await fireEvent.click(chips[1]!);
    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(target);
  });

  it('pluralises only the counts that read as counts', () => {
    mockMyTimers._set([mineTimer('r1', 'r1-s0', 60_000), mineTimer('r1', 'r1-s1', 90_000)]);
    mockLiveCooks._set([liveCook('r2', 'Noodle Bowl')]);
    const { getAllByTestId } = render(MinePage);

    expect(getAllByTestId('mine-stat-chip').map((c) => c.textContent?.trim())).toEqual([
      '2 timers',
      '1 cooking',
    ]);
  });
});

describe('MinePage — the quiet screen', () => {
  const RAGU = { date: '2026-08-05', note: '', isMine: true, recipes: [recipe('r1', 'Beef ragù')] };

  it("leads with tonight's dinner when the page is otherwise clear", () => {
    mockTonight._set(RAGU);
    const { getByTestId, queryByTestId } = render(MinePage);

    expect(getByTestId('mine-tonight-title')).toHaveTextContent('Beef ragù');
    expect(getByTestId('mine-tonight-kicker')).toHaveTextContent("Tonight · you're cooking");
    // The apologetic card is replaced, not stacked on top of.
    expect(queryByTestId('mine-empty')).not.toBeInTheDocument();
  });

  it("still shows the dinner when it is somebody else's night", () => {
    // Filtering by chef would blank the screen on precisely the evenings someone
    // else has it covered. Whose night it is changes the words, not the card.
    mockTonight._set({ ...RAGU, isMine: false });
    const { getByTestId } = render(MinePage);

    expect(getByTestId('mine-tonight-kicker')).toHaveTextContent('Tonight');
    expect(getByTestId('mine-tonight-kicker')).not.toHaveTextContent("you're cooking");
    expect(getByTestId('mine-tonight-title')).toHaveTextContent('Beef ragù');
  });

  it('claims nothing about what is in the kitchen', () => {
    // A shopping list records intent, not the contents of a cupboard: it cannot
    // see the top-up shop or the jar already in there. Any "you have / you need"
    // line here would be a confident guess, and being wrong once about a
    // four-hour braise taints every section that IS reliable.
    mockTonight._set(RAGU);
    const { getByTestId } = render(MinePage);

    const card = getByTestId('mine-tonight');
    expect(card.textContent).not.toMatch(
      /you'?ve got|you have|missing|ingredients|shopping|need to buy/i,
    );
  });

  it('falls back to the caught-up card when tonight is unplanned', () => {
    mockTonight._set(null);
    const { getByTestId, queryByTestId } = render(MinePage);

    expect(getByTestId('mine-empty')).toHaveTextContent("You're all caught up");
    expect(queryByTestId('mine-tonight')).not.toBeInTheDocument();
  });

  it('stays out of the way entirely while something is still running', () => {
    // It is the QUIET screen: a dinner tonight is not news while a timer is going.
    mockTonight._set(RAGU);
    mockMyTimers._set([mineTimer('r1', 'r1-s0', 60_000)]);
    const { queryByTestId } = render(MinePage);

    expect(queryByTestId('mine-tonight')).not.toBeInTheDocument();
  });

  it('offers the cook and the plan, and nothing that needs a shop', async () => {
    mockTonight._set(RAGU);
    const { getByTestId } = render(MinePage);

    await fireEvent.click(getByTestId('mine-tonight-cook'));
    expect(mockPush).toHaveBeenCalledWith('/recipes/r1/cook');

    await fireEvent.click(getByTestId('mine-tonight-plan'));
    expect(mockPush).toHaveBeenCalledWith('/mealplan/2026-08-05');
  });

  it('headlines a night that is only a note, with no cook button to press', () => {
    mockTonight._set({
      date: '2026-08-05',
      note: 'something with the leeks',
      isMine: true,
      recipes: [],
    });
    const { getByTestId, queryByTestId } = render(MinePage);

    expect(getByTestId('mine-tonight-title')).toHaveTextContent('something with the leeks');
    expect(queryByTestId('mine-tonight-cook')).not.toBeInTheDocument();
    expect(getByTestId('mine-tonight-plan')).toBeInTheDocument();
  });
});
