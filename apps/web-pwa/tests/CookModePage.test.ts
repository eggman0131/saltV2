import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import type { CookSessionDoc, IngredientDoc, RecipeDoc } from '@salt/domain/schemas';

// Cook mode is the only full-viewport page in the app and the only one that owns its
// own gesture layer, so these tests deliberately draw a line: everything the cook can
// DO is exercised here (ticking, advancing, timers, restart, finish), and everything
// that depends on the browser having laid something out is not. jsdom measures every
// box as 0, which means `visibleStepId` never resolves from a probe and `stops` is
// always `[0]` — so the tests are written to work WITH that, never around it. Chip
// clipping, peek height and fade height belong to the Playwright pass.

const { mockAuth, mockRecipes, mockIsLoadingRecipes, mockCookSession, mockIsLoadingCookSession } =
  vi.hoisted(() => {
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
      mockIsLoadingCookSession: makeStore<boolean>(false),
    };
  });

const { mockCanonItems, mockWakeLock } = vi.hoisted(() => ({
  mockCanonItems: {
    subscribe(fn: (v: never[]) => void) {
      fn([]);
      return () => {};
    },
  },
  mockWakeLock: { enable: vi.fn(async () => true), disable: vi.fn(async () => {}) },
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
// `persistCookSession` echoes into the session store exactly as the real service does
// (it sets the store optimistically before the write lands), because several flows here
// depend on the round-trip: a step only collapses once its completion is back in the
// store, and the bootstrap effect only stops re-firing once the store is non-null. The
// echo is deferred by a microtask so it never lands inside the synchronous body of the
// effect that triggered it.
vi.mock('../src/lib/cookSessionService.js', () => ({
  cookSession: mockCookSession,
  isLoadingCookSession: mockIsLoadingCookSession,
  initCookSessionSync: vi.fn(() => () => {}),
  getCookSessionSnapshot: vi.fn(() => mockCookSession._get()),
  persistCookSession: vi.fn(async (session: CookSessionDoc) => {
    await Promise.resolve();
    mockCookSession._set(session);
    return { kind: 'ok' as const, value: undefined };
  }),
  removeCookSession: vi.fn(async () => ({ kind: 'ok' as const, value: undefined })),
}));

import CookModePage from '../src/routes/recipes/CookModePage.svelte';
import { push } from 'svelte-spa-router';
import { addToast } from '../src/lib/toastStore.js';
import {
  initCookSessionSync,
  persistCookSession,
  removeCookSession,
} from '../src/lib/cookSessionService.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────────
const RECIPE_ID = 'recipe-1';
const UID = 'user-1';
const SESSION_ID = `${RECIPE_ID}_${UID}`;
const RECIPE_UPDATED_AT = '2026-07-01T10:00:00.000Z';
const RECIPE_EDITED_AT = '2026-07-02T18:30:00.000Z';

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
        name: 'For the sauce',
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
    createdAt: '2026-06-01T09:00:00.000Z',
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
    completedStepIds: [],
    activeTimers: [],
    createdAt: '2026-07-01T11:00:00.000Z',
    updatedAt: '2026-07-01T11:00:00.000Z',
    ...over,
  };
}

// ─── Harness ───────────────────────────────────────────────────────────────────
function renderCookMode() {
  return render(CookModePage, { props: { params: { id: RECIPE_ID } } });
}

/** The session as it was handed to the most recent write. */
function lastPersisted(): CookSessionDoc {
  const calls = vi.mocked(persistCookSession).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0];
}

/** Open an existing session straight into the guided-steps stage. */
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
  mockIsLoadingCookSession._set(false);
});

afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
  document.body.innerHTML = '';
});

