import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { appendCacheBuster } from '@salt/domain';
import type { Recipe } from '@salt/domain';

// Building a meal in the editor (issue #752). A recipe BECOMES a meal by gaining
// components — there is no "new meal" and no kind to pick — so this section is the
// whole of the feature's way in.
//
// Everything here mutates the DRAFT and is written by the page's existing save
// path; there is no second write. The picker is driven with `fireEvent` rather
// than `userEvent` for the reason MealDayEditor.recipePicker.test.ts records: a
// synthetic focus shuffle can tear a bits-ui listbox down before the click lands.

const { mockRecipes, mockCanonItems } = await vi.hoisted(async () => {
  const { makeStore } = await import('./support/testStore.js');
  return {
    mockRecipes: makeStore<readonly Recipe[]>([]),
    mockCanonItems: makeStore<readonly { id: string }[]>([]),
  };
});

vi.mock('svelte-spa-router', () => ({
  push: vi.fn(),
  // The editor reads '?meal=' off the live router (issue #752, Phase 3); nothing
  // sent us here from a meal, so the querystring is empty.
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

import RecipeEditPage from '../src/routes/recipes/RecipeEditPage.svelte';
import { persistRecipe } from '../src/lib/recipeService.js';

const MEAL_ID = 'roast';

function makeRecipe(overrides: Partial<Recipe> & { id: string; title: string }): Recipe {
  return {
    lastEditedBy: '',
    createdBy: '',
    schemaVersion: 1,
    kind: 'recipe',
    description: null,
    ingredients: [],
    steps: [],
    metadata: {
      servings: null,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      totalTimeMinutes: null,
      tags: [],
    },
    source: null,
    notes: null,
    producesCanonId: null,
    componentRecipeIds: [],
    kit: [],
    image: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Give a dish a phase strip that elapses `minutes`. Since issue #1233 the strip is
 * what decides where an attached component lands, so this is the field the
 * ordering asserted below is driven from.
 */
function withElapsed(recipe: Recipe, minutes: number): Recipe {
  return {
    ...recipe,
    metadata: {
      ...recipe.metadata,
      phases: [{ label: 'Cook', handsOnMinutes: 0, handsOffMinutes: minutes }],
    },
  };
}

const ROAST = makeRecipe({ id: MEAL_ID, title: 'Sunday roast' });
const CHICKEN = withElapsed(makeRecipe({ id: 'chicken', title: 'Roast chicken' }), 90);
const POTATOES = withElapsed(makeRecipe({ id: 'potatoes', title: 'Roast potatoes' }), 45);
const GRAVY = withElapsed(makeRecipe({ id: 'gravy', title: 'Onion gravy' }), 20);
const TAKEAWAY = makeRecipe({ id: 'takeaway', title: 'Takeaway — Indian', kind: 'outing' });
const PLACEHOLDER = makeRecipe({ id: 'stock-photo', title: 'A good dinner', kind: 'placeholder' });

const LIBRARY = [ROAST, CHICKEN, POTATOES, GRAVY, TAKEAWAY, PLACEHOLDER];

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  mockCanonItems._set([]);
  mockRecipes._set([]);
  vi.clearAllMocks();
});

/** Open the editor on the meal and wait for the draft to hydrate from the store. */
async function openEditor(id = MEAL_ID): Promise<void> {
  render(RecipeEditPage, { props: { params: { id } } });
  await waitFor(() => expect(screen.getByTestId('recipe-components-editor')).toBeInTheDocument());
}

async function openPicker(): Promise<void> {
  await fireEvent.click(screen.getByTestId('recipe-component-picker'));
}

async function pick(title: string): Promise<void> {
  await openPicker();
  await fireEvent.click(await screen.findByRole('option', { name: title }));
}

function rowTitles(): string[] {
  return screen
    .queryAllByTestId('recipe-component-row')
    .map((el) => el.querySelector('span.truncate')?.textContent?.trim() ?? '');
}

function savedComponents(): string[] {
  return vi.mocked(persistRecipe).mock.calls[0]![0].componentRecipeIds;
}

describe('RecipeEditPage — building a meal out of recipes', () => {
  it('offers the section on a recipe and a cocktail, and on nothing else', async () => {
    // A capability, so it comes from the domain table rather than a kind branch:
    // an outing has no dish to compose, a placeholder is a photograph and a title.
    mockRecipes._set(LIBRARY);

    await openEditor();
    expect(screen.getByTestId('recipe-components-editor')).toBeInTheDocument();

    for (const id of ['takeaway', 'stock-photo']) {
      cleanup();
      render(RecipeEditPage, { props: { params: { id } } });
      await waitFor(() => expect(screen.getByTestId('recipe-title-input')).toBeInTheDocument());
      expect(screen.queryByTestId('recipe-components-editor')).toBeNull();
    }
  });

  it('offers only dishes you make — never itself, an outing or a placeholder', async () => {
    mockRecipes._set(LIBRARY);
    await openEditor();
    await openPicker();

    const options = (await screen.findAllByRole('option')).map((o) => o.textContent?.trim());
    expect(options).toEqual(['Roast chicken', 'Roast potatoes', 'Onion gravy']);
  });

  it('attaches longest-first, whatever order you pick them in', async () => {
    mockRecipes._set(LIBRARY);
    await openEditor();

    await pick('Onion gravy');
    await pick('Roast chicken');
    await pick('Roast potatoes');

    // The order you start things in: the bird before the potatoes before the gravy.
    expect(rowTitles()).toEqual(['Roast chicken', 'Roast potatoes', 'Onion gravy']);
  });

  it('drops an attached dish out of the picker so it cannot be added twice', async () => {
    mockRecipes._set(LIBRARY);
    await openEditor();

    await pick('Roast chicken');
    await openPicker();

    const options = (await screen.findAllByRole('option')).map((o) => o.textContent?.trim());
    expect(options).not.toContain('Roast chicken');
  });

  it('removes a dish without touching the others', async () => {
    mockRecipes._set([{ ...ROAST, componentRecipeIds: ['chicken', 'potatoes'] }, ...LIBRARY]);
    await openEditor();
    expect(rowTitles()).toEqual(['Roast chicken', 'Roast potatoes']);

    await fireEvent.click(screen.getByTestId('recipe-component-remove-chicken'));

    expect(rowTitles()).toEqual(['Roast potatoes']);
  });

  it('skips a component deleted elsewhere rather than rendering a broken row', async () => {
    mockRecipes._set([
      { ...ROAST, componentRecipeIds: ['chicken', 'deleted-elsewhere'] },
      CHICKEN,
      GRAVY,
    ]);
    await openEditor();

    expect(rowTitles()).toEqual(['Roast chicken']);
  });

  it('writes the components through the existing save path, and nothing else', async () => {
    mockRecipes._set(LIBRARY);
    await openEditor();

    await pick('Roast chicken');
    await pick('Onion gravy');

    // Nothing has been written yet — the draft is the only thing that moved.
    expect(persistRecipe).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByTestId('recipe-save-btn'));

    await waitFor(() => expect(persistRecipe).toHaveBeenCalledTimes(1));
    expect(savedComponents()).toEqual(['chicken', 'gravy']);
    // The kind is untouched: a meal is not a fifth kind, it is a recipe with
    // components.
    expect(vi.mocked(persistRecipe).mock.calls[0]![0].kind).toBe('recipe');
  });

  it('keeps the meal its own ingredients and method beside the components', async () => {
    mockRecipes._set(LIBRARY);
    await openEditor();

    // Nothing is aggregated, so the editor still offers everything a recipe has.
    expect(screen.getByText('Ingredients')).toBeInTheDocument();
    expect(screen.getByText('Method')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-notes-input')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-tags-input')).toBeInTheDocument();
  });
});

// ─── Hero URL rule (issue #933 characterisation) ──────────────────────────────
// This is issue #933's characterisation net for the "hero URL" rule — one of
// eight identical copies of `appendCacheBuster(recipe.image.url,
// recipe.imageRequestedAt ?? recipe.updatedAt)` scattered across web-pwa, here
// at the sub-recipe COMPONENT row thumbnail. It must stay green, UNMODIFIED,
// once all eight collapse onto one shared `@salt/domain` function.
// Expectations are computed by calling the REAL `appendCacheBuster` rather than
// hand-encoding a query string. The row's `<img>` carries no testid of its own,
// so it is queried off the row's DOM directly. Reuses this file's own
// hand-rolled `makeRecipe` (UT-C2: an existing suite's helper, not a second one).
describe('RecipeEditPage — hero URL rule at the sub-recipe thumbnail (issue #933 characterisation)', () => {
  it.each([
    { name: 'busts with imageRequestedAt when present', imageRequestedAt: 777 },
    {
      name: 'falls back to updatedAt when imageRequestedAt is absent',
      imageRequestedAt: undefined,
    },
  ])('$name', async ({ imageRequestedAt }) => {
    const url = 'https://example.com/hero-component.webp';
    const HERO_COMPONENT = makeRecipe({
      id: 'hero-component',
      title: 'Hero Component',
      image: { url, source: 'ai' },
      updatedAt: '2026-01-05T00:00:00.000Z',
      ...(imageRequestedAt !== undefined ? { imageRequestedAt } : {}),
    });
    mockRecipes._set([{ ...ROAST, componentRecipeIds: ['hero-component'] }, HERO_COMPONENT]);
    await openEditor();

    const row = screen.getByTestId('recipe-component-row');
    expect(row.querySelector('img')).toHaveAttribute(
      'src',
      appendCacheBuster(url, imageRequestedAt ?? HERO_COMPONENT.updatedAt),
    );
  });

  it('renders the fallback icon, not an img, when the component has no image', async () => {
    mockRecipes._set([{ ...ROAST, componentRecipeIds: ['gravy'] }, GRAVY]);
    await openEditor();

    const row = screen.getByTestId('recipe-component-row');
    expect(row.querySelector('img')).toBeNull();
  });

  // Issue #1122: the row shows the phase sum, and after issue #1213 nothing else
  // — the stored-cook-time fallback under it is gone, so a dish with no strip
  // shows no time. Same rule as the view page's rows (`recipeTiming.ts`). The
  // stripless potatoes below still store a cook time and must show none of it.
  it("shows a component's phase sum, and no time at all without one", async () => {
    const gravyWithPhases = {
      ...GRAVY,
      metadata: {
        ...GRAVY.metadata,
        phases: [
          { label: 'Soften onions', handsOnMinutes: 5, handsOffMinutes: 20 },
          { label: 'Reduce', handsOnMinutes: 5, handsOffMinutes: 10 },
        ],
      },
    };
    const potatoesWithNoStrip: Recipe = {
      ...POTATOES,
      metadata: { ...POTATOES.metadata, phases: undefined, cookTimeMinutes: 45 },
    };
    mockRecipes._set([
      { ...ROAST, componentRecipeIds: ['gravy', 'potatoes'] },
      gravyWithPhases,
      potatoesWithNoStrip,
    ]);
    await openEditor();

    const rows = screen.getAllByTestId('recipe-component-row').map((r) => r.textContent ?? '');
    expect(rows.find((t) => t.includes('Onion gravy'))).toContain('40 min');
    expect(rows.find((t) => t.includes('Onion gravy'))).not.toContain('20 min');
    expect(rows.find((t) => t.includes('Roast potatoes'))).not.toContain('min');
  });
});
