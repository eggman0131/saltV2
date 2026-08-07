import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import type { Recipe } from '@salt/domain';

// What an outing's page does NOT offer (issue #637). "Things that don't apply
// simply aren't offered": no Cook, no Shop, no Ingredients card, no Method card,
// no Serves/Prep/Cook/Total.
//
// It also carries the action RANKING (Cook / Shop / Plan filled and inline;
// Chat / Optimise / Duplicate / Edit / Delete in the ⋮ menu, which since #735 is
// their ONLY surface at any width), since what an entry offers and how loudly it
// offers it are the same markup. jsdom applies no media queries, so a width-gated
// second markup site would be visible to these assertions — which is what makes
// "the demoted five have no inline site" a real assertion rather than a hopeful one.
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
    // Non-null so the equipment-gated "Optimise" button is offered on its own
    // terms — otherwise its absence would prove nothing.
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
import { persistRecipe, stashImportedDraft } from '../src/lib/recipeService.js';
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
// PopoverContent lazily), so it has to be opened before it can be asserted on.
// Edit is unconditional, which makes it the reliable signal that the menu is
// actually mounted — an assertion about what is MISSING would otherwise pass
// against a menu that never opened. Since #735 this is the ONLY surface the
// demoted actions have, at any width.
async function openOverflowMenu(): Promise<void> {
  await fireEvent.click(screen.getByTestId('recipe-actions-overflow'));
  await waitFor(() => expect(screen.getByTestId('recipe-edit-menu-item')).toBeInTheDocument());
}

describe('RecipeViewPage — a recipe keeps everything', () => {
  beforeEach(() => {
    mockRecipes._set([makeEntry()]);
  });

  it('offers Cook, Shop and Plan inline, with Chat and Optimise in the ⋮ menu', async () => {
    renderPage();

    expect(screen.getByTestId('recipe-cook-button')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-add-to-list-button')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-add-to-planner-button')).toBeInTheDocument();

    await openOverflowMenu();
    expect(screen.getByTestId('recipe-ask-amend-menu-item')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-optimise-kitchen-menu-item')).toBeInTheDocument();
  });

  // The ranking, asserted as markup rather than trusted to the comment above it:
  // the three key actions are the only inline buttons, they are all filled, and
  // none of them is width-gated — so they are what the eye lands on at any width,
  // phone or desktop, and everything else is behind the ⋮ (#735).
  it('ranks Cook, Shop and Plan above the rest — the only inline actions, at every width', () => {
    renderPage();

    for (const id of [
      'recipe-cook-button',
      'recipe-add-to-list-button',
      'recipe-add-to-planner-button',
    ]) {
      const button = screen.getByTestId(id);
      expect(button).toHaveClass('salt-button--solid');
      expect(button.className).not.toContain('hidden');
    }

    // The demoted five have NO inline site left: one menu now serves every width,
    // so there is no second, divergent markup surface to keep in step.
    for (const id of [
      'recipe-ask-amend-button',
      'recipe-optimise-kitchen-button',
      'recipe-duplicate-button',
      'recipe-edit-button',
      'recipe-delete-button',
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    // And the trigger itself is never width-gated — Duplicate must be reachable
    // on a laptop, which is the whole reason the menu was promoted.
    expect(screen.getByTestId('recipe-actions-overflow').className).not.toContain('hidden');
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

  it('offers no Cook and no Shop', () => {
    renderPage();

    expect(screen.queryByTestId('recipe-cook-button')).toBeNull();
    expect(screen.queryByTestId('recipe-add-to-list-button')).toBeNull();
  });

  it('offers no Chat and no Optimise', async () => {
    renderPage();

    // Opened first, so the absences below are real and not just an unmounted menu.
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

  it('keeps Duplicate, Edit and Delete, so the ⋮ menu never opens onto nothing', async () => {
    renderPage();

    expect(screen.getByTestId('recipe-actions-overflow')).toBeInTheDocument();

    await openOverflowMenu();
    // Unconditional for every kind: what an entry IS never decides whether it can
    // be copied, edited or deleted.
    expect(screen.getByTestId('recipe-duplicate-menu-item')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-delete-menu-item')).toBeInTheDocument();
  });

  it('keeps the hero, its description and the Regenerate control', () => {
    renderPage();

    expect(screen.getByTestId('recipe-hero')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-image-regenerate')).toBeInTheDocument();
    expect(screen.getByText('Curry from the place on the corner.')).toBeInTheDocument();
  });

  it('keeps Plan — a night off is still a night that gets planned', () => {
    renderPage();

    // The outing's only key action, and it is inline: a phone showing a takeaway
    // gets one button and the ⋮, not an empty row.
    expect(screen.getByTestId('recipe-add-to-planner-button')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-add-to-planner-button').className).not.toContain('hidden');
  });
});

// "Plan" asks the same question the planner's own picker asks, so it answers with
// the same predicate — `isPlannable`, never the kind. A cocktail is cookable and
// shoppable but is not dinner, which makes it the case that pulls the two apart:
// everything else on the page stays, and only this goes.
describe('RecipeViewPage — a cocktail is not offered for a night', () => {
  beforeEach(() => {
    mockRecipes._set([makeEntry({ kind: 'cocktail', title: 'Negroni' })]);
  });

  it('offers no Plan, while keeping Cook and Shop', () => {
    renderPage();

    expect(screen.getByTestId('recipe-cook-button')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-add-to-list-button')).toBeInTheDocument();
    // Plan only ever renders inline, so this one absence covers every width.
    expect(screen.queryByTestId('recipe-add-to-planner-button')).toBeNull();
  });
});

// Duplicate (issue #735). The what-carries policy is `duplicateRecipe`'s and is
// pinned field-by-field in the domain suite; what belongs here is the wiring —
// that the action hands the copy to the EXISTING stash seam and routes to the
// blank-recipe editor, writing nothing.
describe('RecipeViewPage — duplicate', () => {
  async function duplicate(): Promise<void> {
    await openOverflowMenu();
    await fireEvent.click(screen.getByTestId('recipe-duplicate-menu-item'));
  }

  it('stashes an unsaved copy and opens the editor — nothing is persisted', async () => {
    mockRecipes._set([makeEntry()]);
    renderPage();

    await duplicate();

    expect(vi.mocked(stashImportedDraft)).toHaveBeenCalledTimes(1);
    const draft = vi.mocked(stashImportedDraft).mock.calls[0]![0];
    expect(draft.title).toBe('Test Recipe (copy)');
    expect(draft.id).not.toBe(RECIPE_ID);
    expect(draft.steps).toEqual(makeEntry().steps);
    expect(push).toHaveBeenCalledWith('/recipes/new');
    // The copy is a draft, not a document: no write of any kind on the way out.
    expect(persistRecipe).not.toHaveBeenCalled();
  });

  it.each(['recipe', 'outing', 'cocktail', 'placeholder'] as const)(
    'is offered for a %s, and the copy is the same kind',
    async (kind) => {
      mockRecipes._set([makeEntry({ kind })]);
      renderPage();

      await duplicate();

      expect(vi.mocked(stashImportedDraft).mock.calls[0]![0].kind).toBe(kind);
    },
  );
});