describe('CookModePage — starting a cook', () => {
  it('subscribes to the one session that belongs to this cook and this recipe', () => {
    renderCookMode();
    expect(vi.mocked(initCookSessionSync)).toHaveBeenCalledWith(SESSION_ID);
  });

  it('opens a fresh session stamped with the recipe as it stands right now', async () => {
    mockCookSession._set(null);
    renderCookMode();

    await waitFor(() => expect(vi.mocked(persistCookSession)).toHaveBeenCalled());
    expect(lastPersisted()).toMatchObject({
      id: SESSION_ID,
      ownerUid: UID,
      recipeId: RECIPE_ID,
      recipeUpdatedAtAtStart: RECIPE_UPDATED_AT,
      checkedIngredientIds: [],
      completedStepIds: [],
      activeTimers: [],
    });
  });

  it('resumes the session already open rather than starting a second one', async () => {
    renderCookMode();
    await screen.findByTestId('cook-mode-page');
    expect(vi.mocked(persistCookSession)).not.toHaveBeenCalled();
  });

  it('says so when the session could not be started', async () => {
    mockCookSession._set(null);
    vi.mocked(persistCookSession).mockImplementationOnce(async (session) => {
      await Promise.resolve();
      mockCookSession._set(session);
      return { kind: 'err' as const, error: { kind: 'NetworkError', reason: 'transient' } };
    });

    renderCookMode();

    await waitFor(() =>
      expect(vi.mocked(addToast)).toHaveBeenCalledWith('Failed to start cooking.', 'destructive'),
    );
  });

  it('opens on mise en place, and moves to the guided steps on demand', async () => {
    renderCookMode();

    expect(screen.getAllByTestId('cook-mise-row')).toHaveLength(2);
    expect(screen.getByTestId('cook-mode-title')).toHaveTextContent('Weeknight ragù');
    expect(screen.getByTestId('cook-stage-toggle')).toHaveTextContent('Start cooking');

    await enterSteps();
    expect(screen.getByTestId('cook-timeline')).toBeInTheDocument();
    expect(screen.queryByTestId('cook-mise-row')).not.toBeInTheDocument();
  });

  it('drops a half-cooked recipe straight back into the steps', async () => {
    mockCookSession._set(makeCookSession({ completedStepIds: ['step-1'] }));
    renderCookMode();

    await screen.findByTestId('cook-steps-view');
    expect(screen.queryByTestId('cook-mise-row')).not.toBeInTheDocument();
  });

  it('offers to continue rather than to start once a step is already ticked', async () => {
    mockCookSession._set(makeCookSession({ completedStepIds: ['step-1'] }));
    renderCookMode();

    await userEvent.click(await screen.findByTestId('cook-stage-back'));
    expect(await screen.findByTestId('cook-stage-toggle')).toHaveTextContent('Continue cooking');
  });

  it('leaves the session behind when cook mode is merely closed', async () => {
    renderCookMode();
    await userEvent.click(screen.getByTestId('cook-mode-close'));

    expect(vi.mocked(push)).toHaveBeenCalledWith(`/recipes/${RECIPE_ID}`);
    expect(vi.mocked(removeCookSession)).not.toHaveBeenCalled();
  });
});

describe('CookModePage — mise en place', () => {
  it('records exactly the ingredient that was ticked', async () => {
    renderCookMode();
    await userEvent.click(screen.getAllByTestId('cook-mise-row')[0]!);

    await waitFor(() => expect(lastPersisted().checkedIngredientIds).toEqual(['ing-1']));
  });

  it('clears an ingredient that is ticked a second time', async () => {
    mockCookSession._set(makeCookSession({ checkedIngredientIds: ['ing-1'] }));
    renderCookMode();

    await userEvent.click(screen.getAllByTestId('cook-mise-row')[0]!);
    await waitFor(() => expect(lastPersisted().checkedIngredientIds).toEqual([]));
  });

  it('ticks every ingredient in the recipe in one go', async () => {
    renderCookMode();
    await userEvent.click(screen.getByTestId('cook-mise-check-all'));

    await waitFor(() => expect(lastPersisted().checkedIngredientIds).toEqual(['ing-1', 'ing-2']));
    expect(await screen.findByTestId('cook-mise-check-all')).toHaveTextContent('Uncheck all');
  });

  it('clears the lot when everything is already ticked', async () => {
    mockCookSession._set(makeCookSession({ checkedIngredientIds: ['ing-1', 'ing-2'] }));
    renderCookMode();

    expect(screen.getByTestId('cook-mise-check-all')).toHaveTextContent('Uncheck all');
    await userEvent.click(screen.getByTestId('cook-mise-check-all'));
    await waitFor(() => expect(lastPersisted().checkedIngredientIds).toEqual([]));
  });

  it('counts progress over the recipe, so a tick left by a deleted ingredient cannot inflate it', () => {
    mockCookSession._set(makeCookSession({ checkedIngredientIds: ['ing-1', 'ing-gone'] }));
    renderCookMode();

    expect(screen.getByText(/1\/2 ready/)).toBeInTheDocument();
  });
});

