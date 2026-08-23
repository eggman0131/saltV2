import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { checkInTimerId, isCheckInOf } from '@salt/domain';
import type {
  CookActiveTimerDoc,
  CookSessionDoc,
  GuidedPlanDoc,
  IngredientDoc,
  RecipeDoc,
} from '@salt/domain/schemas';

// Guided cook (issue #751, Phase 2). The same jsdom line CookModePage.test.ts
// draws applies verbatim: everything the cook can DO is exercised here, and
// everything that depends on the browser having laid something out is not. jsdom
// measures every box as 0, so `visibleStepId` never resolves from a probe and the
// deck's stops are always `[0]` — the tests are written to work WITH that.
//
// What this file is FOR, over and above the cook-mode suite: the things that
// differ. The prep BOARD in place of the ingredient checklist (issue #767 — one
// card per container, ingredients as the tick rows, its own tick field, its own
// progress, and the "Also get out" remainder that keeps plan drift from hiding an
// ingredient), and the plan's notes under each step's unmodified words. Everything
// shared with plain cook mode — the pager, the timers, the wake lock, the bootstrap
// — is covered there and is the same code path.

const {
  mockAuth,
  mockRecipes,
  mockIsLoadingRecipes,
  mockCookSession,
  mockCookSessionEnded,
  mockIsLoadingCookSession,
  mockGuidedPlan,
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
        subs.forEach((sub) => sub(v));
      },
      _get() {
        return value;
      },
    };
  }
  return {
    mockAuth: { user: { uid: 'user-1' } as { uid: string } | null },
    mockRecipes: makeStore<RecipeDoc[]>([]),
    mockIsLoadingRecipes: makeStore<boolean>(false),
    mockCookSession: makeStore<CookSessionDoc | null>(null),
    mockCookSessionEnded: makeStore<boolean>(false),
    mockIsLoadingCookSession: makeStore<boolean>(false),
    mockGuidedPlan: makeStore<GuidedPlanDoc | null | undefined>(undefined),
  };
});

const { mockCanonItems, mockProductForms, mockWakeLock, mockChime } = vi.hoisted(() => ({
  mockCanonItems: (() => {
    // Settable since issue #871: proving the icon SWAPS from the parent's to the
    // form's needs a canon item that actually has an icon to swap away from.
    let value: unknown[] = [];
    const subs = new Set<(v: unknown[]) => void>();
    return {
      subscribe(fn: (v: unknown[]) => void) {
        subs.add(fn);
        fn(value);
        return () => {
          subs.delete(fn);
        };
      },
      _set(v: unknown[]) {
        value = v;
        subs.forEach((sub) => sub(v));
      },
    };
  })(),
  // The page prefers a product form's own icon over its parent's (issue #871).
  // Settable so a test can put a form in front of it; empty by default, which is
  // what every pre-existing assertion (all about the canon fallback) needs.
  mockProductForms: (() => {
    let value: unknown[] = [];
    const subs = new Set<(v: unknown[]) => void>();
    return {
      subscribe(fn: (v: unknown[]) => void) {
        subs.add(fn);
        fn(value);
        return () => {
          subs.delete(fn);
        };
      },
      _set(v: unknown[]) {
        value = v;
        subs.forEach((sub) => sub(v));
      },
    };
  })(),
  mockWakeLock: { enable: vi.fn(async () => true), disable: vi.fn(async () => {}) },
  mockChime: { primeChime: vi.fn(), playChime: vi.fn() },
}));

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/auth.svelte.js', () => ({ auth: mockAuth }));
vi.mock('../src/lib/canonService.js', () => ({ canonItems: mockCanonItems }));
vi.mock('../src/lib/productFormService.js', () => ({ productForms: mockProductForms }));
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
  isLoadingRecipes: mockIsLoadingRecipes,
}));
vi.mock('../src/lib/wakeLock.js', () => ({
  isWakeLockSupported: vi.fn(() => true),
  createWakeLock: vi.fn(() => mockWakeLock),
}));
vi.mock('../src/lib/chime.js', () => mockChime);
// Long-press on an ingredient row adds it to the default list (issue #714, extended
// to every prep row by #767). The service is faked rather than the action: the
// gesture's own four obligations are covered in longpress.test.ts.
vi.mock('../src/lib/shoppingListService.svelte.js', () => ({
  addItemToDefaultList: vi.fn(async (name: string) => ({
    kind: 'ok' as const,
    value: { itemId: 'item-1', listId: 'list-1', listName: 'Weekly shop', name },
  })),
  deleteItemFromList: vi.fn(async () => ({ kind: 'ok' as const, value: undefined })),
}));
vi.mock('../src/lib/guidedPlanService.js', () => ({
  guidedPlan: mockGuidedPlan,
  initGuidedPlanSync: vi.fn(() => () => {}),
}));
// The same session-service harness plain cook mode's suite uses, and for the same
// reasons: `persistCookSession` echoes into the store on a deferred microtask (the
// tick only lands once it is back through the store), `removeCookSession` clears
// it synchronously (issue #559's load-bearing gap).
vi.mock('../src/lib/cookSessionService.js', () => ({
  cookSession: mockCookSession,
  cookSessionEnded: mockCookSessionEnded,
  isLoadingCookSession: mockIsLoadingCookSession,
  initCookSessionSync: vi.fn(() => () => {}),
  getCookSessionSnapshot: vi.fn(() => mockCookSession._get()),
  persistCookSession: vi.fn(async (session: CookSessionDoc) => {
    await Promise.resolve();
    mockCookSession._set(session);
    return { kind: 'ok' as const, value: undefined };
  }),
  removeCookSession: vi.fn(async () => {
    mockCookSession._set(null);
    await Promise.resolve();
    return { kind: 'ok' as const, value: undefined };
  }),
}));

import GuidedCookPage from '../src/routes/recipes/GuidedCookPage.svelte';
import { push } from 'svelte-spa-router';
import {
  initCookSessionSync,
  persistCookSession,
  removeCookSession,
} from '../src/lib/cookSessionService.js';
import { initGuidedPlanSync } from '../src/lib/guidedPlanService.js';
import { addItemToDefaultList } from '../src/lib/shoppingListService.svelte.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────────
const RECIPE_ID = 'recipe-1';
const UID = 'user-1';
const SESSION_ID = `${RECIPE_ID}_${UID}`;
const RECIPE_UPDATED_AT = '2026-08-01T10:00:00.000Z';

function makeIngredient(over: Partial<IngredientDoc> = {}): IngredientDoc {
  return {
    id: 'ing-1',
    rawText: '2 onions',
    parsed: null,
    canonId: null,
    matchState: 'matched',
    isOptional: false,
    firstUsedInStepId: 'step-1',
    ...over,
  };
}

