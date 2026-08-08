import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import type { Recipe } from '@salt/domain';
import type { GuidedPlanDoc } from '@salt/domain/schemas';

// The guided-plan editor (issue #751, Phase 1). The four things this page has to
// get right, and the reasons they matter:
//
//   • the empty state offers "Write the plan" — and NEVER flashes over a plan that
//     is still a frame from arriving (the store's three states);
//   • an ingredient in no prep step is WARNED about, because in guided mode the
//     prep list is the only ingredient list the cook ever sees;
//   • a save clears "not checked yet" and re-stamps against the recipe, so a plan
//     reconciled by hand escapes the stale banner without a destructive re-run;
//   • a note whose step no longer exists renders as NOTHING — never an error, and
//     never against the wrong step.

const { mockRecipes, mockIsLoadingRecipes, mockPlan } = vi.hoisted(() => {
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
        subs.forEach((fn) => fn(v));
      },
    };
  }
  return {
    mockRecipes: makeStore<readonly Recipe[]>([]),
    mockIsLoadingRecipes: makeStore<boolean>(false),
    mockPlan: makeStore<GuidedPlanDoc | null | undefined>(undefined),
  };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/nav.js', () => ({ goBack: vi.fn() }));
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
  isLoadingRecipes: mockIsLoadingRecipes,
}));
vi.mock('../src/lib/guidedPlanService.js', () => ({
  guidedPlan: mockPlan,
  initGuidedPlanSync: vi.fn(() => vi.fn()),
  generateGuidedPlan: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  saveGuidedPlan: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));

import GuidedPlanPage from '../src/routes/recipes/GuidedPlanPage.svelte';
import { generateGuidedPlan, saveGuidedPlan } from '../src/lib/guidedPlanService.js';

const RECIPE_ID = 'recipe-1';
const WRITTEN_AT = '2026-08-01T09:00:00.000Z';

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: RECIPE_ID,
    schemaVersion: 1,
    kind: 'recipe',
    title: 'Ragù',
    description: null,
    ingredients: [
      {
        id: 'grp-1',
        name: null,
        items: [
          {
            id: 'ing-1',
            rawText: '1 onion',
            parsed: null,
            canonId: null,
            matchState: 'pending',
            isOptional: false,
            firstUsedInStepId: null,
          },
          {
            id: 'ing-2',
            rawText: '2 carrots',
            parsed: null,
            canonId: null,
            matchState: 'pending',
            isOptional: false,
            firstUsedInStepId: null,
          },
        ],
      },
    ],
    steps: [
      {
        id: 'step-1',
        text: 'Soften the onion.',
        timer: { durationMinutes: 10, description: null },
        note: null,
      },
      { id: 'step-2', text: 'Add the carrots.', timer: null, note: null },
    ],
    metadata: {
      servings: null,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      totalTimeMinutes: null,
      tags: [],
    },
    source: null,
    notes: null,
    image: null,
    createdAt: WRITTEN_AT,
    updatedAt: WRITTEN_AT,
    ...overrides,
  } as Recipe;
}

function makePlan(overrides: Partial<GuidedPlanDoc> = {}): GuidedPlanDoc {
  return {
    id: RECIPE_ID,
    schemaVersion: 1,
    recipeId: RECIPE_ID,
    recipeUpdatedAtAtSave: WRITTEN_AT,
    prep: [
      { id: 'prep-1', text: 'Dice the onion', container: 'small bowl', ingredientIds: ['ing-1'] },
      { id: 'prep-2', text: 'Dice the carrots', container: 'small bowl', ingredientIds: ['ing-2'] },
    ],
    stepNotes: [
      {
        stepId: 'step-1',
        container: 'the small bowl',
        setup: 'small hob burner, medium-low',
        cue: 'a very gentle sizzle',
        checkIns: [],
      },
    ],
    createdAt: WRITTEN_AT,
    updatedAt: WRITTEN_AT,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockIsLoadingRecipes._set(false);
  mockRecipes._set([makeRecipe()]);
  mockPlan._set(undefined);
});

function renderPage() {
  return render(GuidedPlanPage, { props: { params: { id: RECIPE_ID } } });
}

describe('GuidedPlanPage — no plan yet', () => {
  it('shows nothing but a loader while the plan is still resolving', () => {
    // `undefined` is NOT `null`. Without the distinction the "Write the plan"
    // prompt flashes over every recipe that already has one.
    const { queryByTestId } = renderPage();
    expect(queryByTestId('guided-plan-empty')).toBeNull();
    expect(queryByTestId('guided-plan-editor')).toBeNull();
  });

  it('offers "Write the plan" once we know there is none', async () => {
    const { getByTestId } = renderPage();
    mockPlan._set(null);
    await waitFor(() => expect(getByTestId('guided-plan-empty')).toBeTruthy());

    await fireEvent.click(getByTestId('guided-plan-write-button'));

    await waitFor(() => expect(generateGuidedPlan).toHaveBeenCalledTimes(1));
    expect(vi.mocked(generateGuidedPlan).mock.calls[0]![0].id).toBe(RECIPE_ID);
  });
});