describe('CookModePage — working through the steps', () => {
  it('ticks the step being cooked and moves the footer on to the next one outstanding', async () => {
    renderCookMode();
    await enterSteps();

    expect(screen.getByTestId('cook-step-done')).toHaveTextContent('Done · next');
    await userEvent.click(screen.getByTestId('cook-step-done'));

    await waitFor(() => expect(lastPersisted().completedStepIds).toEqual(['step-1']));
    // Step 2 is the last one, so there is nothing left to advance to.
    expect(await screen.findByTestId('cook-step-done')).toHaveTextContent(/^Done$/);
  });

  it('collapses a ticked step to a row that can be re-read without unticking it', async () => {
    renderCookMode();
    await enterSteps();
    await userEvent.click(screen.getByTestId('cook-step-done'));

    const collapsed = await screen.findByTestId('cook-step-collapsed');
    vi.mocked(persistCookSession).mockClear();
    await userEvent.click(collapsed);

    expect(await screen.findByTestId('cook-step-done-badge')).toBeInTheDocument();
    expect(screen.getByTestId('cook-step-untick')).toBeInTheDocument();
    expect(vi.mocked(persistCookSession)).not.toHaveBeenCalled();
  });

  it('unticks a step only from the expanded view it was deliberately re-opened into', async () => {
    mockCookSession._set(makeCookSession({ completedStepIds: ['step-1'] }));
    renderCookMode();

    await userEvent.click(await screen.findByTestId('cook-step-collapsed'));
    await userEvent.click(await screen.findByTestId('cook-step-untick'));

    await waitFor(() => expect(lastPersisted().completedStepIds).toEqual([]));
  });

  it('offers to resume the earliest outstanding step when the cook is re-reading a done one', async () => {
    mockCookSession._set(makeCookSession({ completedStepIds: ['step-1'] }));
    renderCookMode();

    await userEvent.click(await screen.findByTestId('cook-step-collapsed'));
    expect(await screen.findByTestId('cook-step-resume')).toHaveTextContent('Resume · step 2');
  });

  it('marks the timeline as steps are ticked and makes a tapped segment the current one', async () => {
    mockCookSession._set(makeCookSession({ completedStepIds: ['step-1'] }));
    renderCookMode();

    const segments = await screen.findAllByTestId('cook-timeline-step');
    expect(segments[0]).toHaveAttribute('data-complete', 'true');
    expect(segments[1]).toHaveAttribute('data-current', 'true');

    await userEvent.click(segments[0]!);
    await waitFor(() =>
      expect(screen.getAllByTestId('cook-timeline-step')[0]).toHaveAttribute(
        'data-current',
        'true',
      ),
    );
  });

  it('turns the footer into finish cooking only once every step is ticked', async () => {
    renderCookMode();
    await enterSteps();

    await userEvent.click(screen.getByTestId('cook-step-done'));
    expect(screen.queryByTestId('cook-mode-complete')).not.toBeInTheDocument();

    await userEvent.click(await screen.findByTestId('cook-step-done'));
    expect(await screen.findByTestId('cook-mode-complete')).toHaveTextContent('Finish cooking');
  });

  it('finishing clears the session and returns to the recipe', async () => {
    mockCookSession._set(makeCookSession({ completedStepIds: ['step-1', 'step-2'] }));
    renderCookMode();

    await userEvent.click(await screen.findByTestId('cook-mode-complete'));

    await waitFor(() => expect(vi.mocked(removeCookSession)).toHaveBeenCalledWith(SESSION_ID));
    expect(vi.mocked(push)).toHaveBeenCalledWith(`/recipes/${RECIPE_ID}`);
  });

  it('shows each step the ingredients it is the first to call for', async () => {
    renderCookMode();
    await enterSteps();

    const chipLists = screen.getAllByTestId('cook-step-firstuse');
    expect(chipLists).toHaveLength(2);
    expect(chipLists[0]).toHaveTextContent('2 onions');
    expect(chipLists[1]).toHaveTextContent('400g tinned tomatoes');
  });
});

