import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import type { Member, Recipe } from '@salt/domain';
import type { ShoppingDayDoc } from '@salt/domain/schemas';

// "Mine" (issue #634): what needs YOU, right now. The projections themselves are
// tested in personalViewService.test.ts and the domain suite — these assert the
// screen: fixed order, the always-present cards, the zero state, and the actions.

const {
  mockLiveCook,
  mockTonight,
  mockYourWeek,
  mockNeedsYou,
  mockJustHappened,
  mockNowMs,
  mockCurrentMember,
  mockDefaultListId,
  mockItems,
  mockUpcomingShopDay,
  mockPush,
  mockThisWeek,
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
    mockLiveCook: makeStore<unknown>(null),
    mockTonight: makeStore<unknown>(null),
    mockYourWeek: makeStore<unknown>({ days: [], chefDates: [] }),
    mockNeedsYou: makeStore<unknown[]>([]),
    mockJustHappened: makeStore<unknown[]>([]),
    mockNowMs: makeStore<number>(Date.parse('2026-08-01T12:00:00.000Z')),
    mockCurrentMember: makeStore<unknown>(null),
    mockDefaultListId: makeStore<string | null>('list-1'),
    mockItems: makeStore<unknown[]>([]),
    mockUpcomingShopDay: makeStore<unknown>(undefined),
    mockPush: vi.fn(),
    mockThisWeek: vi.fn(),
  };
});

vi.mock('svelte-spa-router', () => ({ push: mockPush }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/personalViewService.js', () => ({
  liveCook: mockLiveCook,
  tonight: mockTonight,
  yourWeek: mockYourWeek,
  needsYou: mockNeedsYou,
  justHappened: mockJustHappened,
  nowMs: mockNowMs,
}));
vi.mock('../src/lib/membersService.js', () => ({ currentMember: mockCurrentMember }));
vi.mock('../src/lib/mealPlanService.js', () => ({ thisWeek: mockThisWeek }));
vi.mock('../src/lib/shoppingListService.svelte.js', () => ({
  defaultListId: mockDefaultListId,
  itemsForActiveList: mockItems,
}));
vi.mock('../src/lib/shoppingDayService.js', () => ({ upcomingShopDay: mockUpcomingShopDay }));
// The add-to-list sheet is mounted by the page; its own behaviour is covered by
// RecipeAddToListSheet.test.ts, so stub the services it pulls in.
vi.mock('../src/lib/recipeService.js', () => ({
  buildRecipeAddPlan: vi.fn(() => []),
  buildMadeSubRows: vi.fn(() => []),
  commitRecipeAddPlan: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  recipeAddPlanItemCount: vi.fn(() => 0),
}));
vi.mock('../src/lib/canonService.js', () => ({
  canonItems: {
    subscribe: (f: (v: unknown[]) => void) => {
      f([]);
      return () => {};
    },
  },
}));

import MinePage from '../src/routes/mine/MinePage.svelte';

const TODAY = '2026-08-05'; // a Wednesday
const THU = '2026-08-06';

function recipe(id: string, title: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    id,
    title,
    metadata: { servings: 2 },
    ingredients: [],
    steps: [],
    createdAt: '2026-08-01T11:56:00.000Z',
    updatedAt: '2026-08-01T11:56:00.000Z',
    ...overrides,
  } as unknown as Recipe;
}

const alex = { id: 'alex@e.org', name: 'Alex Green' } as Member;

