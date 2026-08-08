import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
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
  mockTimerNowMs,
  mockCurrentMember,
  mockPush,
  mockPersist,
  mockRemove,
  mockAddToast,
  mockRecipes,
  mockPersistRecipe,
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
    mockLiveCooks: makeStore<unknown[]>([]),
    mockMyTimers: makeStore<unknown[]>([]),
    mockNeedsReview: makeStore<unknown[]>([]),
    mockRecentChats: makeStore<unknown[]>([]),
    mockTimerNowMs: makeStore<number>(Date.parse('2026-08-05T12:00:00.000Z')),
    mockCurrentMember: makeStore<unknown>(null),
    mockPush: vi.fn(),
    mockPersist: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
    mockRemove: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
    mockAddToast: vi.fn(),
    mockRecipes: makeStore<unknown[]>([]),
    mockPersistRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
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
}));
vi.mock('../src/lib/membersService.js', () => ({ currentMember: mockCurrentMember }));
vi.mock('../src/lib/cookSessionService.js', () => ({
  persistCookSession: mockPersist,
  removeCookSession: mockRemove,
}));
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
  persistRecipe: mockPersistRecipe,
}));

import MinePage from '../src/routes/mine/MinePage.svelte';

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
  mockRecipes._set([]);
  mockTimerNowMs._set(NOW);
  mockCurrentMember._set(alex);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('MinePage — the sections', () => {
  it('is these sections and nothing else — no planner, no shopping list', () => {
    mockMyTimers._set([mineTimer('r1', 'r1-s0', 4 * 60_000)]);
    mockLiveCooks._set([liveCook('r2', 'Noodle Bowl')]);
    mockNeedsReview._set([unreviewed('r3', 'Lemon drizzle traybake')]);
    mockRecentChats._set([chatDoc('c1', 'Sourdough starter')]);

    const { getByTestId, queryByTestId } = render(MinePage);
    expect(getByTestId('mine-timers')).toBeInTheDocument();
    expect(getByTestId('mine-live')).toBeInTheDocument();
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
  it('counts a running timer down and offers Cancel', async () => {
    mockMyTimers._set([mineTimer('r1', 'r1-s0', 4 * 60_000 + 500)]);
    const { getByTestId } = render(MinePage);

    expect(getByTestId('mine-timer-label')).toHaveTextContent('Simmer the sauce');
    expect(getByTestId('mine-timer-time')).toHaveTextContent('4:01');
    expect(getByTestId('mine-timer-dismiss')).toHaveTextContent('Cancel');

    // The clock is shared, not per-card: a tick moves the countdown.
    mockTimerNowMs._set(NOW + 60_000);
    await tick();
    expect(getByTestId('mine-timer-time')).toHaveTextContent('3:01');
  });

  it('shows a fired-but-undismissed timer as Finished, and flips Cancel to Dismiss', () => {
    // The gap this closes: the doc has no `firedAt`, so "fired" is derived from the
    // clock — an expired timer sits in `activeTimers` until somebody dismisses it.
    mockMyTimers._set([mineTimer('r1', 'r1-s0', -30_000)]);
    const { getByTestId } = render(MinePage);
    expect(getByTestId('mine-timer-time')).toHaveTextContent('Finished');
    expect(getByTestId('mine-timer-dismiss')).toHaveTextContent('Dismiss');
  });

  it('lists both states at once, each with its own actions', () => {
    mockMyTimers._set([
      mineTimer('r1', 'r1-s0', -30_000),
      mineTimer('r1', 'r1-s1', 90_000, { label: 'Step 2' }),
    ]);
    const { getAllByTestId } = render(MinePage);

    expect(getAllByTestId('mine-timer-time').map((n) => n.textContent?.trim())).toEqual([
      'Finished',
      '1:30',
    ]);
    expect(getAllByTestId('mine-timer-dismiss').map((n) => n.textContent?.trim())).toEqual([
      'Dismiss',
      'Cancel',
    ]);
    expect(getAllByTestId('mine-timer-goto')).toHaveLength(2);
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
