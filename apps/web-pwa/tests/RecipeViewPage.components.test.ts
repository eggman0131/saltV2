import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import type { Recipe } from '@salt/domain';

// Meals on the recipe page (issue #752). A meal is an ordinary recipe document
// that carries `componentRecipeIds`; this page only DISPLAYS them — attaching,
// reordering and removing all live in the editor, because they are edits.
//
// Two properties carry the weight here, and both are the one-level invariant seen
// from different sides: a dangling id renders NOTHING rather than a broken row,
// and a component's own components never appear.

const {
  mockRecipes,
  mockCanonItems,
  mockGuidedPlan,
  mockFormula,
  mockIsLoading,
  mockDefaultListId,
  mockSessions,
  mockEquipment,
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
        subs.forEach((fn) => fn(v));
      },
    };
  }
  return {
    mockRecipes: makeStore<readonly Recipe[]>([]),
    mockCanonItems: makeStore<readonly { id: string }[]>([]),
    mockGuidedPlan: makeStore<unknown>(null),
    mockFormula: makeStore<unknown>(null),
    mockIsLoading: makeStore<boolean>(false),
    mockDefaultListId: makeStore<string | null>('list-1'),
    mockSessions: makeStore<readonly unknown[]>([]),
    mockEquipment: makeStore<{ items: readonly { name: string }[] } | null>({
      items: [{ name: 'Sage Pizzaiolo' }],
    }),
  };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/auth.svelte.js', () => ({
  auth: { user: { uid: 'uid-1', email: 'cook@test' } },
}));
// #867: the ingredient rows gate their ✗/⚠ markers on canon AND product forms
// having landed, so both stores must read loaded here or no marker ever renders.
vi.mock('../src/lib/canonService.js', () => ({
  canonItems: mockCanonItems,
  isLoadingAisles: {
    subscribe(fn: (v: boolean) => void) {
      fn(false);
      return () => {};
    },
  },
}));
vi.mock('../src/lib/productFormService.js', () => {
  const loaded = <T>(v: T) => ({
    subscribe(fn: (x: T) => void) {
      fn(v);
      return () => {};
    },
  });
  return { productForms: loaded([]), isLoadingProductForms: loaded(false) };
});
vi.mock('../src/lib/guidedPlanService.js', () => ({
  guidedPlan: mockGuidedPlan,
  initGuidedPlanSync: vi.fn(() => () => {}),
}));
vi.mock('../src/lib/formulaService.js', () => ({
  formula: mockFormula,
  initFormulaSync: vi.fn(() => () => {}),
}));
vi.mock('../src/lib/shoppingListService.svelte.js', () => ({ defaultListId: mockDefaultListId }));
vi.mock('@salt/firebase-sync', () => ({
  saveRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));
vi.mock('../src/lib/chatService.js', () => ({
  sessions: mockSessions,
  createChatSession: vi.fn(),
  sendMessage: vi.fn(),
}));
vi.mock('../src/lib/equipmentService.js', () => ({ equipment: mockEquipment }));
vi.mock('../src/lib/clipboardImage.js', () => ({
  clipboardImageReadSupported: () => false,
  readClipboardImage: vi.fn(),
  imageFromClipboardData: vi.fn(),
}));
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
  isLoadingRecipes: mockIsLoading,
  removeRecipe: vi.fn(),
  canonicaliseIngredients: vi.fn(),
  matchIngredient: vi.fn(),
  persistRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  stashImportedDraft: vi.fn(),
  authorRecipeTraced: vi.fn(),
  regenerateRecipeImage: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  reviseRecipeSceneBrief: vi.fn(),
  startOverRecipeSceneBrief: vi.fn(),
  setRecipeImageUpload: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  buildRecipeAddPlan: vi.fn().mockReturnValue([]),
  buildMadeSubRows: vi.fn().mockReturnValue([]),
  commitRecipeAddPlan: vi.fn(),
  recipeAddPlanItemCount: vi.fn().mockReturnValue(0),
}));

import { push } from 'svelte-spa-router';
import RecipeViewPage from '../src/routes/recipes/RecipeViewPage.svelte';

const RECIPE_ID = 'entry-1';

function makeEntry(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: RECIPE_ID,
    schemaVersion: 1,
    kind: 'recipe',
    title: 'Sunday roast',
    description: 'The whole thing.',
    ingredients: [],
    steps: [{ id: 'step-1', text: 'Carve.', note: null, timer: null }],
    metadata: {
      servings: 4,
      prepTimeMinutes: 10,
      cookTimeMinutes: 20,
      totalTimeMinutes: 30,
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
  } as Recipe;
}

function makeComponent(over: Partial<Recipe> & { id: string; title: string }): Recipe {
  return makeEntry({ ...over, description: null });
}

const CHICKEN = makeComponent({
  id: 'chicken',
  title: 'Roast chicken',
  metadata: {
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 90,
    totalTimeMinutes: 100,
    tags: [],
  },
  image: { url: 'https://example.com/chicken.webp', source: 'ai' },
});

// No cook time and no hero: the two fallbacks, on one dish.
const GRAVY = makeComponent({
  id: 'gravy',
  title: 'Onion gravy',
  metadata: {
    servings: 4,
    prepTimeMinutes: 5,
    cookTimeMinutes: null,
    totalTimeMinutes: 5,
    tags: [],
  },
  image: null,
});

afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockCanonItems._set([]);
  mockIsLoading._set(false);
  mockRecipes._set([]);
  mockGuidedPlan._set(null);
  mockFormula._set(null);
});

function renderPage() {
  return render(RecipeViewPage, { props: { params: { id: RECIPE_ID } } });
}

function componentTitles(): string[] {
  return screen
    .queryAllByTestId('recipe-component-card')
    .map((el) => el.querySelector('span.truncate')?.textContent?.trim() ?? '');
}

describe('RecipeViewPage — the dishes a meal is made of', () => {
  it('shows no "Made from" card on an ordinary recipe', () => {
    mockRecipes._set([makeEntry(), CHICKEN, GRAVY]);
    renderPage();

    // Derived, never declared: nothing is attached, so there is no meal and no
    // card. A recipe that COULD take components is not offered an empty one.
    expect(screen.queryByTestId('recipe-components')).toBeNull();
  });

  it('lists the components in stored order, with hero, title and cook time', () => {
    mockRecipes._set([makeEntry({ componentRecipeIds: ['chicken', 'gravy'] }), CHICKEN, GRAVY]);
    renderPage();

    expect(componentTitles()).toEqual(['Roast chicken', 'Onion gravy']);

    // The hero is cache-busted through the page's own idiom, and a component with
    // no image falls back to a tile rather than an empty box.
    expect(screen.getByTestId('recipe-component-thumb')).toHaveAttribute(
      'src',
      `https://example.com/chicken.webp?v=${CHICKEN.updatedAt}`,
    );
    expect(screen.getByTestId('recipe-component-thumb-fallback')).toBeInTheDocument();

    // Cook time, and only where there is one to state — gravy has none.
    const cookTimes = screen
      .getAllByTestId('recipe-component-cook-time')
      .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
    expect(cookTimes).toEqual(['90 min']);
  });

  it('keeps the stored order rather than re-sorting by cook time', () => {
    // The stored order is the cook's own running order; the page renders it, it
    // does not have an opinion about it.
    mockRecipes._set([makeEntry({ componentRecipeIds: ['gravy', 'chicken'] }), CHICKEN, GRAVY]);
    renderPage();

    expect(componentTitles()).toEqual(['Onion gravy', 'Roast chicken']);
  });

  it('skips a component deleted elsewhere instead of rendering a broken row', () => {
    mockRecipes._set([
      makeEntry({ componentRecipeIds: ['chicken', 'deleted-elsewhere', 'gravy'] }),
      CHICKEN,
      GRAVY,
    ]);
    renderPage();

    // No cascade, no tombstone, no placeholder row — the dish is simply gone.
    expect(componentTitles()).toEqual(['Roast chicken', 'Onion gravy']);
    expect(screen.queryByText('deleted-elsewhere')).toBeNull();
  });

  it('says so plainly when every component has been deleted', () => {
    mockRecipes._set([makeEntry({ componentRecipeIds: ['gone-a', 'gone-b'] })]);
    renderPage();

    // The document still says it is a meal, so the card stays; the inner guard
    // covers the case, in the same idiom the Ingredients card uses.
    expect(screen.queryByTestId('recipe-components')).toBeNull();
    expect(screen.getByText(/no longer in the library/i)).toBeInTheDocument();
  });

  it('resolves ONE level only — a component of a component never appears', () => {
    const sides = makeComponent({ id: 'sides', title: 'The sides' });
    mockRecipes._set([
      makeEntry({ componentRecipeIds: ['chicken', 'sides'] }),
      CHICKEN,
      GRAVY,
      { ...sides, componentRecipeIds: ['gravy'] },
    ]);
    renderPage();

    expect(componentTitles()).toEqual(['Roast chicken', 'The sides']);
    expect(componentTitles()).not.toContain('Onion gravy');
  });

  it('renders one card each for a reference cycle rather than looping', () => {
    const other = makeComponent({ id: 'other', title: 'The other one' });
    mockRecipes._set([
      makeEntry({ componentRecipeIds: ['other'] }),
      { ...other, componentRecipeIds: [RECIPE_ID] },
    ]);
    renderPage();

    expect(componentTitles()).toEqual(['The other one']);
  });

  it('navigates to the component when its card is tapped', async () => {
    mockRecipes._set([makeEntry({ componentRecipeIds: ['chicken'] }), CHICKEN]);
    renderPage();

    await fireEvent.click(screen.getByTestId('recipe-component-card'));

    expect(push).toHaveBeenCalledWith('/recipes/chicken');
  });

  it('keeps the meal its OWN ingredients and method — nothing is aggregated', () => {
    const meal = makeEntry({
      componentRecipeIds: ['chicken'],
      ingredients: [
        {
          id: 'group-1',
          name: null,
          items: [
            {
              id: 'ing-1',
              rawText: 'A jug of gravy, warmed',
              parsed: null,
              canonId: null,
              matchState: 'pending',
              isOptional: false,
              firstUsedInStepId: null,
            },
          ],
        },
      ],
    });
    mockRecipes._set([meal, CHICKEN]);
    renderPage();

    // The meal's single ingredient line, and only it: the chicken's ingredients
    // are the chicken's, on the chicken's page.
    const lines = screen.getAllByTestId('recipe-view-ingredient');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toContain('A jug of gravy, warmed');
    // And the meal's own method survives beside the components.
    expect(screen.getByTestId('recipe-view-step').textContent).toContain('Carve.');
  });
});
