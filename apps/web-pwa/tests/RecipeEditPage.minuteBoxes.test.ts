import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { emptyIngredientGroup, emptyRecipe, newIngredient, newStep } from '@salt/domain';
import type { Recipe, RecipePhase, Step } from '@salt/domain';

// The editor's REQUIRED-number minute boxes (issue #1221): the two per phase, and
// a step timer's duration. Servings is deliberately not here — it is backed by
// `number | null`, so an empty box round-trips through the model as `null` and it
// never had this defect. `RecipeEditPage.servings.test.ts` owns that field.
//
// What these three share is that the model has NO WAY TO SAY "EMPTY". The stored
// value is a plain number, so echoing it straight back through the controlled
// `TextField` repainted `0` under the caret the instant the box was cleared, and
// the next keystroke read `045`.
//
// ASSERTING THE SAVED VALUE CANNOT SEE THIS, which is why two green suites ran
// straight past it: `045` parses to 45 and the save was always correct. Every
// assertion below is on what the box DISPLAYS.
//
// The boundary these pins claim, stated so it can be checked: while a box has
// focus its text is the cook's, uninterpreted — a cleared box stays cleared and
// nonsense stays visible. On blur it snaps to the stored number. Nothing here
// claims the box filters keystrokes; `inputmode="numeric"` is a soft-keyboard
// hint, and a letter typed on a hardware keyboard is still accepted and still
// stores 0.
//
// WHICH OF THESE WERE ACTUALLY RED BEFORE THE FIX, since a suite that says
// otherwise is the defect class this repo keeps shipping: the three "stays empty"
// cases, and the two re-seed cases at the bottom (verified red by deleting the
// `$effect` in `MinutesField.svelte`). The two "takes a retype" cases passed
// BEFORE the fix as well — a stray leading `0` is re-parsed away by the end of
// the interaction, so they pin the end state and nothing about the caret. They
// are kept as regression cover, not offered as evidence of the bug.

const { mockRecipes, mockCanonItems } = await vi.hoisted(async () => {
  const { makeStore } = await import('./support/testStore.js');
  return {
    mockRecipes: makeStore<readonly Recipe[]>([]),
    mockCanonItems: makeStore<readonly { id: string }[]>([]),
  };
});

vi.mock('svelte-spa-router', () => ({
  push: vi.fn(),
  router: { querystring: undefined },
}));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
  persistRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  parseIngredients: vi.fn(),
  matchIngredient: vi.fn(),
  takeImportedDraft: vi.fn().mockReturnValue(null),
}));
vi.mock('../src/lib/canonService.js', () => ({ canonItems: mockCanonItems }));
vi.mock('../src/lib/featureGate.js', () => ({
  breadGate: {
    subscribe: (fn: (v: unknown) => void) => (fn({ enabled: true, settled: true }), () => {}),
  },
  featureGate: () => ({
    subscribe: (fn: (v: unknown) => void) => (fn({ enabled: true, settled: true }), () => {}),
  }),
  isFeatureEnabled: () => true,
}));

import RecipeEditPage from '../src/routes/recipes/RecipeEditPage.svelte';
import { persistRecipe } from '../src/lib/recipeService.js';

const ISO = '2026-01-01T00:00:00.000Z';
const MIX: RecipePhase = { label: 'Mix & knead', handsOnMinutes: 20, handsOffMinutes: 5 };
const PROVE: RecipePhase = { label: 'First rise', handsOnMinutes: 0, handsOffMinutes: 90 };

function timedStep(): Step {
  return {
    ...newStep('step-1', 'Prove until doubled'),
    timer: { durationMinutes: 90, description: null },
  };
}

function renderEditor(overrides: Partial<Recipe> = {}, phases: RecipePhase[] = [MIX]): void {
  const base = emptyRecipe('entry-1', ISO);
  mockRecipes._set([
    {
      ...base,
      title: 'Sourdough',
      ingredients: [
        { ...emptyIngredientGroup('group-1'), items: [newIngredient('ing-1', '500g flour')] },
      ],
      metadata: { ...base.metadata, servings: 4, phases },
      ...overrides,
    } as Recipe,
  ]);
  render(RecipeEditPage, { props: { params: { id: 'entry-1' } } });
}

function box(testId: string): HTMLInputElement {
  return screen.getAllByTestId(testId)[0]! as HTMLInputElement;
}

async function savedRecipe(): Promise<Recipe> {
  await userEvent.click(screen.getByTestId('recipe-save-btn'));
  await waitFor(() => expect(persistRecipe).toHaveBeenCalledTimes(1));
  return vi.mocked(persistRecipe).mock.calls[0]![0];
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  mockCanonItems._set([]);
  mockRecipes._set([]);
  vi.clearAllMocks();
});

