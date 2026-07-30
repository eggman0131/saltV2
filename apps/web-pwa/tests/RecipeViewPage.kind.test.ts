import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import type { Recipe } from '@salt/domain';

// What an outing's page does NOT offer (issue #637). "Things that don't apply
// simply aren't offered": no Cook, no Add to list, no Ingredients card, no
// Method card, no Serves/Prep/Cook/Total. Two of those actions render on BOTH
// the inline `sm:` row and the mobile ⋮ menu, so each surface is asserted
// separately — jsdom applies no media queries, which is exactly what makes both
// markup sites visible to these assertions at once.
//
// The hero and the regenerate dialog are deliberately NOT gated: an outing's
// picture is the whole point of the entry, so this file also pins that they
// survive.

const {
  mockRecipes,
  mockCanonItems,
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
    mockIsLoading: makeStore<boolean>(false),
    mockDefaultListId: makeStore<string | null>('list-1'),
    mockSessions: makeStore<readonly unknown[]>([]),
    // Non-null so the equipment-gated "Optimise for my kitchen" button is
    // offered on its own terms — otherwise its absence would prove nothing.
    mockEquipment: makeStore<{ items: readonly { name: string }[] } | null>({
      items: [{ name: 'Sage Pizzaiolo' }],
    }),
  };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/auth.svelte.js', () => ({ auth: { user: { email: 'cook@test' } } }));
vi.mock('../src/lib/canonService.js', () => ({ canonItems: mockCanonItems }));
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

import RecipeViewPage from '../src/routes/recipes/RecipeViewPage.svelte';

const RECIPE_ID = 'entry-1';

function makeEntry(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: RECIPE_ID,
    schemaVersion: 1,
    kind: 'recipe',
    title: 'Test Recipe',
    description: 'A short description.',
    ingredients: [
      {
        id: 'group-1',
        name: null,
        items: [
          {
            id: 'ing-1',
            rawText: '2 eggs',
            parsed: null,
            canonId: null,
            matchState: 'pending',
            isOptional: false,
            firstUsedInStepId: null,
          },
        ],
      },
    ],
    steps: [{ id: 'step-1', text: 'Do the thing.', note: null, timer: null }],
    metadata: {
      servings: 4,
      prepTimeMinutes: 10,
      cookTimeMinutes: 20,
      totalTimeMinutes: 30,
      tags: ['weeknight'],
    },
    source: null,
    notes: null,
    image: { url: 'https://example.com/hero.webp', source: 'ai' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Recipe;
}

// An outing carries no ingredients, no steps and no timings — but the metadata
// fields are set here anyway, so an assertion that the chips are absent proves
// the CAPABILITY gate rather than merely an empty document.
function makeOuting(): Recipe {
  return makeEntry({
    kind: 'outing',
    title: 'Takeaway — Indian',
    description: 'Curry from the place on the corner.',
    ingredients: [],
    steps: [],
  });
}

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
});

function renderPage() {
  return render(RecipeViewPage, { props: { params: { id: RECIPE_ID } } });
}

// The ⋮ menu's contents only exist in the DOM once it is open (bits-ui renders
// PopoverContent lazily), so the mobile surface has to be opened before it can
// be asserted on. Edit is unconditional, which makes it the reliable signal that
// the menu is actually mounted — an assertion about what is MISSING would
// otherwise pass against a menu that never opened.
async function openOverflowMenu(): Promise<void> {
  await fireEvent.click(screen.getByTestId('recipe-actions-overflow'));
  await waitFor(() => expect(screen.getByTestId('recipe-edit-menu-item')).toBeInTheDocument());
}

describe('RecipeViewPage — a recipe keeps everything', () => {
  beforeEach(() => {
    mockRecipes._set([makeEntry()]);
  });

  it('offers Cook, Add to list, Ask/amend and Optimise on both surfaces', async () => {
    renderPage();

    expect(screen.getByTestId('recipe-cook-button')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-add-to-list-button')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-ask-amend-button')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-optimise-kitchen-button')).toBeInTheDocument();

    await openOverflowMenu();
    expect(screen.getByTestId('recipe-ask-amend-menu-item')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-optimise-kitchen-menu-item')).toBeInTheDocument();
  });

  it('shows the Ingredients and Method cards and the timings', () => {
    renderPage();

    expect(screen.getByText('Ingredients')).toBeInTheDocument();
    expect(screen.getByText('Method')).toBeInTheDocument();
    expect(screen.getByText('Serves 4')).toBeInTheDocument();
    expect(screen.getByText('Prep 10 min')).toBeInTheDocument();
    expect(screen.getByText('Cook 20 min')).toBeInTheDocument();
    expect(screen.getByText('Total 30 min')).toBeInTheDocument();
  });
});

describe('RecipeViewPage — an outing offers only what applies', () => {
  beforeEach(() => {
    mockRecipes._set([makeOuting()]);
  });

  it('offers no Cook and no Add to list', () => {
    renderPage();

    expect(screen.queryByTestId('recipe-cook-button')).toBeNull();
    expect(screen.queryByTestId('recipe-add-to-list-button')).toBeNull();
  });

  it('offers no Ask/amend and no Optimise on EITHER surface', async () => {
    renderPage();

    // Inline `sm:` row.
    expect(screen.queryByTestId('recipe-ask-amend-button')).toBeNull();
    expect(screen.queryByTestId('recipe-optimise-kitchen-button')).toBeNull();

    // Mobile ⋮ menu — a second, independent markup site. Opened first, so the
    // absences below are real and not just an unmounted menu.
    await openOverflowMenu();
    expect(screen.queryByTestId('recipe-ask-amend-menu-item')).toBeNull();
    expect(screen.queryByTestId('recipe-optimise-kitchen-menu-item')).toBeNull();
  });

  it('drops the Ingredients and Method cards outright, not just their contents', () => {
    renderPage();

    expect(screen.queryByText('Ingredients')).toBeNull();
    expect(screen.queryByText('Method')).toBeNull();
    // The inner guards would have rendered these if only the contents were gated.
    expect(screen.queryByText('No ingredients.')).toBeNull();
    expect(screen.queryByText('No steps.')).toBeNull();
  });

  it('drops the Serves / Prep / Cook / Total chips', () => {
    renderPage();

    expect(screen.queryByText('Serves 4')).toBeNull();
    expect(screen.queryByText('Prep 10 min')).toBeNull();
    expect(screen.queryByText('Cook 20 min')).toBeNull();
    expect(screen.queryByText('Total 30 min')).toBeNull();
  });

  it('keeps Edit and Delete, so the ⋮ menu never opens onto nothing', async () => {
    renderPage();

    expect(screen.getByTestId('recipe-actions-overflow')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-edit-button')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-delete-button')).toBeInTheDocument();

    await openOverflowMenu();
    expect(screen.getByTestId('recipe-delete-menu-item')).toBeInTheDocument();
  });

  it('keeps the hero, its description and the Regenerate control', () => {
    renderPage();

    expect(screen.getByTestId('recipe-hero')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-image-regenerate')).toBeInTheDocument();
    expect(screen.getByText('Curry from the place on the corner.')).toBeInTheDocument();
  });
});