function tonightPlan(overrides: Record<string, unknown> = {}) {
  return {
    date: TODAY,
    note: '',
    recipes: [],
    chefs: [],
    mine: false,
    weather: undefined,
    planned: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLiveCook._set(null);
  mockTonight._set(tonightPlan());
  mockYourWeek._set({
    days: [
      { date: TODAY, mine: false, isToday: true, isPast: false, isShopDay: false },
      { date: THU, mine: true, isToday: false, isPast: false, isShopDay: true },
    ],
    chefDates: [THU],
  });
  mockNeedsYou._set([]);
  mockJustHappened._set([]);
  mockCurrentMember._set(alex);
  mockDefaultListId._set('list-1');
  mockItems._set([]);
  mockUpcomingShopDay._set(undefined);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('MinePage — the always-present cards', () => {
  it('renders Tonight and Your week and says nothing needs you, on an empty day', () => {
    // The acceptance case: nothing planned, no shop day — the page is still not
    // blank, and the queue is honestly empty.
    const { getByTestId } = render(MinePage);
    expect(getByTestId('mine-tonight')).toBeInTheDocument();
    expect(getByTestId('mine-tonight-empty')).toHaveTextContent('Nothing planned yet');
    expect(getByTestId('mine-week')).toBeInTheDocument();
    expect(getByTestId('mine-needs-empty')).toHaveTextContent('Nothing needs you.');
    expect(getByTestId('mine-footer')).toHaveTextContent('No shop day set · 0 items on the list');
  });

  it('resets the planner to the current week on open', () => {
    // The week stores are singletons — "tonight" is meaningless against a week the
    // planner was browsing.
    render(MinePage);
    expect(mockThisWeek).toHaveBeenCalled();
  });

  it("marks tonight Yours when you're the chef", () => {
    mockTonight._set(tonightPlan({ mine: true, chefs: [alex], planned: true }));
    const { getByTestId } = render(MinePage);
    expect(getByTestId('mine-tonight-yours')).toHaveTextContent('Yours');
    expect(getByTestId('mine-tonight-chefs')).toHaveTextContent("You're cooking");
  });

  it('names the nights you are down to cook', () => {
    const { getByTestId } = render(MinePage);
    expect(getByTestId('mine-week-line')).toHaveTextContent("You're cooking Thu");
    expect(getByTestId(`mine-week-${THU}`)).toHaveAttribute('data-mine', 'true');
    expect(getByTestId(`mine-week-${TODAY}`)).not.toHaveAttribute('data-mine');
  });
});

describe('MinePage — Live', () => {
  it('leads with the cook in progress and resumes it in one tap', async () => {
    mockLiveCook._set({
      session: { id: 'r1_uid' },
      recipe: recipe('r1', 'Noodle Bowl'),
      stepNumber: 3,
      stepCount: 12,
      completedCount: 2,
    });
    const { getByTestId } = render(MinePage);
    expect(getByTestId('mine-live-step')).toHaveTextContent('Step 3 of 12');

    await fireEvent.click(getByTestId('mine-live-resume'));
    expect(mockPush).toHaveBeenCalledWith('/recipes/r1/cook');
  });

  it('shows nothing live when no cook is open', () => {
    const { queryByTestId } = render(MinePage);
    expect(queryByTestId('mine-live')).not.toBeInTheDocument();
  });
});

describe('MinePage — Needs you', () => {
  it('spells out an unshopped night of yours and offers to add it all', async () => {
    mockNeedsYou._set([
      {
        kind: 'unshopped-mine',
        id: 'unshopped:r1',
        date: THU,
        urgent: false,
        recipe: recipe('r1', 'Noodle Bowl'),
        missingCount: 4,
      },
    ]);
    const { getByTestId } = render(MinePage);
    const card = getByTestId('mine-needs-card');
    expect(card).toHaveTextContent("Thursday's Noodle Bowl");
    expect(card).toHaveTextContent("4 ingredients aren't on the list");

    await fireEvent.click(getByTestId('mine-needs-add-all'));
    // The review sheet opens rather than writing the list behind the user's back.
    expect(document.body.textContent).toContain('Noodle Bowl');
  });

  it('shows the flagged-items card and sends you to the list', async () => {
    mockNeedsYou._set([
      { kind: 'needs-check', id: 'needs-check', date: null, urgent: false, count: 2 },
    ]);
    const { getByTestId, getByText } = render(MinePage);
    expect(getByTestId('mine-needs-card')).toHaveTextContent('2 items on the list need a check');

    await fireEvent.click(getByText('Review'));
    expect(mockPush).toHaveBeenCalledWith('/shopping/list-1');
  });

  it('escalates a card when the shop is tomorrow', () => {
    const tomorrow: ShoppingDayDoc = {
      date: '2026-08-06',
      slot: 'am',
      schemaVersion: 1,
      setBy: 'u',
      setAt: '',
    };
    mockUpcomingShopDay._set(tomorrow);
    mockNeedsYou._set([
      { kind: 'needs-check', id: 'needs-check', date: null, urgent: true, count: 1 },
    ]);
    const { getByTestId } = render(MinePage);
    expect(getByTestId('mine-needs-urgent')).toHaveTextContent('Shopping tomorrow am');
  });
});

describe('MinePage — Just happened', () => {
  it('recovers an import that landed and was never opened', async () => {
    // The share-into-Salt hole: the recipe is safe in Firestore but every pointer
    // to it died with the PWA. One tap gets it back.
    mockJustHappened._set([recipe('r9', 'Lemon drizzle traybake')]);
    const { getByTestId } = render(MinePage);
    const section = getByTestId('mine-just-happened');
    expect(section).toHaveTextContent('Lemon drizzle traybake');
    expect(section).toHaveTextContent('Finished importing 4 min ago');

    await fireEvent.click(getByTestId('mine-just-happened-open'));
    expect(mockPush).toHaveBeenCalledWith('/recipes/r9');
  });

  it('is absent when nothing landed recently', () => {
    const { queryByTestId } = render(MinePage);
    expect(queryByTestId('mine-just-happened')).not.toBeInTheDocument();
  });
});
