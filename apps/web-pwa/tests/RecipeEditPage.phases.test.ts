import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { emptyIngredientGroup, emptyRecipe, newIngredient } from '@salt/domain';
import type { Recipe, RecipePhase } from '@salt/domain';

// The hand editor for a recipe's phase strip (issue #1212).
//
// Three things are pinned here and nowhere else:
//
//  1. THE SWAP, now complete (issue #1213): the edit page offers the strip and
//     NOT the three Prep / Cook / Total boxes, for everyone, with no key left to
//     turn. The boxes are gone from the markup, so there is no "key off" half of
//     this promise any more.
//  2. THE ROUND TRIP THROUGH THE SAVE. What the cook typed is what
//     `persistRecipe` is handed: two minute figures per phase, never a third, and
//     no stored elapsed time.
//  3. THE CAP IS INBOUND ONLY (#1123). A stored strip of seven renders all seven
//     and stays editable; the cap only stops this editor adding an eighth.

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
// The real gate reads uninitialised observability and therefore always answers
// "on", which would make the key-off assertions below untestable.
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

const MIX: RecipePhase = { label: 'Mix & knead', handsOnMinutes: 20, handsOffMinutes: 0 };
const PROVE: RecipePhase = { label: 'First rise', handsOnMinutes: 0, handsOffMinutes: 90 };
const BAKE: RecipePhase = { label: 'Bake', handsOnMinutes: 5, handsOffMinutes: 40 };

// The real builders (UT-C2): `emptyRecipe` owns the document shape, so this
// fixture states only what the suite is about — a strip, and the three stored
// numbers it must leave alone. `phases: undefined` is the pre-#1122 document that
// carries no key at all, which the builder cannot produce and which the editor
// still has to render.
const ISO = '2026-01-01T00:00:00.000Z';

function loaf(phases?: RecipePhase[]): Recipe {
  const base = emptyRecipe('entry-1', ISO);
  const metadata = {
    ...base.metadata,
    servings: 4,
    prepTimeMinutes: 15,
    cookTimeMinutes: 30,
    totalTimeMinutes: 45,
    ...(phases === undefined ? {} : { phases }),
  };
  if (phases === undefined) delete metadata.phases;
  return {
    ...base,
    title: 'Sourdough',
    ingredients: [
      { ...emptyIngredientGroup('group-1'), items: [newIngredient('ing-1', '500 g flour')] },
    ],
    metadata,
  };
}

function renderEditor(phases?: RecipePhase[]): void {
  mockRecipes._set([loaf(phases)]);
  render(RecipeEditPage, { props: { params: { id: 'entry-1' } } });
}

async function typeInto(field: HTMLElement, value: string): Promise<void> {
  await userEvent.clear(field);
  if (value !== '') await userEvent.type(field, value);
}

async function savedRecipe(): Promise<Recipe> {
  await userEvent.click(screen.getByTestId('recipe-save-btn'));
  await waitFor(() => expect(persistRecipe).toHaveBeenCalledTimes(1));
  return vi.mocked(persistRecipe).mock.calls[0]![0];
}

function rows(): HTMLElement[] {
  return screen.queryAllByTestId('recipe-phase');
}

function labelInputs(): HTMLElement[] {
  return screen.queryAllByTestId('recipe-phase-label-input');
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  mockCanonItems._set([]);
  mockRecipes._set([]);
  vi.clearAllMocks();
});