function makeRecipe(over: Partial<RecipeDoc> = {}): RecipeDoc {
  return {
    id: RECIPE_ID,
    schemaVersion: 1,
    kind: 'recipe',
    title: 'Weeknight ragù',
    description: null,
    ingredients: [
      {
        id: 'group-1',
        name: null,
        items: [
          makeIngredient({ id: 'ing-1', rawText: '2 onions', firstUsedInStepId: 'step-1' }),
          makeIngredient({
            id: 'ing-2',
            rawText: '400g tinned tomatoes',
            firstUsedInStepId: 'step-2',
          }),
        ],
      },
    ],
    steps: [
      { id: 'step-1', text: 'Soften the onions.', timer: null, note: null },
      {
        id: 'step-2',
        text: 'Simmer the sauce.',
        timer: { durationMinutes: 20, description: null },
        note: null,
      },
    ],
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
    componentRecipeIds: [],
    kit: [],
    image: null,
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: RECIPE_UPDATED_AT,
    createdBy: '',
    lastEditedBy: '',
    ...over,
  };
}

function makeCookSession(over: Partial<CookSessionDoc> = {}): CookSessionDoc {
  return {
    id: SESSION_ID,
    schemaVersion: 1,
    ownerUid: UID,
    recipeId: RECIPE_ID,
    recipeUpdatedAtAtStart: RECIPE_UPDATED_AT,
    checkedIngredientIds: [],
    checkedPrepIds: [],
    completedStepIds: [],
    activeTimers: [],
    serveAt: null,
    createdAt: '2026-08-01T11:00:00.000Z',
    updatedAt: '2026-08-01T11:00:00.000Z',
    ...over,
  };
}

/** A plan that accounts for every ingredient in `makeRecipe` — no remainder. */
function makePlan(over: Partial<GuidedPlanDoc> = {}): GuidedPlanDoc {
  return {
    id: RECIPE_ID,
    schemaVersion: 1,
    recipeId: RECIPE_ID,
    recipeUpdatedAtAtSave: RECIPE_UPDATED_AT,
    prep: [
      {
        id: 'prep-1',
        text: 'Dice the onions into 5mm pieces',
        container: 'small bowl',
        ingredientIds: ['ing-1'],
      },
      { id: 'prep-2', text: 'Open the tin of tomatoes', container: null, ingredientIds: ['ing-2'] },
    ],
    stepNotes: [
      {
        stepId: 'step-1',
        container: 'The small bowl — onion',
        setup: 'Small hob burner, medium-low',
        cue: 'A very gentle sizzle, not a crackle',
        checkIns: [],
        lookahead: null,
        getAhead: null,
      },
      // A note that says nothing EXCEPT "check in partway" — the case a note-guard
      // written for the other three lines would hide. It sits on step-2 because
      // that is the fixture's timed step, and a check-in only exists on a step that
      // already carries a timer.
      {
        stepId: 'step-2',
        container: null,
        setup: null,
        cue: null,
        checkIns: [
          { atMinutes: 5, text: 'Give it a stir' },
          { atMinutes: 15, text: "Check it isn't drying out" },
        ],
        lookahead: null,
        getAhead: null,
      },
    ],
    createdAt: RECIPE_UPDATED_AT,
    updatedAt: RECIPE_UPDATED_AT,
    ...over,
  };
}

// ─── Harness ───────────────────────────────────────────────────────────────────
function renderGuidedCook() {
  return render(GuidedCookPage, { props: { params: { id: RECIPE_ID } } });
}

/** The session as it was handed to the most recent write. */
function lastPersisted(): CookSessionDoc {
  const calls = vi.mocked(persistCookSession).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0];
}

/** Step 2's own timer in the most recent write — never one of its check-ins. */
function mainTimer(): CookActiveTimerDoc | undefined {
  return lastPersisted().activeTimers.find((t) => t.id === 'step-2');
}

/**
 * A three-hour braise already running on step 2, with its two check-ins armed:
 * the heat check twenty minutes in and the drying-out check at two hours. Absolute
 * end-times off the current clock, which is exactly how they are written.
 */
function braise(): CookActiveTimerDoc[] {
  const startMs = Date.now();
  const at = (minutes: number) => new Date(startMs + minutes * 60_000).toISOString();
  return [
    {
      id: 'step-2',
      stepId: 'step-2',
      label: 'Braise',
      durationMinutes: 180,
      endsAt: at(180),
      notify: true,
    },
    {
      id: checkInTimerId('step-2', 20),
      stepId: 'step-2',
      label: 'Check the heat',
      durationMinutes: 20,
      endsAt: at(20),
      notify: true,
    },
    {
      id: checkInTimerId('step-2', 120),
      stepId: 'step-2',
      label: "Check it isn't drying out",
      durationMinutes: 120,
      endsAt: at(120),
      notify: true,
    },
  ];
}

/**
 * Set the timer sheet's minutes in ONE input event rather than keystroke by
 * keystroke. `userEvent.type` re-renders the bound field between characters, and a
 * three-digit duration can be read back mid-word ("24" for "240").
 */
async function setSheetMinutes(value: string): Promise<void> {
  const field = await screen.findByTestId('cook-timer-sheet-minutes');
  await fireEvent.input(field, { target: { value } });
}

function chipFor(chips: HTMLElement[], timerId: string): HTMLElement {
  const chip = chips.find((c) => c.dataset['timerId'] === timerId);
  expect(chip).toBeDefined();
  return chip!;
}

async function enterSteps() {
  await userEvent.click(screen.getByTestId('cook-stage-toggle'));
  await screen.findByTestId('cook-steps-view');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.user = { uid: UID };
  mockCanonItems._set([]);
  mockProductForms._set([]);
  mockRecipes._set([makeRecipe()]);
  mockIsLoadingRecipes._set(false);
  mockCookSession._set(makeCookSession());
  mockCookSessionEnded._set(false);
  mockIsLoadingCookSession._set(false);
  mockGuidedPlan._set(makePlan());
});

afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
  document.body.innerHTML = '';
});

describe('GuidedCookPage — the plan it cooks from', () => {
  it('subscribes to this recipe-s plan and to the SAME session plain cook mode uses', () => {
    renderGuidedCook();
    expect(vi.mocked(initGuidedPlanSync)).toHaveBeenCalledWith(RECIPE_ID);
    expect(vi.mocked(initCookSessionSync)).toHaveBeenCalledWith(SESSION_ID);
  });

  it('waits rather than claiming there is no plan while the store is unresolved', () => {
    mockGuidedPlan._set(undefined);
    renderGuidedCook();

    expect(screen.queryByTestId('guided-cook-no-plan')).toBeNull();
    expect(screen.queryByTestId('guided-prep-list')).toBeNull();
  });

  it('offers the plain cook instead when the recipe has no plan', async () => {
    mockGuidedPlan._set(null);
    renderGuidedCook();

    expect(screen.getByTestId('guided-cook-no-plan')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('guided-cook-fallback'));
    expect(vi.mocked(push)).toHaveBeenCalledWith(`/recipes/${RECIPE_ID}/cook`);
  });

  it('opens a fresh session carrying both tick lists', async () => {
    mockCookSession._set(null);
    renderGuidedCook();

    await waitFor(() => expect(vi.mocked(persistCookSession)).toHaveBeenCalled());
    expect(lastPersisted()).toMatchObject({
      id: SESSION_ID,
      ownerUid: UID,
      recipeId: RECIPE_ID,
      recipeUpdatedAtAtStart: RECIPE_UPDATED_AT,
      checkedIngredientIds: [],
      checkedPrepIds: [],
      completedStepIds: [],
    });
  });

  it('leaves the session behind when guided cook is merely closed', async () => {
    renderGuidedCook();
    await userEvent.click(screen.getByTestId('cook-mode-close'));

    expect(vi.mocked(push)).toHaveBeenCalledWith(`/recipes/${RECIPE_ID}`);
    expect(vi.mocked(removeCookSession)).not.toHaveBeenCalled();
  });
});

