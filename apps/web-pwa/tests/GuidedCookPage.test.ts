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
// differ. The Get-out stage ahead of any knife work (issue #761), the prep list in
// place of the ingredient checklist (its own tick field, its own progress, and the
// "Also get out" remainder that keeps plan drift from hiding an ingredient), and
// the plan's notes under each step's unmodified words. Everything shared with plain
// cook mode — the pager, the timers, the wake lock, the bootstrap — is covered
// there and is the same code path.

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

const { mockCanonItems, mockWakeLock, mockChime } = vi.hoisted(() => ({
  mockCanonItems: {
    subscribe(fn: (v: never[]) => void) {
      fn([]);
      return () => {};
    },
  },
  mockWakeLock: { enable: vi.fn(async () => true), disable: vi.fn(async () => {}) },
  mockChime: { primeChime: vi.fn(), playChime: vi.fn() },
}));

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/auth.svelte.js', () => ({ auth: mockAuth }));
vi.mock('../src/lib/canonService.js', () => ({ canonItems: mockCanonItems }));
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
  isLoadingRecipes: mockIsLoadingRecipes,
}));
vi.mock('../src/lib/wakeLock.js', () => ({
  isWakeLockSupported: vi.fn(() => true),
  createWakeLock: vi.fn(() => mockWakeLock),
}));
vi.mock('../src/lib/chime.js', () => mockChime);
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
    image: null,
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: RECIPE_UPDATED_AT,
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
    checkedContainerNames: [],
    completedStepIds: [],
    activeTimers: [],
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

/** The one container the stock plan names, as the get-out list keys it. */
const STOCK_VESSEL = 'small bowl';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.user = { uid: UID };
  mockRecipes._set([makeRecipe()]);
  mockIsLoadingRecipes._set(false);
  // The stock session is a cook who has ALREADY fetched their vessels, so every
  // suite below opens where it was written — on the prep list. Get out is a stage
  // ahead of prep (issue #761) and has its own suite, which starts from an
  // untouched session.
  mockCookSession._set(makeCookSession({ checkedContainerNames: [STOCK_VESSEL] }));
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

// ─── Get out (issue #761, Phase 3) ─────────────────────────────────────────────
//
// The stage before the prep list: every vessel the plan names, fetched before the
// first cut rather than discovered halfway through it. Everything below starts
// from an UNTOUCHED session — a cook opening this recipe for the first time —
// because that is the only state the stage is the opening screen for.