describe('RecipeEditPage — the phase editor', () => {
  // Servings and the strip, and NOTHING ELSE. Issue #1233 moved `scheduleFor` and
  // `insertComponentByElapsedTime` (packages/domain) onto `recipePhaseTotals()`,
  // which removed the last reader of `cookTimeMinutes` and the last reason to let
  // a cook type one — so the strip is now the only timing control on this page.
  it('is the ONLY timing control — Servings and the strip, no Prep/Cook/Total boxes', () => {
    renderEditor([MIX]);

    expect(screen.getByTestId('recipe-servings-input')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-phase-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('recipe-prep-input')).toBeNull();
    expect(screen.queryByTestId('recipe-cook-input')).toBeNull();
    expect(screen.queryByTestId('recipe-total-input')).toBeNull();
  });

  it('draws a row per stored phase, with its two minute figures and no third', () => {
    renderEditor([MIX, PROVE]);

    expect(rows()).toHaveLength(2);
    expect(labelInputs()[0]).toHaveValue('Mix & knead');
    expect(screen.getAllByTestId('recipe-phase-hands-on-input')[1]).toHaveValue('0');
    expect(screen.getAllByTestId('recipe-phase-hands-off-input')[1]).toHaveValue('90');
    // Two fields per row, never a total: elapsed time is computed, never stored.
    expect(screen.getAllByTestId('recipe-phase-hands-on-input')).toHaveLength(2);
    expect(screen.getAllByTestId('recipe-phase-hands-off-input')).toHaveLength(2);
  });

  it('adds a phase the cook names and times, and saves exactly that', async () => {
    renderEditor([]);

    await userEvent.click(screen.getByTestId('recipe-add-phase-btn'));
    expect(rows()).toHaveLength(1);

    await typeInto(labelInputs()[0]!, 'Rest');
    await typeInto(screen.getAllByTestId('recipe-phase-hands-on-input')[0]!, '3');
    await typeInto(screen.getAllByTestId('recipe-phase-hands-off-input')[0]!, '25');

    expect((await savedRecipe()).metadata.phases).toEqual([
      { label: 'Rest', handsOnMinutes: 3, handsOffMinutes: 25 },
    ]);
  });

  it('renames a phase without touching its minutes', async () => {
    renderEditor([PROVE]);

    await typeInto(labelInputs()[0]!, 'Bulk ferment');

    expect((await savedRecipe()).metadata.phases).toEqual([
      { label: 'Bulk ferment', handsOnMinutes: 0, handsOffMinutes: 90 },
    ]);
  });

  it('moves a phase up and down, because the order is the plan', async () => {
    renderEditor([MIX, PROVE, BAKE]);

    await userEvent.click(screen.getAllByLabelText('Move phase down')[0]!);
    expect(labelInputs().map((i) => (i as HTMLInputElement).value)).toEqual([
      'First rise',
      'Mix & knead',
      'Bake',
    ]);

    await userEvent.click(screen.getAllByLabelText('Move phase up')[2]!);
    expect((await savedRecipe()).metadata.phases).toEqual([PROVE, BAKE, MIX]);
  });

  it('deletes a phase', async () => {
    renderEditor([MIX, PROVE]);

    await userEvent.click(screen.getAllByLabelText('Remove phase')[0]!);

    expect((await savedRecipe()).metadata.phases).toEqual([PROVE]);
  });

  it('keeps 0 as a real answer and refuses to store a negative', async () => {
    renderEditor([PROVE]);

    await typeInto(screen.getAllByTestId('recipe-phase-hands-off-input')[0]!, '-5');

    const saved = await savedRecipe();
    expect(saved.metadata.phases).toEqual([
      { label: 'First rise', handsOnMinutes: 0, handsOffMinutes: 0 },
    ]);
  });

  // The claim the whole feature rests on: an ordinary save is not a re-estimate.
  it('carries a hand-edited strip through a save it did not touch', async () => {
    renderEditor([MIX, PROVE, BAKE]);

    await typeInto(screen.getByTestId('recipe-title-input'), 'Sourdough, take two');

    const saved = await savedRecipe();
    expect(saved.title).toBe('Sourdough, take two');
    expect(saved.metadata.phases).toEqual([MIX, PROVE, BAKE]);
  });

  it('leaves the stored Prep / Cook / Total values alone when a save does not touch them', async () => {
    renderEditor([MIX]);

    const saved = await savedRecipe();
    expect(saved.metadata.prepTimeMinutes).toBe(15);
    expect(saved.metadata.cookTimeMinutes).toBe(30);
    expect(saved.metadata.totalTimeMinutes).toBe(45);
  });

  // #1123: the six-phase cap is a bound on what a MODEL may return. A production
  // document holding seven is a document to edit, not one to truncate.
  it('renders and edits an over-cap strip, and only withholds the Add button', async () => {
    const seven: RecipePhase[] = Array.from({ length: 7 }, (_, i) => ({
      label: `Phase ${i + 1}`,
      handsOnMinutes: i,
      handsOffMinutes: 0,
    }));
    renderEditor(seven);

    expect(rows()).toHaveLength(7);
    expect(screen.queryByTestId('recipe-add-phase-btn')).toBeNull();

    await userEvent.click(screen.getAllByLabelText('Remove phase')[6]!);
    expect((await savedRecipe()).metadata.phases).toHaveLength(6);
  });

  it('offers Add again once the strip is back under the cap', async () => {
    const six: RecipePhase[] = Array.from({ length: 6 }, (_, i) => ({
      label: `Phase ${i + 1}`,
      handsOnMinutes: 0,
      handsOffMinutes: 0,
    }));
    renderEditor(six);

    expect(screen.queryByTestId('recipe-add-phase-btn')).toBeNull();

    await userEvent.click(screen.getAllByLabelText('Remove phase')[0]!);
    expect(screen.getByTestId('recipe-add-phase-btn')).toBeInTheDocument();
  });
});

describe('RecipeEditPage — the three retired time boxes (issue #1233)', () => {
  // Removing the boxes must not remove the VALUES. A recipe saved before #1233
  // still stores prep, cook and total; nothing reads them any more, but a save
  // from this page must leave them exactly as it found them rather than dropping
  // or zeroing three fields the cook can no longer see.
  it('leaves the stored prep, cook and total untouched on save', async () => {
    renderEditor([MIX, PROVE]);

    await typeInto(screen.getByTestId('recipe-servings-input'), '6');

    const saved = await savedRecipe();
    expect(saved.metadata.prepTimeMinutes).toBe(15);
    expect(saved.metadata.cookTimeMinutes).toBe(30);
    expect(saved.metadata.totalTimeMinutes).toBe(45);
    expect(saved.metadata.phases).toEqual([MIX, PROVE]);
  });
});
