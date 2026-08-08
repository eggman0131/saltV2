import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import type { CookSessionDoc, GuidedPlanDoc, IngredientDoc, RecipeDoc } from '@salt/domain/schemas';

// Guided cook (issue #751, Phase 2). The same jsdom line CookModePage.test.ts
// draws applies verbatim: everything the cook can DO is exercised here, and
// everything that depends on the browser having laid something out is not. jsdom
// measures every box as 0, so `visibleStepId` never resolves from a probe and the
// deck's stops are always `[0]` — the tests are written to work WITH that.
//
// What this file is FOR, over and above the cook-mode suite: the two things that
// differ. The prep list in place of the ingredient checklist (its own tick field,
// its own progress, and the "Also get out" remainder that keeps plan drift from
// hiding an ingredient), and the plan's notes under each step's unmodified words.
// Everything shared with plain cook mode — the pager, the timers, the wake lock,
// the bootstrap — is covered there and is the same code path.

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
        // Stored and editable in the Phase 1 editor; Phase 2 must not render or
        // arm them. Present on the fixture precisely so a regression would show.
        checkIns: [{ atMinutes: 5, text: 'Give it a stir' }],
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

async function enterSteps() {
  await userEvent.click(screen.getByTestId('cook-stage-toggle'));
  await screen.findByTestId('cook-steps-view');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.user = { uid: UID };
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
    renderGuidedCook();
    await enterSteps();
    // The fixture annotates step-1 only.
    expect(screen.getAllByTestId('guided-step-notes')).toHaveLength(1);
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

    expect(screen.queryByTestId('guided-step-notes')).toBeNull();
    expect(screen.queryByText('A bowl that is not there')).toBeNull();
  });

  it('does NOT render check-ins — Phase 3 owns arming them', async () => {
    renderGuidedCook();
    await enterSteps();
    // The fixture's step-1 note carries one.
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
    await waitFor(() => expect(lastPersisted().activeTimers).toHaveLength(1));
    expect(lastPersisted().activeTimers[0]).toMatchObject({ id: 'step-2', stepId: 'step-2' });
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
