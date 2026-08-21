import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import type { Recipe } from '@salt/domain';
import type { RecipeDoc } from '@salt/domain/schemas';
import type { ChatSessionDoc } from '@salt/domain/schemas';

// ⋮ → Refresh (issue #784): re-run the librarian over THIS dish with today's
// house writing rules, and show what it would change in the review gate a chat
// amendment already uses.
//
// `recipeAmend` is deliberately NOT mocked here. The propose/merge/apply seam is
// the thing under test at this level — that Refresh reaches the librarian with
// `refresh: true`, and that applying writes through the same one save — so the
// mocks stop at the librarian call (`authorRecipeTraced`) and the write
// (`saveRecipe`), exactly as the "save as new recipe" suite does.
//
// The load-bearing case is the NEGATIVE one: applying a refresh discards the
// guided plan, and applying a chat amendment must not. A refresh re-mints every
// step id, so the plan's `stepNotes` point at steps that no longer exist — the
// plan becomes silently WRONG rather than merely stale. A chat amendment goes
// through the same sheet and the same apply handler, so nothing but the pending
// proposal's provenance separates the two paths; one shared flag decides it, and
// a flag is exactly the kind of thing that leaks.

const {
  mockRecipes,
  mockCanonItems,
  mockGuidedPlan,
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
    mockIsLoading: makeStore<boolean>(false),
    mockDefaultListId: makeStore<string | null>('list-1'),
    mockSessions: makeStore<readonly ChatSessionDoc[]>([]),
    mockEquipment: makeStore<{ items: readonly { name: string }[] } | null>(null),
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
  discardGuidedPlan: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));