// ─── The prep board (issue #767) ───────────────────────────────────────────────
//
// The container LEADS the card and the ingredients under each job are what the cook
// ticks. A "Get out" stage (issue #761) used to come before all this — a screen of
// every vessel the plan names — and went with the rewrite: one card per bowl is
// countable here, so a screen to dismiss first bought nothing.

describe('GuidedCookPage — the prep board replaces mise en place', () => {
  /** Two jobs into one bowl, and a third that sets nothing aside. */
  function benchPlan(): GuidedPlanDoc {
    return makePlan({
      prep: [
        {
          id: 'prep-1',
          text: 'Dice the onions',
          container: 'Small bowl',
          ingredientIds: ['ing-1'],
        },
        // The same bowl, typed differently — a hand-edit, or an older plan.
        {
          id: 'prep-2',
          text: 'Open the tin',
          container: '  small   bowl ',
          ingredientIds: ['ing-2'],
        },
        { id: 'prep-3', text: 'Get a big pan out', container: null, ingredientIds: [] },
      ],
    });
  }

  it('opens straight on the board — there is no stage to dismiss first', () => {
    renderGuidedCook();

    expect(screen.getByTestId('guided-prep-list')).toBeInTheDocument();
    expect(screen.queryByTestId('guided-get-out-list')).toBeNull();
    expect(screen.queryByTestId('cook-steps-view')).toBeNull();
  });

  it('collects the jobs that fill one bowl under one card, named as the plan wrote it', () => {
    mockGuidedPlan._set(benchPlan());
    renderGuidedCook();

    const cards = screen.getAllByTestId('guided-prep-card');
    expect(cards).toHaveLength(2);
    // Grouped by the normalised name, headed by the name as AUTHORED — the cook is
    // about to write it on a bowl and read it back off a step note.
    expect(cards[0]!.dataset['containerKey']).toBe('small bowl');
    expect(cards[0]!.querySelector('[data-testid="guided-prep-card-name"]')).toHaveTextContent(
      'Small bowl',
    );
    expect(cards[0]!.querySelectorAll('[data-testid="guided-prep-job"]')).toHaveLength(2);
    // Counting the cards is what answers "how many bowls?" — and the second card is
    // the unheaded one, so it is not a bowl and carries no name.
    expect(cards[1]!.dataset['containerKey']).toBe('');
    expect(cards[1]!.querySelector('[data-testid="guided-prep-card-name"]')).toBeNull();
  });

  it('reads top-to-bottom as bowl → job → amounts', () => {
    renderGuidedCook();

    const card = screen.getAllByTestId('guided-prep-card')[0]!;
    expect(card.querySelector('[data-testid="guided-prep-card-name"]')).toHaveTextContent(
      'small bowl',
    );
    expect(card.querySelector('[data-testid="guided-prep-job-text"]')).toHaveTextContent(
      'Dice the onions into 5mm pieces',
    );
    // The amount comes from the recipe: the job's sentence carries none by design.
    expect(card.querySelector('[data-testid="guided-prep-row"]')).toHaveTextContent('2 onions');
  });

  it('ticks the INGREDIENT, not the job', async () => {
    renderGuidedCook();

    const rows = screen.getAllByTestId('guided-prep-row');
    expect(rows.map((r) => r.dataset['tickId'])).toEqual(['ing-1', 'ing-2']);
    await userEvent.click(rows[0]!);

    await waitFor(() => expect(lastPersisted().checkedPrepIds).toEqual(['ing-1']));
    // The ingredient tick list is a DIFFERENT fact and must not have moved.
    expect(lastPersisted().checkedIngredientIds).toEqual([]);
  });

  it('gives a job that names no ingredient a tick of its own, on its own row', async () => {
    mockGuidedPlan._set(benchPlan());
    renderGuidedCook();

    const rows = screen.getAllByTestId('guided-prep-row');
    expect(rows.map((r) => r.dataset['tickId'])).toEqual(['ing-1', 'ing-2', 'prep-3']);
    expect(rows[2]).toHaveTextContent('Get a big pan out');

    await userEvent.click(rows[2]!);
    await waitFor(() => expect(lastPersisted().checkedPrepIds).toEqual(['prep-3']));
  });

  it('clears a row ticked a second time', async () => {
    mockGuidedPlan._set(benchPlan());
    mockCookSession._set(makeCookSession({ checkedPrepIds: ['ing-1'] }));
    renderGuidedCook();

    await userEvent.click(screen.getAllByTestId('guided-prep-row')[0]!);
    await waitFor(() => expect(lastPersisted().checkedPrepIds).toEqual([]));
  });

  it('reads its ticks back from the session, so a reload resumes where it stopped', () => {
    mockGuidedPlan._set(benchPlan());
    mockCookSession._set(makeCookSession({ checkedPrepIds: ['ing-1'] }));
    renderGuidedCook();

    const rows = screen.getAllByTestId('guided-prep-row');
    expect(rows.map((r) => r.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
  });

  it('counts every tick row on the screen, card by card and overall', () => {
    mockGuidedPlan._set(benchPlan());
    mockCookSession._set(makeCookSession({ checkedPrepIds: ['ing-1'] }));
    renderGuidedCook();

    expect(screen.getByTestId('guided-prep-progress')).toHaveTextContent('1/3');
    expect(screen.getAllByTestId('guided-prep-card-count')[0]).toHaveTextContent('1/2');
  });

  it('is not confused by a tick left behind for a row the plan has dropped', async () => {
    mockCookSession._set(makeCookSession({ checkedPrepIds: ['ing-gone'] }));
    renderGuidedCook();

    expect(screen.getByTestId('guided-prep-progress')).toHaveTextContent('0/2');
    // And ticking still appends rather than replacing — the stale id survives.
    await userEvent.click(screen.getAllByTestId('guided-prep-row')[0]!);
    await waitFor(() => expect(lastPersisted().checkedPrepIds).toEqual(['ing-gone', 'ing-1']));
  });

  it('folds a finished card to one done line, and reopens it on a tap', async () => {
    mockGuidedPlan._set(benchPlan());
    renderGuidedCook();

    const card = () => screen.getAllByTestId('guided-prep-card')[0]!;
    expect(card().querySelector('[data-testid="guided-prep-card-done"]')).toBeNull();

    // The bench clears as the work is done: the last row of the bowl folds it.
    mockCookSession._set(makeCookSession({ checkedPrepIds: ['ing-1'] }));
    await waitFor(() => expect(card().dataset['complete']).toBe('false'));
    mockCookSession._set(makeCookSession({ checkedPrepIds: ['ing-1', 'ing-2'] }));
    await waitFor(() =>
      expect(card().querySelector('[data-testid="guided-prep-card-done"]')).not.toBeNull(),
    );
    expect(card()).toHaveTextContent('Small bowl · done');

    // Looking again never changes what was done — reopening shows the rows, and
    // only a row can clear itself.
    await userEvent.click(card().querySelector('[data-testid="guided-prep-card-done"]')!);
    await waitFor(() =>
      expect(card().querySelectorAll('[data-testid="guided-prep-row"]')).toHaveLength(2),
    );
    expect(
      [...card().querySelectorAll('[data-testid="guided-prep-row"]')].map((r) =>
        r.getAttribute('aria-pressed'),
      ),
    ).toEqual(['true', 'true']);

    // And the reopened header folds it back.
    await userEvent.click(card().querySelector('[data-testid="guided-prep-card-header"]')!);
    await waitFor(() =>
      expect(card().querySelector('[data-testid="guided-prep-card-done"]')).not.toBeNull(),
    );
  });

  it('adds an ingredient row to the shopping list on a long press', async () => {
    renderGuidedCook();
    const row = screen.getAllByTestId('guided-prep-row')[0]!;

    vi.useFakeTimers();
    try {
      row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
      vi.advanceTimersByTime(450);
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => expect(vi.mocked(addItemToDefaultList)).toHaveBeenCalledWith('2 onions'));
    // The hold is not a tick: the row it was held on must not have toggled.
    expect(vi.mocked(persistCookSession)).not.toHaveBeenCalled();
  });

  it('never shows the ingredient checklist — the board IS the list', () => {
    renderGuidedCook();
    expect(screen.queryByTestId('cook-mise-row')).toBeNull();
    // And there is no bulk tick: prep is work you did, not a shelf you can declare
    // gathered in one tap.
    expect(screen.queryByTestId('cook-mise-check-all')).toBeNull();
  });

  it('says so when the plan has no prep at all', () => {
    mockGuidedPlan._set(makePlan({ prep: [] }));
    // Every ingredient is then unaccounted for, so clear them out of the recipe
    // too — this is the "nothing to prep" case, not the drift case.
    mockRecipes._set([makeRecipe({ ingredients: [] })]);
    renderGuidedCook();

    expect(screen.getByTestId('guided-prep-empty')).toBeInTheDocument();
  });

  it('resumes straight into the steps for a cook already past prep', () => {
    mockCookSession._set(makeCookSession({ completedStepIds: ['step-1'] }));
    renderGuidedCook();

    expect(screen.getByTestId('cook-steps-view')).toBeInTheDocument();
    expect(screen.queryByTestId('guided-prep-list')).toBeNull();
  });
});

describe('GuidedCookPage — "Also get out"', () => {
  it('shows nothing when the plan accounts for every ingredient', () => {
    renderGuidedCook();
    expect(screen.queryByTestId('guided-also-get-out')).toBeNull();
  });

  it('lists an ingredient added to the recipe after the plan was written', () => {
    mockRecipes._set([
      makeRecipe({
        ingredients: [
          {
            id: 'group-1',
            name: null,
            items: [
              makeIngredient({ id: 'ing-1' }),
              makeIngredient({ id: 'ing-2', rawText: '400g tinned tomatoes' }),
              makeIngredient({ id: 'ing-3', rawText: 'a handful of basil' }),
            ],
          },
        ],
      }),
    ]);
    renderGuidedCook();

    const rows = screen.getAllByTestId('guided-also-get-out-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('a handful of basil');
    // Counted into the same progress as a prep job — it is a row on this screen.
    expect(screen.getByTestId('guided-prep-progress')).toHaveTextContent('0/3');
  });

  it('ticks a remainder ingredient into the same list, by ingredient id', async () => {
    mockRecipes._set([
      makeRecipe({
        ingredients: [
          {
            id: 'group-1',
            name: null,
            items: [makeIngredient({ id: 'ing-1' }), makeIngredient({ id: 'ing-3' })],
          },
        ],
      }),
    ]);
    renderGuidedCook();

    await userEvent.click(screen.getAllByTestId('guided-also-get-out-row')[0]!);
    await waitFor(() => expect(lastPersisted().checkedPrepIds).toEqual(['ing-3']));
    expect(lastPersisted().checkedIngredientIds).toEqual([]);
  });
});

describe('GuidedCookPage — the steps carry the plan-s notes', () => {
  it('shows the recipe-s own words unchanged, with the plan-s lines underneath', async () => {
    renderGuidedCook();
    await enterSteps();

    const steps = screen.getAllByTestId('cook-step');
    expect(steps[0]).toHaveTextContent('Soften the onions.');
    expect(screen.getByTestId('guided-step-note-container')).toHaveTextContent(
      'The small bowl — onion',
    );
    expect(screen.getByTestId('guided-step-note-setup')).toHaveTextContent(
      'Small hob burner, medium-low',
    );
    expect(screen.getByTestId('guided-step-note-cue')).toHaveTextContent(
      'A very gentle sizzle, not a crackle',
    );
  });

  it('renders no notes block for a step the plan says nothing about', async () => {
    mockGuidedPlan._set(
      makePlan({
        stepNotes: [
          {
            stepId: 'step-1',
            container: 'The small bowl — onion',
            setup: null,
            cue: null,
            checkIns: [],
            lookahead: null,
            getAhead: null,
          },
        ],
      }),
    );
    renderGuidedCook();
    await enterSteps();
    // Asserted on the PLAN-AUTHORED rows, not on the `guided-step-notes` <ul>.
    // Since #761 that list also carries the loose ingredients a step introduces
    // from no bowl, which exist whether or not the plan said anything — so its
    // presence no longer means "the plan annotated this step". Exactly one step is
    // annotated, and none of the other three row kinds appears anywhere.
    expect(screen.getAllByTestId('guided-step-note-container')).toHaveLength(1);
    expect(screen.queryByTestId('guided-step-note-setup')).toBeNull();
    expect(screen.queryByTestId('guided-step-note-cue')).toBeNull();
    expect(screen.queryByTestId('guided-step-check-in')).toBeNull();
  });

  it('omits a line the plan left null rather than inventing one', async () => {
    mockGuidedPlan._set(
      makePlan({
        stepNotes: [
          {
            stepId: 'step-1',
            container: null,
            setup: 'Big pan',
            cue: null,
            checkIns: [],
            lookahead: null,
            getAhead: null,
          },
        ],
      }),
    );
    renderGuidedCook();
    await enterSteps();

    expect(screen.getByTestId('guided-step-note-setup')).toHaveTextContent('Big pan');
    expect(screen.queryByTestId('guided-step-note-container')).toBeNull();
    expect(screen.queryByTestId('guided-step-note-cue')).toBeNull();
  });

  it('renders a note whose step no longer exists as NOTHING', async () => {
    mockGuidedPlan._set(
      makePlan({
        stepNotes: [
          {
            stepId: 'step-gone',
            container: 'A bowl that is not there',
            setup: null,
            cue: null,
            checkIns: [],
            lookahead: null,
            getAhead: null,
          },
        ],
      }),
    );
    renderGuidedCook();
    await enterSteps();

    // Asserted on the plan-authored rows rather than on the `guided-step-notes`
    // <ul>: since #761 that list is "what guided mode adds under this step", and
    // the loose ingredients in it come from the RECIPE, not the plan. What this
    // test is about is that the orphaned note contributes NOTHING — no row, no
    // text, and no re-attachment to a neighbouring step.
    expect(screen.queryByTestId('guided-step-note-container')).toBeNull();
    expect(screen.queryByText('A bowl that is not there')).toBeNull();
  });

  it('lists the check-ins the step-s timer will announce, and when (#751 Phase 3)', async () => {
    renderGuidedCook();
    await enterSteps();

    const rows = screen.getAllByTestId('guided-step-check-in');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('5 min in');
    expect(rows[0]).toHaveTextContent('Give it a stir');
    expect(rows[1]).toHaveTextContent("Check it isn't drying out");
  });

  it('reads as one line — no source indentation leaking through pre-wrap', () => {
    // A check-in is the only note built from more than ONE interpolation, so it is
    // the only one where the component's own source whitespace sits inside the span.
    // With `whitespace-pre-wrap` on that span it was rendered verbatim: a line break
    // and a 28-space indent between the dash and the text, on screen.
    //
    // Asserted on RAW textContent. `toHaveTextContent` collapses whitespace before
    // comparing, so every assertion above this one passed throughout the bug.
    renderGuidedCook();
    return enterSteps().then(() => {
      const raw = screen.getAllByTestId('guided-step-check-in')[0]!.textContent ?? '';
      expect(raw).not.toMatch(/\n\s{4,}/);
      expect(raw.replace(/\s+/g, ' ').trim()).toBe('5 min in — Give it a stir');
    });
  });

  it('shows no check-in on a step whose timer the recipe has since dropped', async () => {
    // Nothing to hang them off, so they are neither shown nor armed — a reminder
    // promised and never delivered is worse than one never promised.
    mockRecipes._set([
      makeRecipe({
        steps: [
          { id: 'step-1', text: 'Soften the onions.', timer: null, note: null },
          { id: 'step-2', text: 'Simmer the sauce.', timer: null, note: null },
        ],
      }),
    ]);
    renderGuidedCook();
    await enterSteps();

    expect(screen.queryByTestId('guided-step-check-in')).toBeNull();
    expect(screen.queryByText(/Give it a stir/)).toBeNull();
  });

  it('never gates the pager on a note — the step is done when the cook says so', async () => {
    renderGuidedCook();
    await enterSteps();

    await userEvent.click(screen.getByTestId('cook-step-done'));
    await waitFor(() => expect(lastPersisted().completedStepIds).toEqual(['step-1']));
  });

  it('keeps the step timer, on the same session as plain cook mode', async () => {
    // Step 1 has no timer; step 2 does. With step 1 done, step 2 is the one the
    // footer acts on and the only expanded step with a timer control.
    mockCookSession._set(makeCookSession({ completedStepIds: ['step-1'] }));
    renderGuidedCook();
    await screen.findByTestId('cook-steps-view');

    await userEvent.click(screen.getByTestId('cook-step-timer-start'));
    // The step's own timer is written under the step's own id, exactly as plain
    // cook mode writes it. (Its check-ins ride alongside — see the suites below.)
    await waitFor(() => expect(mainTimer()).toBeDefined());
    expect(mainTimer()).toMatchObject({ id: 'step-2', stepId: 'step-2', durationMinutes: 20 });
  });
});

// ─── The look-ahead panel (issue #769) ─────────────────────────────────────────
//
// THE ONE PLACE THIS FILE FAKES A MEASUREMENT, and it is worth saying why. The rule
// at the top holds everywhere else: jsdom measures every box as 0, so nothing that
// depends on layout is asserted here. But this panel exists ONLY in a measurement —
// it is written into the gap the current step leaves below itself, and a gap of
// zero is exactly the case where it must NOT appear, so with the real jsdom rects
// there is no state in which it renders at all.
//
// So the two rects the probe actually reads are stubbed, and nothing else is. Every
// rule being stubbed for is stated and tested without a DOM elsewhere —
// `fadeHeightFor` and `fadeFitsLookahead` in cookDeck.test.ts, `nextStepLookahead`
// in @salt/domain. What is checked here is only the wiring between them.

type Rect = { top: number; bottom: number };

function domRect({ top, bottom }: Rect): DOMRect {
  const r = { x: 0, y: top, top, bottom, left: 0, right: 0, width: 0, height: bottom - top };
  return { ...r, toJSON: () => r } as DOMRect;
}

/**
 * `visible` is the step parked at the top of the scroller; `bottom` is where its
 * section ends, so `800 - bottom` is the gap the panel is written into.
 */
function stubStepGeometry({ visible, bottom }: { visible: string; bottom: number }) {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ): DOMRect {
    const el = this as HTMLElement;
    if (el.dataset?.testid === 'cook-steps-view') return domRect({ top: 0, bottom: 800 });
    const stepId = el.dataset?.stepId;
    if (stepId === undefined) return domRect({ top: 0, bottom: 0 });
    // The visible step starts at the top of the scroller; everything else is
    // stacked below it, out of the probe's way.
    return stepId === visible
      ? domRect({ top: 0, bottom })
      : domRect({ top: bottom, bottom: bottom + 600 });
  });
}

describe('GuidedCookPage — the recipe has no plan', () => {
  // No longer an edge case (issue #776). Someone whose default is guided is
  // offered this door on every recipe without a plan, so the screen has to answer
  // "then write me one" rather than pointing at a page and leaving them to find it.
  beforeEach(() => {
    mockGuidedPlan._set(null);
  });

  it('offers to write the plan', async () => {
    renderGuidedCook();
    await screen.findByTestId('guided-cook-no-plan');

    await userEvent.click(screen.getByTestId('guided-cook-write-plan'));
    expect(push).toHaveBeenCalledWith(`/recipes/${RECIPE_ID}/guided`);
  });

  it('still offers to cook it the ordinary way', async () => {
    renderGuidedCook();
    await screen.findByTestId('guided-cook-no-plan');

    await userEvent.click(screen.getByTestId('guided-cook-fallback'));
    expect(push).toHaveBeenCalledWith(`/recipes/${RECIPE_ID}/cook`);
  });

  it('is never an error — the session is untouched either way', () => {
    // Plain cook mode works on the very same session, so nothing already ticked or
    // done is lost by arriving here. Nothing is written on the way through.
    mockCookSession._set(makeCookSession({ completedStepIds: ['step-1'] }));
    renderGuidedCook();

    expect(screen.getByTestId('guided-cook-no-plan')).toBeTruthy();
    expect(vi.mocked(persistCookSession)).not.toHaveBeenCalled();
  });
});

describe('GuidedCookPage — what the plan says is coming', () => {
  let geometry: ReturnType<typeof stubStepGeometry> | null = null;

  afterEach(() => {
    geometry?.mockRestore();
    geometry = null;
  });

  /** A plan whose STEP-1 note carries the look-ahead lines — a look-ahead is
   *  written on the step it is read from, and describes the step after it. */
  function planWithLookahead(over: Record<string, unknown> = {}) {
    return makePlan({
      stepNotes: [
        {
          stepId: 'step-1',
          container: null,
          setup: null,
          cue: null,
          checkIns: [],
          lookahead: 'the sauce reduces by half',
          getAhead: null,
          ...over,
        },
      ],
    } as Partial<GuidedPlanDoc>);
  }

  it('captions the gap with the NEXT step-s line, and numbers it', async () => {
    mockGuidedPlan._set(planWithLookahead());
    geometry = stubStepGeometry({ visible: 'step-1', bottom: 500 });
    renderGuidedCook();
    await enterSteps();

    const panel = await screen.findByTestId('guided-step-lookahead');
    expect(panel).toHaveTextContent('the sauce reduces by half');
    // Step 2 of 2 — the step BELOW the one on screen, not the one on it.
    expect(panel).toHaveTextContent('Next · 2');
    expect(panel).not.toHaveTextContent('Soften the onions');
  });

  it('takes the words from the step on screen, and the number from the one below', () => {
    // THE BUG, at the page. Both steps are annotated; standing on step 1 the panel
    // must read step 1's note (which previews step 2) under the heading "Next · 2".
    // It used to read step 2's note — a correct number over a sentence about a step
    // further down, which is worse than no panel because it reads as authoritative.
    mockGuidedPlan._set(
      makePlan({
        stepNotes: [
          {
            stepId: 'step-1',
            container: null,
            setup: null,
            cue: null,
            checkIns: [],
            lookahead: 'the sauce reduces by half',
            getAhead: null,
          },
          {
            stepId: 'step-2',
            container: null,
            setup: null,
            cue: null,
            checkIns: [],
            lookahead: 'a line about a step that does not exist yet',
            getAhead: null,
          },
        ],
      } as Partial<GuidedPlanDoc>),
    );
    geometry = stubStepGeometry({ visible: 'step-1', bottom: 500 });
    renderGuidedCook();
    return enterSteps().then(async () => {
      const panel = await screen.findByTestId('guided-step-lookahead');
      expect(panel).toHaveTextContent('Next · 2');
      expect(panel).toHaveTextContent('the sauce reduces by half');
      expect(panel).not.toHaveTextContent('does not exist yet');
    });
  });

  it('calls out the part of the next step that has to start now', async () => {
    mockGuidedPlan._set(planWithLookahead({ getAhead: 'Preheat the oven to 200°C' }));
    geometry = stubStepGeometry({ visible: 'step-1', bottom: 500 });
    renderGuidedCook();
    await enterSteps();

    expect(await screen.findByTestId('guided-step-get-ahead')).toHaveTextContent(
      'Preheat the oven to 200°C',
    );
  });

  it('shows a bare get-ahead with no summary beside it', async () => {
    // The case the panel is really for: nothing to say about the next step except
    // that a piece of it cannot wait until you reach it.
    mockGuidedPlan._set(
      planWithLookahead({ lookahead: null, getAhead: 'Take the steak out of the fridge' }),
    );
    geometry = stubStepGeometry({ visible: 'step-1', bottom: 500 });
    renderGuidedCook();
    await enterSteps();

    const panel = await screen.findByTestId('guided-step-lookahead');
    expect(panel).toHaveTextContent('Take the steak out of the fridge');
    expect(panel).not.toHaveTextContent('Next ·');
  });

  it('leaves the plain fade for a plan that says nothing about the next step', async () => {
    // Every plan written before #769 is in this state, and it must look exactly as
    // it did — an empty panel would be a new, worse answer than the old fade.
    mockGuidedPlan._set(makePlan());
    geometry = stubStepGeometry({ visible: 'step-1', bottom: 500 });
    renderGuidedCook();
    await enterSteps();

    expect(screen.queryByTestId('guided-step-lookahead')).toBeNull();
  });

  it('says nothing below the last step, even when the plan wrote it a line', async () => {
    // Not hypothetical: the prompt asks for a look-ahead on every step, and the
    // first plan written against it put "everything is ready" on the final one.
    mockGuidedPlan._set(
      makePlan({
        stepNotes: [
          {
            stepId: 'step-2',
            container: null,
            setup: null,
            cue: null,
            checkIns: [],
            lookahead: 'everything is ready',
            getAhead: null,
          },
        ],
      } as Partial<GuidedPlanDoc>),
    );
    geometry = stubStepGeometry({ visible: 'step-2', bottom: 500 });
    renderGuidedCook();
    await enterSteps();

    expect(screen.queryByTestId('guided-step-lookahead')).toBeNull();
  });

  it('gives the room back when the step-s own words fill the screen', async () => {
    // A step running to the bottom of the viewport leaves only the fade floor, and
    // those last lines are what the cook is reading right now. The panel yields.
    mockGuidedPlan._set(planWithLookahead());
    geometry = stubStepGeometry({ visible: 'step-1', bottom: 790 });
    renderGuidedCook();
    await enterSteps();

    expect(screen.queryByTestId('guided-step-lookahead')).toBeNull();
  });
});

// ─── Amounts (issue #761, Phase 1) ─────────────────────────────────────────────
//
// The governing rule: guided mode never shows less than plain cook mode. Plain
// mode prints an amount on the mise checklist AND again beside the step that first
// uses it; guided mode printed it nowhere. Everything below asserts the amount is
// now on screen — under the prep job that prepares it, inside the bowl a step
// names, or beside a step that uses it out of no bowl at all.

describe('GuidedCookPage — a prep job says how much it prepares', () => {
  it('lists the recipe amounts under the job-s own words, as the rows you tick', () => {
    renderGuidedCook();

    const rows = screen.getAllByTestId('guided-prep-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('2 onions');
    expect(rows[1]).toHaveTextContent('400g tinned tomatoes');
    // The job's sentence is untouched — the amount is added, never spliced in.
    expect(screen.getAllByTestId('guided-prep-job-text')[0]).toHaveTextContent(
      'Dice the onions into 5mm pieces',
    );
  });

  it('a job that names no ingredient has no amount line, only its own row', () => {
    mockGuidedPlan._set(
      makePlan({
        prep: [{ id: 'prep-1', text: 'Get a big pan out', container: null, ingredientIds: [] }],
      }),
    );
    renderGuidedCook();

    expect(screen.queryByTestId('guided-prep-job-text')).toBeNull();
    const rows = screen.getAllByTestId('guided-prep-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dataset['tickId']).toBe('prep-1');
  });

  it('drops an id for an ingredient the recipe no longer has, rather than erroring', () => {
    mockGuidedPlan._set(
      makePlan({
        prep: [
          {
            id: 'prep-1',
            text: 'Dice the onions',
            container: 'small bowl',
            ingredientIds: ['ing-1', 'ing-gone'],
          },
        ],
      }),
    );
    renderGuidedCook();

    const rows = screen.getAllByTestId('guided-prep-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('2 onions');
  });
});

describe('GuidedCookPage — a step says what is in the bowl, and what is not', () => {
  /** step-1 reaches for the bowl prep-1 filled; step-2 for nothing. */
  function matchedPlan(): GuidedPlanDoc {
    return makePlan({
      stepNotes: [
        // Typed with different case and spacing from the prep job's "small bowl",
        // which is exactly how a hand-edited plan drifts.
        {
          stepId: 'step-1',
          container: 'Small  Bowl',
          setup: null,
          cue: null,
          checkIns: [],
          lookahead: null,
          getAhead: null,
        },
      ],
    });
  }

  it('lists what is in the bowl the step names, with amounts', async () => {
    mockGuidedPlan._set(matchedPlan());
    renderGuidedCook();
    await enterSteps();

    const contents = screen.getAllByTestId('guided-step-container-contents');
    expect(contents).toHaveLength(1);
    expect(contents[0]).toHaveTextContent('2 onions');
    // Under the bowl's own name, which is still the row the plan authored.
    expect(screen.getByTestId('guided-step-note-container')).toHaveTextContent('Small Bowl');
  });

  it('does not reprint an ingredient already shown inside the bowl', async () => {
    mockGuidedPlan._set(matchedPlan());
    renderGuidedCook();
    await enterSteps();

    // ing-1 is in the bowl step 1 names, so it is not ALSO loose on step 1. ing-2
    // is prepped by a `container: null` job ("open the tin"), so it is still
    // printed at step 2 — being prepped is not the same as being visible.
    const loose = screen.getAllByTestId('guided-step-loose');
    expect(loose).toHaveLength(1);
    expect(loose[0]).toHaveTextContent('400g tinned tomatoes');
  });

  it('renders the container line unchanged when no job fills that name', async () => {
    // The stock fixture's step-1 asks for "The small bowl — onion" and the prep
    // job filled "small bowl". Graceful fallback: the line the plan wrote, and no
    // contents beneath it — never an error.
    renderGuidedCook();
    await enterSteps();

    expect(screen.getByTestId('guided-step-note-container')).toHaveTextContent(
      'The small bowl — onion',
    );
    expect(screen.queryByTestId('guided-step-container-contents')).toBeNull();
  });

  it('lists a step-s loose ingredients even when the plan annotates it not at all', async () => {
    mockGuidedPlan._set(makePlan({ stepNotes: [] }));
    renderGuidedCook();
    await enterSteps();

    const loose = screen.getAllByTestId('guided-step-loose');
    expect(loose).toHaveLength(2);
    expect(loose[0]).toHaveTextContent('2 onions');
    expect(loose[1]).toHaveTextContent('400g tinned tomatoes');
    expect(screen.queryByTestId('guided-step-note-container')).toBeNull();
  });

  it('shows nothing loose for a step that introduces nothing', async () => {
    mockRecipes._set([
      makeRecipe({
        ingredients: [
          {
            id: 'group-1',
            name: null,
            items: [
              makeIngredient({ id: 'ing-1', firstUsedInStepId: null }),
              makeIngredient({ id: 'ing-2', firstUsedInStepId: null }),
            ],
          },
        ],
      }),
    ]);
    renderGuidedCook();
    await enterSteps();

    expect(screen.queryByTestId('guided-step-loose')).toBeNull();
  });
});

// ─── Check-ins (issue #751, Phase 3) ───────────────────────────────────────────
//
// A check-in is an ORDINARY `activeTimers` entry with a DERIVED id, riding the
// existing Cloud Tasks → push path. So everything below is asserted on the session
// document that gets written: what lands in `activeTimers` IS what gets enqueued,
// and there is no second mechanism to check.

describe('GuidedCookPage — starting a timer arms its check-ins', () => {
  /** Everything the last write armed for step 2's timer. */
  function armed() {
    return lastPersisted().activeTimers.filter((t) => isCheckInOf(t.id, 'step-2'));
  }

  async function startStepTwoTimer(): Promise<void> {
    mockCookSession._set(makeCookSession({ completedStepIds: ['step-1'] }));
    renderGuidedCook();
    await screen.findByTestId('cook-steps-view');
    await userEvent.click(screen.getByTestId('cook-step-timer-start'));
    await waitFor(() => expect(mainTimer()).toBeDefined());
  }

  it('writes one entry per check-in, in the same write as the timer', async () => {
    await startStepTwoTimer();

    expect(armed().map((t) => t.id)).toEqual([
      checkInTimerId('step-2', 5),
      checkInTimerId('step-2', 15),
    ]);
    // The reminder's own words become the entry's label, which is what the push
    // copy and the in-app toast both read — no CF change needed for either.
    expect(armed().map((t) => t.label)).toEqual(['Give it a stir', "Check it isn't drying out"]);
    // Its step, so the notification can say which one; and its OWN run, so the
    // progress fill measures the wait for the nudge rather than for the braise.
    expect(armed()[0]).toMatchObject({ stepId: 'step-2', durationMinutes: 5, notify: true });
  });

  it('anchors every check-in to the moment the timer started', async () => {
    await startStepTwoTimer();

    // Both come off the SAME start instant as the 20-minute main timer, so the
    // offsets are exact without this test owning a clock.
    const mainEnd = Date.parse(mainTimer()!.endsAt);
    expect(Date.parse(armed()[0]!.endsAt)).toBe(mainEnd - 15 * 60_000);
    expect(Date.parse(armed()[1]!.endsAt)).toBe(mainEnd - 5 * 60_000);
  });

  it('arms nothing a duration the cook shortened no longer reaches', async () => {
    mockCookSession._set(makeCookSession({ completedStepIds: ['step-1'] }));
    renderGuidedCook();
    await screen.findByTestId('cook-steps-view');

    await userEvent.click(screen.getByTestId('cook-step-timer-adjust'));
    await setSheetMinutes('10');
    await userEvent.click(screen.getByTestId('cook-timer-sheet-confirm'));

    await waitFor(() => expect(mainTimer()).toBeDefined());
    // Ten minutes does not reach the fifteen-minute reminder.
    expect(armed().map((t) => t.label)).toEqual(['Give it a stir']);
  });

  it('arms none for a timer on a step the plan says nothing about', async () => {
    mockGuidedPlan._set(makePlan({ stepNotes: [] }));
    await startStepTwoTimer();
    expect(armed()).toEqual([]);
  });

  it('arms none for a timer that belongs to no step', async () => {
    renderGuidedCook();
    await userEvent.click(screen.getByTestId('cook-mode-timer'));
    await screen.findByTestId('cook-timer-sheet-confirm');
    await userEvent.click(screen.getByTestId('cook-timer-sheet-confirm'));

    await waitFor(() => expect(lastPersisted().activeTimers).toHaveLength(1));
  });
});

describe('GuidedCookPage — a check-in in the timers bar', () => {
  it('shows a pending check-in as a row you cannot re-time, only call off', async () => {
    mockCookSession._set(makeCookSession({ activeTimers: braise() }));
    renderGuidedCook();

    const chips = await screen.findAllByTestId('cook-timer-chip');
    expect(chips).toHaveLength(3);
    const chip = chipFor(chips, checkInTimerId('step-2', 20));
    expect(chip).toHaveTextContent('Check the heat');
    // Tapping a check-in must not open the sheet: its end-time is anchored to the
    // moment the braise started, and re-timing it from now would detach it.
    expect(chip.querySelector('[data-testid="cook-timer-chip-edit"]')).toBeNull();
    expect(chip.querySelector('[data-testid="cook-timer-chip-dismiss"]')).toBeInTheDocument();
  });

  it('lets a check-in leave on its own once it has fired — nothing to dismiss', async () => {
    const timers = braise();
    // The 20-minute reminder has already gone off. Nobody acknowledged it, and
    // nobody has to.
    timers[1]!.endsAt = new Date(Date.now() - 5_000).toISOString();
    mockCookSession._set(makeCookSession({ activeTimers: timers }));
    renderGuidedCook();

    const chips = await screen.findAllByTestId('cook-timer-chip');
    expect(chips.map((c) => c.dataset['timerId'])).toEqual([
      'step-2',
      checkInTimerId('step-2', 120),
    ]);
    expect(screen.queryByText('Check the heat')).toBeNull();
  });

  it('clears the pending check-ins when the timer they hang off is dismissed', async () => {
    mockCookSession._set(makeCookSession({ activeTimers: braise() }));
    renderGuidedCook();

    const chips = await screen.findAllByTestId('cook-timer-chip');
    await userEvent.click(
      chipFor(chips, 'step-2').querySelector('[data-testid="cook-timer-chip-dismiss"]')!,
    );

    await waitFor(() => expect(lastPersisted().activeTimers).toEqual([]));
  });

  it('calls off one reminder without touching the braise', async () => {
    mockCookSession._set(makeCookSession({ activeTimers: braise() }));
    renderGuidedCook();

    const chips = await screen.findAllByTestId('cook-timer-chip');
    await userEvent.click(
      chipFor(chips, checkInTimerId('step-2', 20)).querySelector(
        '[data-testid="cook-timer-chip-dismiss"]',
      )!,
    );

    await waitFor(() =>
      expect(lastPersisted().activeTimers.map((t) => t.id)).toEqual([
        'step-2',
        checkInTimerId('step-2', 120),
      ]),
    );
  });
});

describe('GuidedCookPage — re-timing a braise that has check-ins armed', () => {
  /** Seeds the braise, re-times it, and hands back the entries it started with —
   *  the SAME objects, because `braise()` reads the clock and calling it twice
   *  would give two sets of end-times a millisecond apart. */
  async function reTimeTo(minutes: string): Promise<CookActiveTimerDoc[]> {
    const original = braise();
    mockCookSession._set(makeCookSession({ activeTimers: original }));
    renderGuidedCook();
    const chips = await screen.findAllByTestId('cook-timer-chip');
    await userEvent.click(
      chipFor(chips, 'step-2').querySelector('[data-testid="cook-timer-chip-edit"]')!,
    );
    await setSheetMinutes(minutes);
    await userEvent.click(screen.getByTestId('cook-timer-sheet-confirm'));
    await waitFor(() => expect(mainTimer()?.durationMinutes).toBe(Number(minutes)));
    return original;
  }

  it('EXTENDING leaves every reminder exactly where it was', async () => {
    const original = await reTimeTo('240');

    // Not re-anchored, not re-derived: the same entries, byte for byte.
    expect(lastPersisted().activeTimers.filter((t) => isCheckInOf(t.id, 'step-2'))).toEqual(
      original.slice(1),
    );
  });

  it('SHORTENING drops the reminders the wait no longer reaches', async () => {
    const original = await reTimeTo('90');

    // The 20-minute heat check is untouched; the 2-hour one never fires.
    expect(lastPersisted().activeTimers.filter((t) => isCheckInOf(t.id, 'step-2'))).toEqual([
      original[1],
    ]);
  });
});

describe('GuidedCookPage — the full-viewport contract', () => {
  it('pulls focus into itself on mount, without dialog semantics', async () => {
    renderGuidedCook();
    const page = await screen.findByTestId('guided-cook-page');

    expect(document.activeElement).toBe(page);
    expect(page).toHaveAttribute('tabindex', '-1');
    // ui-spec-v05 §2.6: a route, not a layer over a page you can return to.
    expect(page).not.toHaveAttribute('role');
    expect(page).not.toHaveAttribute('aria-modal');
  });

  it('has no accessibility violations on the prep list', async () => {
    const { container } = renderGuidedCook();
    await screen.findByTestId('guided-prep-list');
    expect(await axe(container)).toHaveNoViolations();
  });
});

// ─── Product-form icons (issue #871) ──────────────────────────────────────────
// The prep list is the guided-cook twin of cook mode's mise: a row naming a
// PRODUCT FORM shows the form's own picture, not the parent canon item's.
describe('GuidedCookPage — product-form icons in the prep list', () => {
  const CANON_ICON = 'https://example.com/lime.webp';
  const FORM_ICON = 'https://example.com/lime-juice.webp';

  const limeCanon = {
    id: 'c-lime',
    schemaVersion: 5,
    name: 'Lime',
    synonyms: [],
    aisleId: null,
    thumbnail: CANON_ICON,
    embedding: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };

  function limeJuiceForm(over: Record<string, unknown> = {}) {
    return {
      id: 'f-lime-juice',
      schemaVersion: 1,
      matchers: [],
      parentCanonId: 'c-lime',
      label: 'lime juice',
      yield: { formUnit: 'ml', amountPerParent: 30 },
      updatedAt: '2026-07-01T00:00:00.000Z',
      thumbnail: FORM_ICON,
      ...over,
    };
  }

  /** The fixture recipe with its FIRST ingredient (the one prep-1 uses) renamed. */
  function recipeNaming(item: string) {
    const base = makeRecipe();
    const group = base.ingredients[0]!;
    return {
      ...base,
      ingredients: [
        {
          ...group,
          items: [
            {
              ...group.items[0]!,
              rawText: `30ml ${item}`,
              parsed: {
                quantity: { type: 'single' as const, value: 30 },
                unit: 'ml' as const,
                item,
                preparation: [],
                notes: null,
                displayText: null,
              },
              canonId: 'c-lime',
            },
            ...group.items.slice(1),
          ],
        },
      ],
    };
  }

  function iconSrcs(): string[] {
    return screen
      .getAllByTestId('canon-icon-img')
      .map((el) => (el as HTMLImageElement).getAttribute('src') ?? '');
  }

  beforeEach(() => {
    mockCanonItems._set([limeCanon]);
  });

  it('shows the form’s own icon when a prep row names a form', async () => {
    mockProductForms._set([limeJuiceForm()]);
    mockRecipes._set([recipeNaming('lime juice')]);
    renderGuidedCook();
    await screen.findAllByTestId('guided-prep-row');
    expect(iconSrcs().some((src) => src.startsWith(FORM_ICON))).toBe(true);
  });

  it('keeps the parent canon icon when the row names no form', async () => {
    mockProductForms._set([limeJuiceForm()]);
    mockRecipes._set([recipeNaming('lime')]);
    renderGuidedCook();
    await screen.findAllByTestId('guided-prep-row');
    expect(iconSrcs().some((src) => src.startsWith(CANON_ICON))).toBe(true);
    expect(iconSrcs().some((src) => src.startsWith(FORM_ICON))).toBe(false);
  });

  it('falls back to the parent icon when the form has no icon yet', async () => {
    mockProductForms._set([limeJuiceForm({ thumbnail: null })]);
    mockRecipes._set([recipeNaming('lime juice')]);
    renderGuidedCook();
    await screen.findAllByTestId('guided-prep-row');
    expect(iconSrcs().some((src) => src.startsWith(CANON_ICON))).toBe(true);
  });
});