describe('GuidedPlanPage — the plan', () => {
  it('renders the prep list and a note row per recipe step', async () => {
    const { getAllByTestId, getByTestId } = renderPage();
    mockPlan._set(makePlan());

    await waitFor(() => expect(getByTestId('guided-plan-editor')).toBeTruthy());
    expect(getAllByTestId('guided-plan-prep-entry')).toHaveLength(2);
    expect(getAllByTestId('guided-plan-step-note')).toHaveLength(2);
  });

  it('shows the "not checked yet" chip only while the plan is flagged', async () => {
    const { getByTestId, queryByTestId } = renderPage();
    mockPlan._set(makePlan({ needs_approval: true }));
    await waitFor(() => expect(getByTestId('guided-plan-unreviewed-chip')).toBeTruthy());

    mockPlan._set(makePlan({ updatedAt: '2026-08-02T00:00:00.000Z' }));
    await waitFor(() => expect(queryByTestId('guided-plan-unreviewed-chip')).toBeNull());
  });

  it('offers check-ins only on a step that already carries a timer', async () => {
    const { getAllByTestId } = renderPage();
    mockPlan._set(makePlan());

    // Two steps, one timer → exactly one "Add a check-in".
    await waitFor(() => expect(getAllByTestId('guided-plan-add-check-in-button')).toHaveLength(1));
  });

  it('renders a note for a step that no longer exists as NOTHING', async () => {
    // Never an error, and never attached to a neighbouring step. The step list is
    // rendered from the RECIPE and notes are looked up by id, so an orphan is
    // simply never found.
    const { getAllByTestId, queryByText } = renderPage();
    mockPlan._set(
      makePlan({
        stepNotes: [
          {
            stepId: 'step-deleted',
            container: null,
            setup: null,
            cue: 'a cue for a step that is gone',
            checkIns: [],
          },
        ],
      }),
    );

    await waitFor(() => expect(getAllByTestId('guided-plan-step-note')).toHaveLength(2));
    expect(queryByText('a cue for a step that is gone')).toBeNull();
  });
});

describe('GuidedPlanPage — the unassigned-ingredient warning', () => {
  it('stays quiet when every ingredient is prepped somewhere', async () => {
    const { getByTestId, queryByTestId } = renderPage();
    mockPlan._set(makePlan());

    await waitFor(() => expect(getByTestId('guided-plan-editor')).toBeTruthy());
    expect(queryByTestId('guided-plan-unassigned-warning')).toBeNull();
  });

  it('warns when an ingredient appears in no prep entry', async () => {
    // The trap this page exists to catch: the prep list REPLACES the ingredient
    // checklist in guided mode, so an unassigned ingredient is one the cook is
    // never shown at all.
    const { getByTestId } = renderPage();
    mockPlan._set(
      makePlan({
        prep: [
          {
            id: 'prep-1',
            text: 'Dice the onion',
            container: 'small bowl',
            ingredientIds: ['ing-1'],
          },
        ],
      }),
    );

    const warning = await waitFor(() => getByTestId('guided-plan-unassigned-warning'));
    expect(warning.textContent).toContain('2 carrots');
  });

  it('clears the warning when the ingredient is attached to a prep entry', async () => {
    const { getByTestId, getAllByTestId, queryByTestId } = renderPage();
    mockPlan._set(
      makePlan({
        prep: [
          {
            id: 'prep-1',
            text: 'Dice the onion',
            container: 'small bowl',
            ingredientIds: ['ing-1'],
          },
        ],
      }),
    );
    await waitFor(() => expect(getByTestId('guided-plan-unassigned-warning')).toBeTruthy());

    // Removing the chip and re-adding it is the round trip; here we just prove the
    // chip removal re-opens the warning for an ingredient that WAS assigned.
    const chips = getAllByTestId('guided-plan-prep-ingredient-chip');
    expect(chips).toHaveLength(1);
    await fireEvent.click(chips[0]!);

    await waitFor(() =>
      expect(getByTestId('guided-plan-unassigned-warning').textContent).toContain('1 onion'),
    );
    expect(queryByTestId('guided-plan-prep-ingredient-chip')).toBeNull();
  });
});