describe('GuidedCookPage — Get out', () => {
  /** A plan whose jobs name four vessels, one of them twice. */
  function benchPlan(): GuidedPlanDoc {
    return makePlan({
      prep: [
        {
          id: 'prep-1',
          text: 'Dice the onions',
          container: 'onion bowl',
          ingredientIds: ['ing-1'],
        },
        { id: 'prep-2', text: 'Measure the sugar', container: 'sugar bowl', ingredientIds: [] },
        { id: 'prep-3', text: 'Crush the garlic', container: 'Garlic Bowl', ingredientIds: [] },
        { id: 'prep-4', text: 'Mix the stock', container: 'jug', ingredientIds: ['ing-2'] },
        // The same bowl, typed again — a hand-edit, or an older plan.
        {
          id: 'prep-5',
          text: 'Chop the parsley',
          container: '  garlic   bowl ',
          ingredientIds: [],
        },
      ],
    });
  }

  function freshCook() {
    mockCookSession._set(makeCookSession());
    return renderGuidedCook();
  }

  it('opens on Get out, before any prep job is visible', () => {
    freshCook();

    expect(screen.getByTestId('guided-get-out-list')).toBeInTheDocument();
    expect(screen.queryByTestId('guided-prep-row')).toBeNull();
    expect(screen.queryByTestId('cook-steps-view')).toBeNull();
  });

  it('gives every container the plan names a row — so counting them is the answer', () => {
    mockGuidedPlan._set(benchPlan());
    freshCook();

    const rows = screen.getAllByTestId('guided-get-out-row');
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.textContent?.trim())).toEqual([
      'onion bowl',
      'sugar bowl',
      // Two jobs share this one, so the row says how many bowls it stands for
      // rather than quietly counting them as one.
      '2 × Garlic Bowl',
      'jug',
    ]);
    expect(screen.getByTestId('guided-get-out-progress')).toHaveTextContent('0/4');
  });

  it('records a tick by the container-s normalised name, and nothing else', async () => {
    mockGuidedPlan._set(benchPlan());
    freshCook();

    await userEvent.click(screen.getAllByTestId('guided-get-out-row')[2]!);
    await waitFor(() => expect(lastPersisted().checkedContainerNames).toEqual(['garlic bowl']));
    // The other two tick lists are different facts and must not have moved.
    expect(lastPersisted().checkedPrepIds).toEqual([]);
    expect(lastPersisted().checkedIngredientIds).toEqual([]);
  });

  it('moves on to prep when the cook says everything is out', async () => {
    freshCook();

    await userEvent.click(screen.getByTestId('guided-get-out-next'));
    expect(await screen.findByTestId('guided-prep-list')).toBeInTheDocument();
    expect(screen.queryByTestId('guided-get-out-list')).toBeNull();
    // And prep can go back to the bench, the way the steps can go back to prep.
    await userEvent.click(screen.getByTestId('guided-get-out-back'));
    expect(await screen.findByTestId('guided-get-out-list')).toBeInTheDocument();
  });

  it('never advances on its own — the last tick is not the confirmation', async () => {
    freshCook();

    await userEvent.click(screen.getAllByTestId('guided-get-out-row')[0]!);
    await waitFor(() =>
      expect(screen.getByTestId('guided-get-out-progress')).toHaveTextContent('1/1'),
    );
    expect(screen.getByTestId('guided-get-out-list')).toBeInTheDocument();
  });

  it('restores the ticks on return, alongside everything else', () => {
    // Half-gathered: the cook was interrupted at the cupboard.
    mockGuidedPlan._set(benchPlan());
    mockCookSession._set(makeCookSession({ checkedContainerNames: ['sugar bowl', 'jug'] }));
    renderGuidedCook();

    const rows = screen.getAllByTestId('guided-get-out-row');
    expect(rows.map((r) => r.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
      'true',
    ]);
    expect(screen.getByTestId('guided-get-out-progress')).toHaveTextContent('2/4');
  });

  it('is not confused by a tick left behind for a bowl the plan has renamed', () => {
    mockCookSession._set(makeCookSession({ checkedContainerNames: ['the tureen'] }));
    renderGuidedCook();

    // Counted over the rows on screen, so a stale name cannot make an unfinished
    // bench read as gathered — nor push the cook past a stage they never finished.
    expect(screen.getByTestId('guided-get-out-progress')).toHaveTextContent('0/1');
    expect(screen.getByTestId('guided-get-out-list')).toBeInTheDocument();
  });

  it('skips the stage entirely when the plan names no containers', () => {
    mockGuidedPlan._set(
      makePlan({
        prep: [
          { id: 'prep-1', text: 'Open the tin', container: null, ingredientIds: ['ing-2'] },
          { id: 'prep-2', text: 'Take the butter out', container: '   ', ingredientIds: [] },
        ],
      }),
    );
    freshCook();

    // Not an empty screen, and not a screen to dismiss: the cook opens on prep.
    expect(screen.queryByTestId('guided-get-out-list')).toBeNull();
    expect(screen.getByTestId('guided-prep-list')).toBeInTheDocument();
    // And there is nothing to go back to.
    expect(screen.queryByTestId('guided-get-out-back')).toBeNull();
  });

  it('does not send a cook already past the bench back to it', () => {
    // Nothing ticked here, but the chopping has started — the bowls are plainly
    // already out, and re-ticking them is not work.
    mockCookSession._set(makeCookSession({ checkedPrepIds: ['prep-1'] }));
    renderGuidedCook();

    expect(screen.queryByTestId('guided-get-out-list')).toBeNull();
    expect(screen.getByTestId('guided-prep-list')).toBeInTheDocument();
  });

  it('resumes straight into the steps, past both earlier stages', () => {
    mockCookSession._set(makeCookSession({ completedStepIds: ['step-1'] }));
    renderGuidedCook();

    expect(screen.getByTestId('cook-steps-view')).toBeInTheDocument();
    expect(screen.queryByTestId('guided-get-out-list')).toBeNull();
  });

  it('has no accessibility violations on the get-out list', async () => {
    const { container } = freshCook();
    await screen.findByTestId('guided-get-out-list');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('GuidedCookPage — the prep list replaces mise en place', () => {
  it('lists the plan-s jobs, with the container each one fills', () => {
    renderGuidedCook();

    const rows = screen.getAllByTestId('guided-prep-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Dice the onions into 5mm pieces');
    expect(rows[0]).toHaveTextContent('small bowl');
    // A job with nothing to set aside renders no destination at all.
    expect(screen.getAllByTestId('guided-prep-container')).toHaveLength(1);
  });

  it('never shows the ingredient checklist — the prep list IS the list', () => {
    renderGuidedCook();
    expect(screen.queryByTestId('cook-mise-row')).toBeNull();
    // And there is no bulk tick: a prep list is work you did, not a shelf you can
    // declare gathered in one tap.
    expect(screen.queryByTestId('cook-mise-check-all')).toBeNull();
  });

  it('counts progress over the prep list, not over the ingredients', async () => {
    renderGuidedCook();
    expect(screen.getByTestId('guided-prep-progress')).toHaveTextContent('0/2');

    mockCookSession._set(makeCookSession({ checkedPrepIds: ['prep-1'] }));
    await waitFor(() =>
      expect(screen.getByTestId('guided-prep-progress')).toHaveTextContent('1/2'),
    );
  });

  it('records the prep job that was ticked, and nothing else', async () => {
    renderGuidedCook();
    await userEvent.click(screen.getAllByTestId('guided-prep-row')[0]!);

    await waitFor(() => expect(lastPersisted().checkedPrepIds).toEqual(['prep-1']));
    // The ingredient tick list is a DIFFERENT fact and must not have moved.
    expect(lastPersisted().checkedIngredientIds).toEqual([]);
  });

  it('clears a job ticked a second time', async () => {
    mockCookSession._set(makeCookSession({ checkedPrepIds: ['prep-1'] }));
    renderGuidedCook();

    await userEvent.click(screen.getAllByTestId('guided-prep-row')[0]!);
    await waitFor(() => expect(lastPersisted().checkedPrepIds).toEqual([]));
  });

  it('reads its ticks back from the session, so a reload resumes where it stopped', () => {
    mockCookSession._set(makeCookSession({ checkedPrepIds: ['prep-2'] }));
    renderGuidedCook();

    const rows = screen.getAllByTestId('guided-prep-row');
    expect(rows[0]).toHaveAttribute('aria-pressed', 'false');
    expect(rows[1]).toHaveAttribute('aria-pressed', 'true');
  });

  it('is not confused by a tick left behind for a job the plan has dropped', async () => {
    mockCookSession._set(makeCookSession({ checkedPrepIds: ['prep-gone'] }));
    renderGuidedCook();

    expect(screen.getByTestId('guided-prep-progress')).toHaveTextContent('0/2');
    // And ticking still appends rather than replacing — the stale id survives.
    await userEvent.click(screen.getAllByTestId('guided-prep-row')[0]!);
    await waitFor(() => expect(lastPersisted().checkedPrepIds).toEqual(['prep-gone', 'prep-1']));
  });

  it('says so when the plan has no prep at all', () => {
    mockGuidedPlan._set(makePlan({ prep: [] }));
    // Every ingredient is then unaccounted for, so clear them out of the recipe
    // too — this is the "nothing to prep" case, not the drift case.
    mockRecipes._set([makeRecipe({ ingredients: [] })]);
    renderGuidedCook();

    expect(screen.getByTestId('guided-prep-empty')).toBeInTheDocument();
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
          { stepId: 'step-1', container: null, setup: 'Big pan', cue: null, checkIns: [] },
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

// ─── Amounts (issue #761, Phase 1) ─────────────────────────────────────────────
//
// The governing rule: guided mode never shows less than plain cook mode. Plain
// mode prints an amount on the mise checklist AND again beside the step that first
// uses it; guided mode printed it nowhere. Everything below asserts the amount is
// now on screen — under the prep job that prepares it, inside the bowl a step
// names, or beside a step that uses it out of no bowl at all.

describe('GuidedCookPage — a prep job says how much it prepares', () => {
  it('lists the recipe amounts under the job-s own words', () => {
    renderGuidedCook();

    const lines = screen.getAllByTestId('guided-prep-ingredient');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent('2 onions');
    expect(lines[1]).toHaveTextContent('400g tinned tomatoes');
    // The job's sentence is untouched — the amount is added, never spliced in.
    expect(screen.getAllByTestId('guided-prep-row')[0]).toHaveTextContent(
      'Dice the onions into 5mm pieces',
    );
  });

  it('shows nothing extra for a job that names no ingredients', () => {
    mockGuidedPlan._set(
      makePlan({
        prep: [{ id: 'prep-1', text: 'Get a big pan out', container: null, ingredientIds: [] }],
      }),
    );
    renderGuidedCook();

    expect(screen.queryByTestId('guided-prep-ingredient')).toBeNull();
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

    const lines = screen.getAllByTestId('guided-prep-ingredient');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent('2 onions');
  });
});

describe('GuidedCookPage — a step says what is in the bowl, and what is not', () => {
  /** step-1 reaches for the bowl prep-1 filled; step-2 for nothing. */
  function matchedPlan(): GuidedPlanDoc {
    return makePlan({
      stepNotes: [
        // Typed with different case and spacing from the prep job's "small bowl",
        // which is exactly how a hand-edited plan drifts.
        { stepId: 'step-1', container: 'Small  Bowl', setup: null, cue: null, checkIns: [] },
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