describe('CookModePage — step timers', () => {
  it('starts a countdown as an absolute end time, so a reload can rebuild it', async () => {
    renderCookMode();
    await enterSteps();

    const before = Date.now();
    await userEvent.click(screen.getByTestId('cook-step-timer-start'));

    await waitFor(() => expect(lastPersisted().activeTimers).toHaveLength(1));
    const timer = lastPersisted().activeTimers[0]!;
    expect(timer.stepId).toBe('step-2');
    const runsFor = new Date(timer.endsAt).getTime() - before;
    expect(runsFor).toBeGreaterThanOrEqual(20 * 60_000 - 1_000);
    expect(runsFor).toBeLessThanOrEqual(20 * 60_000 + 10_000);
  });

  it('defaults a timer long enough to walk away from to notifying', async () => {
    renderCookMode();
    await enterSteps();
    await userEvent.click(screen.getByTestId('cook-step-timer-start'));

    await waitFor(() => expect(lastPersisted().activeTimers[0]?.notify).toBe(true));
  });

  it('leaves a timer short enough to stand over as silent', async () => {
    mockRecipes._set([
      makeRecipe({
        steps: [
          { id: 'step-1', text: 'Soften the onions.', timer: null, note: null },
          {
            id: 'step-2',
            text: 'Rest the sauce.',
            timer: { durationMinutes: 3, description: null },
            note: null,
          },
        ],
      }),
    ]);
    renderCookMode();
    await enterSteps();
    await userEvent.click(screen.getByTestId('cook-step-timer-start'));

    await waitFor(() => expect(lastPersisted().activeTimers[0]?.notify).toBe(false));
  });

  it('keeps a running timer on screen whichever stage the cook is looking at', async () => {
    mockCookSession._set(
      makeCookSession({
        activeTimers: [
          { stepId: 'step-2', endsAt: new Date(Date.now() + 300_000).toISOString(), notify: true },
        ],
      }),
    );
    renderCookMode();

    // Stage 1 — the bar is above the stage, so it is there before cooking even starts.
    expect(screen.getByTestId('cook-timers-bar')).toBeInTheDocument();
    expect(screen.getByTestId('cook-timer-chip')).toHaveAttribute('data-step-id', 'step-2');
    expect(screen.getByTestId('cook-timer-chip-time')).toHaveTextContent(/^(4:5\d|5:00)$/);

    await enterSteps();
    expect(screen.getByTestId('cook-timers-bar')).toBeInTheDocument();
  });

  it('reads a timer whose end time has passed as finished, still dismissable', async () => {
    mockCookSession._set(
      makeCookSession({
        activeTimers: [
          { stepId: 'step-2', endsAt: new Date(Date.now() - 30_000).toISOString(), notify: true },
        ],
      }),
    );
    renderCookMode();

    expect(screen.getByTestId('cook-timer-chip')).toHaveAttribute('data-fired', 'true');
    expect(screen.getByTestId('cook-timer-chip-time')).toHaveTextContent('Finished');
    expect(screen.getByTestId('cook-timer-chip-dismiss')).toHaveTextContent('Dismiss');
  });

  it('cancelling from the persistent bar takes the timer off the session', async () => {
    mockCookSession._set(
      makeCookSession({
        activeTimers: [
          { stepId: 'step-2', endsAt: new Date(Date.now() + 300_000).toISOString(), notify: true },
        ],
      }),
    );
    renderCookMode();

    await userEvent.click(screen.getByTestId('cook-timer-chip-dismiss'));
    await waitFor(() => expect(lastPersisted().activeTimers).toEqual([]));
    expect(screen.queryByTestId('cook-timers-bar')).not.toBeInTheDocument();
  });

  it('cancelling from the step itself takes the timer off the session too', async () => {
    mockCookSession._set(
      makeCookSession({
        activeTimers: [
          { stepId: 'step-2', endsAt: new Date(Date.now() + 300_000).toISOString(), notify: true },
        ],
      }),
    );
    renderCookMode();
    await enterSteps();

    await userEvent.click(screen.getByTestId('cook-step-timer-dismiss'));
    await waitFor(() => expect(lastPersisted().activeTimers).toEqual([]));
    expect(await screen.findByTestId('cook-step-timer-start')).toBeInTheDocument();
  });
});

