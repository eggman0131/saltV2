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
  mockTimerNowMs,
  mockCurrentMember,
  mockPush,
  mockPersist,
  mockRemove,
  mockAddToast,
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
    mockTimerNowMs: makeStore<number>(Date.parse('2026-08-05T12:00:00.000Z')),
    mockCurrentMember: makeStore<unknown>(null),
    mockPush: vi.fn(),
    mockPersist: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
    mockRemove: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
    mockAddToast: vi.fn(),
  };
});

vi.mock('svelte-spa-router', () => ({ push: mockPush }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: mockAddToast }));
vi.mock('../src/lib/personalViewService.js', () => ({
  liveCooks: mockLiveCooks,
  myTimers: mockMyTimers,
  needsReviewRecipes: mockNeedsReview,
  timerNowMs: mockTimerNowMs,
}));
vi.mock('../src/lib/membersService.js', () => ({ currentMember: mockCurrentMember }));
vi.mock('../src/lib/cookSessionService.js', () => ({
  persistCookSession: mockPersist,
  removeCookSession: mockRemove,
}));

import MinePage from '../src/routes/mine/MinePage.svelte';

const NOW = Date.parse('2026-08-05T12:00:00.000Z');

function recipe(id: string, title: string): Recipe {
  return {
    id,
    title,
    kind: 'recipe',
    metadata: { servings: 2 },
    ingredients: [],
    steps: [],
    createdAt: '2026-08-01T11:56:00.000Z',
    updatedAt: '2026-08-01T11:56:00.000Z',
  } as unknown as Recipe;
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
    timer: { stepId, endsAt: new Date(NOW + offsetMs).toISOString(), notify: false },
    label: 'Simmer the sauce',
    durationMs: 600_000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPersist.mockResolvedValue({ kind: 'ok', value: undefined });
  mockRemove.mockResolvedValue({ kind: 'ok', value: undefined });
  mockLiveCooks._set([]);
  mockMyTimers._set([]);
  mockNeedsReview._set([]);
  mockTimerNowMs._set(NOW);
  mockCurrentMember._set(alex);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('MinePage — the three sections', () => {
  it('is three sections and nothing else — no planner, no shopping list', () => {
    mockMyTimers._set([mineTimer('r1', 'r1-s0', 4 * 60_000)]);
    mockLiveCooks._set([liveCook('r2', 'Noodle Bowl')]);
    mockNeedsReview._set([recipe('r3', 'Lemon drizzle traybake')]);

    const { getByTestId, queryByTestId } = render(MinePage);
    expect(getByTestId('mine-timers')).toBeInTheDocument();
    expect(getByTestId('mine-live')).toBeInTheDocument();
    expect(getByTestId('mine-needs-review')).toBeInTheDocument();

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
  });

  it('drops the empty state as soon as anything is live', () => {
    mockMyTimers._set([mineTimer('r1', 'r1-s0', 60_000)]);
    const { queryByTestId } = render(MinePage);
    expect(queryByTestId('mine-empty')).not.toBeInTheDocument();
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
  it('claims only what the signal supports, and spells out how to clear it', async () => {
    // Viewing a recipe writes nothing, so the old "you haven't opened it yet" was a
    // claim the data could not support. An item clears when somebody SAVES it, and
    // that is not guessable — the section has to say it.
    mockNeedsReview._set([recipe('r9', 'Lemon drizzle traybake')]);
    const { getByTestId } = render(MinePage);

    const section = getByTestId('mine-needs-review');
    expect(section).toHaveTextContent('Lemon drizzle traybake');
    expect(section).toHaveTextContent('Not reviewed yet');
    expect(section).not.toHaveTextContent("haven't opened");
    expect(getByTestId('mine-needs-review-hint')).toHaveTextContent(
      "Nobody's checked these yet. Open one, fix anything that's off, and save it to clear it.",
    );

    await fireEvent.click(getByTestId('mine-needs-review-open'));
    expect(mockPush).toHaveBeenCalledWith('/recipes/r9');
  });

  it('has no time limit — an ancient unsaved import still shows', () => {
    mockNeedsReview._set([recipe('r9', 'Ancient import')]);
    const { getByTestId, queryByText } = render(MinePage);
    expect(getByTestId('mine-needs-review')).toHaveTextContent('Ancient import');
    // Nothing relative-time about it any more; it is a queue, not news.
    expect(queryByText(/ago/)).not.toBeInTheDocument();
  });
});