// #812: the page subscribes to the recipe's formula to decide whether to offer
// "Bake a batch" and a link to the formula screen. `null` is loaded-and-there-is-
// none, which is what every recipe in this file is — so neither entry appears and
// nothing else on the page changes.
vi.mock('../src/lib/formulaService.js', () => ({
  formula: {
    subscribe: (fn: (value: unknown) => void) => {
      fn(null);
      return () => {};
    },
  },
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
  // Identity — attribution (#845) has its own suite; this one is about the page.
  stampRecipeAttribution: <T>(recipe: T) => recipe,
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
import { authorRecipeTraced } from '../src/lib/recipeService.js';
import { discardGuidedPlan } from '../src/lib/guidedPlanService.js';
import { saveRecipe } from '@salt/firebase-sync';

const RECIPE_ID = 'pilaf';
const REFRESHED_TITLE = 'Chorizo & Red Pepper Pilaf, re-transcribed';

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: RECIPE_ID,
    schemaVersion: 1,
    kind: 'recipe',
    title: 'Chorizo & Red Pepper Pilaf',
    description: 'A one-pan supper.',
    ingredients: [],
    steps: [{ id: 'step-1', text: 'Fry the chorizo.', note: null, timer: null }],
    metadata: {
      servings: 4,
      prepTimeMinutes: 15,
      cookTimeMinutes: 30,
      totalTimeMinutes: 45,
      tags: ['midweek'],
    },
    source: { type: 'manual' },
    notes: null,
    componentRecipeIds: [],
    image: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Recipe;
}

// What the librarian hands back. The title moves so the diff has something to
// show, and the step id is FRESH — which is precisely why the guided plan cannot
// survive an applied refresh.
function librarianDraft(): RecipeDoc {
  return {
    id: 'draft-id',
    schemaVersion: 1,
    kind: 'recipe',
    title: REFRESHED_TITLE,
    description: 'A one-pan supper.',
    ingredients: [],
    steps: [
      {
        id: 'step-fresh',
        text: 'Fry the chorizo until the oil runs red.',
        note: null,
        timer: null,
      },
    ],
    metadata: {
      servings: null,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      totalTimeMinutes: null,
      tags: [],
    },
    source: { type: 'manual' },
    notes: null,
    componentRecipeIds: [],
    image: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as RecipeDoc;
}

function makeSession(messages: ChatSessionDoc['messages']): ChatSessionDoc {
  return {
    id: 'session-1',
    schemaVersion: 1,
    ownerUid: 'uid-1',
    recipeId: RECIPE_ID,
    title: 'Pilaf chat',
    messages,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
  } as ChatSessionDoc;
}

const CHAT_TURNS = [
  {
    id: 'm1',
    role: 'user' as const,
    text: 'add some chilli',
    createdAt: '2026-08-13T10:00:00.000Z',
  },
  {
    id: 'm2',
    role: 'assistant' as const,
    text: 'Half a teaspoon of chilli flakes, stirred in.',
    createdAt: '2026-08-13T10:00:01.000Z',
  },
];

/** A guided plan for this recipe, as the store would hold it. */
function makePlan() {
  return {
    id: RECIPE_ID,
    schemaVersion: 1,
    recipeId: RECIPE_ID,
    recipeUpdatedAtAtSave: '2026-01-01T00:00:00.000Z',
    prep: [],
    // The reference that a refresh breaks: it names a step id the refreshed
    // recipe will not have.
    stepNotes: [{ stepId: 'step-1', text: 'Get the pan properly hot first.' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveRecipe).mockResolvedValue({ kind: 'ok', value: undefined });
  vi.mocked(discardGuidedPlan).mockResolvedValue({ kind: 'ok', value: undefined });
  vi.mocked(authorRecipeTraced).mockResolvedValue({
    kind: 'ok',
    value: librarianDraft(),
  } as Awaited<ReturnType<typeof authorRecipeTraced>>);
  mockCanonItems._set([]);
  mockIsLoading._set(false);
  mockRecipes._set([makeRecipe()]);
  mockSessions._set([]);
  mockGuidedPlan._set(makePlan());
  mockEquipment._set({ items: [{ name: 'Sage Pizzaiolo' }] });
});

function renderPage() {
  return render(RecipeViewPage, { props: { params: { id: RECIPE_ID } } });
}

// Refresh lives in the ⋮ menu, which since #735 is its ONLY surface at any width.
// bits-ui renders PopoverContent lazily and portals it, so the menu has to be
// opened first and the items are reached through `screen`, not the container.
async function clickOverflowItem(testid: string): Promise<void> {
  await fireEvent.click(screen.getByTestId('recipe-actions-overflow'));
  await waitFor(() => expect(screen.getByTestId(testid)).toBeInTheDocument());
  await fireEvent.click(screen.getByTestId(testid));
}

/** ⋮ → Refresh, settled on the open review sheet. */
async function refreshAndReview(): Promise<void> {
  await clickOverflowItem('recipe-refresh-menu-item');
  await waitFor(() => expect(screen.getByTestId('recipe-change-summary')).toBeInTheDocument());
}

/** "Review changes" on the chat sidebar, settled on the same sheet. */
async function amendAndReview(): Promise<void> {
  await fireEvent.click(screen.getByTestId('sidebar-apply-changes-btn'));
  await waitFor(() => expect(screen.getByTestId('recipe-change-summary')).toBeInTheDocument());
}

describe('RecipeViewPage — Refresh proposes, and writes nothing until you say so', () => {
  it('asks the librarian to re-transcribe THIS dish and opens the review sheet', async () => {
    renderPage();

    await refreshAndReview();

    // No conversation, no chat session created — a refresh goes straight from the
    // menu item into the diff, because there is nothing to talk about.
    const input = vi.mocked(authorRecipeTraced).mock.calls[0]![0];
    expect(input).toMatchObject({ messages: [], recipeId: RECIPE_ID, refresh: true });
    // The proposal really is a proposal: the sheet is open and nothing is written.
    expect(screen.getByTestId('recipe-change-summary')).toBeInTheDocument();
    expect(saveRecipe).not.toHaveBeenCalled();
  });

  it('offers the tag vocabulary of the whole collection, not just this dish', async () => {
    // A refresh re-applies the house rules, and "prefer a tag the collection
    // already uses" is one of them — so the vocabulary has to come from every
    // recipe, exactly as the chat path builds it.
    mockRecipes._set([
      makeRecipe(),
      makeRecipe({ id: 'other', metadata: { ...makeRecipe().metadata, tags: ['sunday'] } }),
    ]);
    renderPage();

    await refreshAndReview();

    const input = vi.mocked(authorRecipeTraced).mock.calls[0]![0];
    expect([...input.existingTags].sort()).toEqual(['midweek', 'sunday']);
  });

  it('discarding leaves the recipe exactly as it was, and keeps the plan', async () => {
    renderPage();
    await refreshAndReview();

    await fireEvent.click(screen.getByTestId('recipe-change-discard'));

    await waitFor(() => expect(screen.queryByTestId('recipe-change-summary')).toBeNull());
    expect(saveRecipe).not.toHaveBeenCalled();
    // Nothing was applied, so there is no broken step reference to clean up —
    // throwing away the plan here would be a plain loss.
    expect(discardGuidedPlan).not.toHaveBeenCalled();
  });
});

describe('RecipeViewPage — applying a refresh takes the guided plan with it', () => {
  it('saves the re-transcribed recipe and discards the plan whose steps it invalidated', async () => {
    renderPage();
    await refreshAndReview();

    await fireEvent.click(screen.getByTestId('recipe-change-apply'));

    await waitFor(() => expect(saveRecipe).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(saveRecipe).mock.calls[0]![0];
    expect(saved.id).toBe(RECIPE_ID);
    expect(saved.title).toBe(REFRESHED_TITLE);
    // …and the plan goes, keyed on the recipe that was just written.
    await waitFor(() => expect(discardGuidedPlan).toHaveBeenCalledWith(RECIPE_ID));
  });

  it('keeps the plan when the save fails — the plan is only stale once the write lands', async () => {
    vi.mocked(saveRecipe).mockResolvedValue({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'offline' },
    } as Awaited<ReturnType<typeof saveRecipe>>);
    renderPage();
    await refreshAndReview();

    await fireEvent.click(screen.getByTestId('recipe-change-apply'));

    await waitFor(() => expect(saveRecipe).toHaveBeenCalledTimes(1));
    // The recipe still has its original step ids, so the plan still resolves.
    // Discarding it for a write that never happened would cost the user a
    // document for nothing.
    expect(discardGuidedPlan).not.toHaveBeenCalled();
  });

  // THE negative. Both paths open the same sheet and land on the same apply
  // handler, so only the pending proposal's provenance separates them — and a
  // chat amendment preserves step ids for every step it did not change, which is
  // exactly what keeps the plan's `stepNotes` pointing at real steps.
  it('does NOT discard the plan when the applied proposal came from the chat', async () => {
    mockSessions._set([makeSession(CHAT_TURNS)]);
    renderPage();

    await amendAndReview();
    await fireEvent.click(screen.getByTestId('recipe-change-apply'));

    await waitFor(() => expect(saveRecipe).toHaveBeenCalledTimes(1));
    // The librarian was asked to read the conversation, not the document.
    expect(vi.mocked(authorRecipeTraced).mock.calls[0]![0].refresh).toBeUndefined();
    expect(discardGuidedPlan).not.toHaveBeenCalled();
  });

  it('does not inherit the flag from a refresh that was discarded first', async () => {
    // The flag is page state shared by one sheet, so the sequence that would
    // catch a missing reset is refresh → discard → chat amend → apply.
    mockSessions._set([makeSession(CHAT_TURNS)]);
    renderPage();

    await refreshAndReview();
    await fireEvent.click(screen.getByTestId('recipe-change-discard'));
    await waitFor(() => expect(screen.queryByTestId('recipe-change-summary')).toBeNull());

    await amendAndReview();
    await fireEvent.click(screen.getByTestId('recipe-change-apply'));

    await waitFor(() => expect(saveRecipe).toHaveBeenCalledTimes(1));
    expect(discardGuidedPlan).not.toHaveBeenCalled();
  });
});

// Refresh is gated on `isAuthorable` — "can the librarian WRITE this kind?" —
// the same predicate "Make a variation" uses, and never on the kind directly. An
// outing has no ingredients and no method to re-transcribe; a placeholder is a
// photograph of a good dinner and not a dish at all. A cocktail is cookable and
// still not authorable, which is the case that proves the gate is the predicate
// rather than a hand-written list of the two obvious kinds.
describe('RecipeViewPage — Refresh is offered only where the librarian can write', () => {
  it.each([
    ['recipe', true],
    ['cocktail', false],
    ['outing', false],
    ['placeholder', false],
  ] as const)('is offered for a %s: %s', async (kind, offered) => {
    mockRecipes._set([makeRecipe({ kind })]);
    renderPage();

    await fireEvent.click(screen.getByTestId('recipe-actions-overflow'));
    // Edit is unconditional, so it is the reliable signal that the menu really
    // mounted — an assertion about what is MISSING would otherwise pass against a
    // menu that never opened.
    await waitFor(() => expect(screen.getByTestId('recipe-edit-menu-item')).toBeInTheDocument());

    if (offered) {
      expect(screen.getByTestId('recipe-refresh-menu-item')).toBeInTheDocument();
    } else {
      expect(screen.queryByTestId('recipe-refresh-menu-item')).toBeNull();
    }
  });
});