describe('CookModePage — the recipe changing under an in-progress cook', () => {
  it('says nothing while the recipe is the one the cook started from', () => {
    renderCookMode();
    expect(screen.queryByTestId('cook-mode-recipe-changed')).not.toBeInTheDocument();
  });

  it('warns the cook when the recipe is edited mid-cook', async () => {
    renderCookMode();
    mockRecipes._set([makeRecipe({ updatedAt: RECIPE_EDITED_AT })]);

    expect(await screen.findByTestId('cook-mode-recipe-changed')).toHaveTextContent(
      /updated since you started cooking/i,
    );
  });

  it('restarting discards the session and re-baselines against the edited recipe', async () => {
    mockCookSession._set(makeCookSession({ checkedIngredientIds: ['ing-1'] }));
    renderCookMode();
    mockRecipes._set([makeRecipe({ updatedAt: RECIPE_EDITED_AT })]);

    await userEvent.click(await screen.findByTestId('cook-mode-restart'));

    await waitFor(() => expect(vi.mocked(removeCookSession)).toHaveBeenCalledWith(SESSION_ID));
    expect(lastPersisted()).toMatchObject({
      id: SESSION_ID,
      recipeUpdatedAtAtStart: RECIPE_EDITED_AT,
      checkedIngredientIds: [],
      completedStepIds: [],
      activeTimers: [],
    });
    expect(vi.mocked(addToast)).toHaveBeenCalledWith(
      'Started fresh with the updated recipe.',
      'success',
    );
    // The new baseline matches the live recipe, so the warning has nothing left to say.
    await waitFor(() =>
      expect(screen.queryByTestId('cook-mode-recipe-changed')).not.toBeInTheDocument(),
    );
  });

  it('says so when the restart could not be written', async () => {
    renderCookMode();
    mockRecipes._set([makeRecipe({ updatedAt: RECIPE_EDITED_AT })]);
    vi.mocked(persistCookSession).mockImplementationOnce(async () => ({
      kind: 'err' as const,
      error: { kind: 'NetworkError', reason: 'transient' },
    }));

    await userEvent.click(await screen.findByTestId('cook-mode-restart'));

    await waitFor(() =>
      expect(vi.mocked(addToast)).toHaveBeenCalledWith('Failed to restart.', 'destructive'),
    );
    expect(vi.mocked(addToast)).not.toHaveBeenCalledWith(
      'Started fresh with the updated recipe.',
      'success',
    );
  });
});

describe('CookModePage — a recipe deleted mid-cook', () => {
  it('waits for the recipes to load before calling a missing recipe deleted', async () => {
    mockRecipes._set([]);
    mockIsLoadingRecipes._set(true);
    renderCookMode();

    // Settle first: the orphan cleanup is fire-and-forget, so asserting it never ran
    // has to outlive the tick it would have run on.
    await waitFor(() => expect(screen.getByText('Loading…')).toBeInTheDocument());
    expect(screen.queryByTestId('cook-mode-orphan')).not.toBeInTheDocument();
    expect(vi.mocked(removeCookSession)).not.toHaveBeenCalled();
  });

  it('explains the deletion and clears the session it stranded', async () => {
    mockRecipes._set([]);
    renderCookMode();

    expect(screen.getByTestId('cook-mode-orphan')).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(removeCookSession)).toHaveBeenCalledWith(SESSION_ID));
  });

  it('sends the cook back to the recipe list', async () => {
    mockRecipes._set([]);
    renderCookMode();

    await userEvent.click(screen.getByTestId('cook-mode-orphan-back'));
    expect(vi.mocked(push)).toHaveBeenCalledWith('/recipes');
  });
});

describe('CookModePage — keeping the screen awake', () => {
  it('confirms the lock only once the browser has actually granted it', async () => {
    renderCookMode();
    await userEvent.click(screen.getByTestId('cook-mode-wakelock'));

    await waitFor(() =>
      expect(vi.mocked(addToast)).toHaveBeenCalledWith('Screen will stay awake', 'success'),
    );
    expect(screen.getByTestId('cook-mode-wakelock')).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not claim a lock the browser refused', async () => {
    mockWakeLock.enable.mockResolvedValueOnce(false);
    renderCookMode();
    await userEvent.click(screen.getByTestId('cook-mode-wakelock'));

    await waitFor(() =>
      expect(vi.mocked(addToast)).toHaveBeenCalledWith(
        "Your browser wouldn't let the screen stay awake.",
        'destructive',
      ),
    );
    expect(screen.getByTestId('cook-mode-wakelock')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('CookModePage — accessibility', () => {
  it('mise en place has no axe violations', async () => {
    const { container } = renderCookMode();
    await screen.findByTestId('cook-mise-check-all');

    expect(await axe(container)).toHaveNoViolations();
  });

  it('the guided steps have no axe violations', async () => {
    mockCookSession._set(
      makeCookSession({
        completedStepIds: ['step-1'],
        activeTimers: [
          { stepId: 'step-2', endsAt: new Date(Date.now() + 300_000).toISOString(), notify: true },
        ],
      }),
    );
    const { container } = renderCookMode();
    await screen.findByTestId('cook-steps-view');

    expect(await axe(container)).toHaveNoViolations();
  });
});