// The three boxes, driven through one table so a fourth required-number box
// added later is one row rather than a new suite — and so the step timer, which
// had no unit coverage at all before this issue, cannot quietly diverge from the
// phase boxes it shares the defect with.
const BOXES: readonly { name: string; testId: string; stored: string }[] = [
  { name: 'phase hands-on', testId: 'recipe-phase-hands-on-input', stored: '20' },
  { name: 'phase hands-off', testId: 'recipe-phase-hands-off-input', stored: '5' },
  { name: 'step timer duration', testId: 'recipe-step-timer-minutes', stored: '90' },
];

describe.each(BOXES)('RecipeEditPage — the $name box', ({ testId, stored }) => {
  function open(): HTMLInputElement {
    renderEditor({ steps: [timedStep()] });
    return box(testId);
  }

  it('shows the stored figure to begin with', () => {
    expect(open().value).toBe(stored);
  });

  it('stays empty when it is cleared, instead of repainting 0 under the caret', async () => {
    const input = open();

    await userEvent.clear(input);

    expect(input.value).toBe('');
  });

  it('takes a retype after a clear without a leading 0', async () => {
    const input = open();

    await userEvent.clear(input);
    await userEvent.type(input, '45');

    expect(input.value).toBe('45');
  });

  // The interaction the defect was actually reported through: backspace the old
  // figure away one keystroke at a time, then type the new one. `userEvent.clear`
  // is a select-all-and-delete and does NOT exercise the same path.
  it('takes a retype after backspacing the old figure away', async () => {
    const input = open();

    await userEvent.click(input);
    for (let i = 0; i < stored.length; i += 1) await userEvent.keyboard('{Backspace}');
    await userEvent.type(input, '45');

    expect(input.value).toBe('45');
  });

  it('snaps back to the stored figure on blur', async () => {
    const input = open();

    await userEvent.clear(input);
    await userEvent.tab();

    expect(input.value).toBe('0');
  });
});

describe('RecipeEditPage — what the minute boxes store', () => {
  it('saves a retimed phase as the figure that is on screen', async () => {
    renderEditor();
    const input = box('recipe-phase-hands-on-input');

    await userEvent.clear(input);
    await userEvent.type(input, '45');

    expect((await savedRecipe()).metadata.phases).toEqual([{ ...MIX, handsOnMinutes: 45 }]);
  });

  it('saves a retimed step timer as the figure that is on screen', async () => {
    renderEditor({ steps: [timedStep()] });
    const input = box('recipe-step-timer-minutes');

    await userEvent.clear(input);
    await userEvent.type(input, '45');

    expect((await savedRecipe()).steps[0]!.timer).toEqual({
      durationMinutes: 45,
      description: null,
    });
  });

  // A box left empty is a real 0, not a hole. Blur puts that on screen; this pins
  // that the save agrees with what blur showed.
  it('saves an emptied box as 0', async () => {
    renderEditor();
    const input = box('recipe-phase-hands-on-input');

    await userEvent.clear(input);
    await userEvent.tab();

    expect((await savedRecipe()).metadata.phases).toEqual([{ ...MIX, handsOnMinutes: 0 }]);
  });
});

// The other half of the contract, and the reason the box cannot simply STOP
// listening to the stored figure. The phase `{#each}` is UNKEYED, so reordering
// or deleting a row hands a surviving box a different phase's minutes through the
// same component instance. A box that only ever seeded itself once would then
// show the wrong phase's time — a worse defect than the one #1221 reports, and
// the neighbour this fix had to not create.
describe('RecipeEditPage — a minute box whose phase changes underneath it', () => {
  it('re-seeds when a reorder moves a different phase into its row', async () => {
    renderEditor({}, [MIX, PROVE]);
    expect(box('recipe-phase-hands-on-input').value).toBe('20');

    await userEvent.click(screen.getAllByLabelText('Move phase down')[0]!);

    expect(box('recipe-phase-hands-on-input').value).toBe('0');
    expect(box('recipe-phase-hands-off-input').value).toBe('90');
  });

  it('re-seeds when the row above it is deleted', async () => {
    renderEditor({}, [MIX, PROVE]);

    await userEvent.click(screen.getAllByLabelText('Remove phase')[0]!);

    expect(box('recipe-phase-hands-on-input').value).toBe('0');
    expect(box('recipe-phase-hands-off-input').value).toBe('90');
  });

  // Re-seeding is on DISAGREEMENT, not on every change — so an edit the box made
  // itself must not bounce back through it. Retiming one row leaves the other
  // exactly where the cook left it.
  it('does not disturb a sibling row it did not edit', async () => {
    renderEditor({}, [MIX, PROVE]);
    const first = box('recipe-phase-hands-on-input');

    await userEvent.clear(first);
    await userEvent.type(first, '45');

    expect(first.value).toBe('45');
    expect(screen.getAllByTestId('recipe-phase-hands-off-input')[1]!).toHaveValue('90');
  });
});