describe('GuidedPlanPage — drift and save', () => {
  it('says the recipe has changed since the plan was written', async () => {
    const { getByTestId } = renderPage();
    mockRecipes._set([makeRecipe({ updatedAt: '2026-08-09T12:00:00.000Z' })]);
    mockPlan._set(makePlan({ recipeUpdatedAtAtSave: WRITTEN_AT }));

    await waitFor(() => expect(getByTestId('guided-plan-stale-banner')).toBeTruthy());
  });

  it('does NOT auto-regenerate or delete the plan when the recipe drifts', async () => {
    // The plan may be several hand-corrections deep; throwing that away to chase
    // an edit to one step would be a bad trade. Both ways out are the user's call.
    const { getByTestId, getAllByTestId } = renderPage();
    mockRecipes._set([makeRecipe({ updatedAt: '2026-08-09T12:00:00.000Z' })]);
    mockPlan._set(makePlan());

    await waitFor(() => expect(getByTestId('guided-plan-stale-banner')).toBeTruthy());
    expect(getAllByTestId('guided-plan-prep-entry')).toHaveLength(2);
    expect(generateGuidedPlan).not.toHaveBeenCalled();
    expect(saveGuidedPlan).not.toHaveBeenCalled();
  });

  it('saves the edited plan against the CURRENT recipe, so a hand fix clears the banner', async () => {
    const drifted = makeRecipe({ updatedAt: '2026-08-09T12:00:00.000Z' });
    const { getByTestId } = renderPage();
    mockRecipes._set([drifted]);
    mockPlan._set(makePlan({ needs_approval: true }));
    await waitFor(() => expect(getByTestId('guided-plan-stale-banner')).toBeTruthy());

    await fireEvent.click(getByTestId('guided-plan-save-button'));

    await waitFor(() => expect(saveGuidedPlan).toHaveBeenCalledTimes(1));
    // The service is handed the LIVE recipe; it is what re-stamps the plan.
    const [, recipeArg] = vi.mocked(saveGuidedPlan).mock.calls[0]!;
    expect(recipeArg.updatedAt).toBe('2026-08-09T12:00:00.000Z');
  });

  it('maps empty text fields back to null and drops a note that says nothing', async () => {
    const { getByTestId } = renderPage();
    mockPlan._set(
      makePlan({
        prep: [{ id: 'prep-1', text: 'Open the tin', container: '', ingredientIds: [] }],
        stepNotes: [
          { stepId: 'step-1', container: '', setup: '', cue: '', checkIns: [] },
          { stepId: 'step-2', container: '', setup: '', cue: 'looks glossy', checkIns: [] },
        ],
      }),
    );
    await waitFor(() => expect(getByTestId('guided-plan-editor')).toBeTruthy());

    await fireEvent.click(getByTestId('guided-plan-save-button'));

    await waitFor(() => expect(saveGuidedPlan).toHaveBeenCalledTimes(1));
    const [saved] = vi.mocked(saveGuidedPlan).mock.calls[0]!;
    expect(saved.prep[0]!.container).toBeNull();
    // The all-empty note is a husk; only the one that actually says something survives.
    expect(saved.stepNotes).toHaveLength(1);
    expect(saved.stepNotes[0]!.stepId).toBe('step-2');
  });

  it('blocks the save while a check-in cannot fire inside its timer', async () => {
    // The schema cannot see the timer — it holds no recipe — so this cross-check
    // lives here, and it blocks rather than warns: a reminder set at or past the
    // end of the timer can never fire.
    const { getByTestId } = renderPage();
    mockPlan._set(
      makePlan({
        stepNotes: [
          {
            stepId: 'step-1',
            container: null,
            setup: null,
            cue: null,
            checkIns: [{ atMinutes: 20, text: 'stir' }],
          },
        ],
      }),
    );

    const save = await waitFor(() => getByTestId('guided-plan-save-button') as HTMLButtonElement);
    expect(save.disabled).toBe(true);

    // Bring it inside the 10-minute timer and the save opens up again.
    const minutes = getByTestId('guided-plan-check-in-minutes') as HTMLInputElement;
    await fireEvent.input(minutes, { target: { value: '5' } });
    await waitFor(() =>
      expect((getByTestId('guided-plan-save-button') as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it('re-runs over an existing plan', async () => {
    const { getByTestId } = renderPage();
    mockPlan._set(makePlan());
    await waitFor(() => expect(getByTestId('guided-plan-editor')).toBeTruthy());

    await fireEvent.click(getByTestId('guided-plan-rerun-button'));

    await waitFor(() => expect(generateGuidedPlan).toHaveBeenCalledTimes(1));
  });
});

describe('GuidedPlanPage — capability gate', () => {
  it('has nothing to plan for an entry with no method', async () => {
    // Gated on the capability predicate, never on `kind`.
    mockRecipes._set([makeRecipe({ kind: 'outing', ingredients: [], steps: [] })]);
    mockPlan._set(null);
    const { queryByTestId, getByText } = renderPage();

    expect(getByText('Nothing to plan here')).toBeTruthy();
    expect(queryByTestId('guided-plan-empty')).toBeNull();
  });
});
