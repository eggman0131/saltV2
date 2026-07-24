import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import type { Recipe } from '@salt/domain';
import type { ChatSessionDoc } from '@salt/domain/schemas';

// "Optimise for my kitchen": a canned USER turn, not a new capability. The button
// drops a well-written prompt into the recipe's chat and everything downstream —
// the streamed reply, "Review changes", the diff — behaves exactly as it does for
// a hand-typed request. These tests cover what is genuinely new: the gate on an
// empty manifest, the no-session bootstrap, and the content contract of the prompt.

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
    mockSessions: makeStore<readonly ChatSessionDoc[]>([]),
    mockEquipment: makeStore<{ items: readonly { name: string }[] } | null>(null),
  };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/auth.svelte.js', () => ({
  auth: { user: { uid: 'uid-1', email: 'cook@test' } },
}));
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
import { createChatSession, sendMessage } from '../src/lib/chatService.js';

const RECIPE_ID = 'recipe-1';

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: RECIPE_ID,
    schemaVersion: 1,
    title: 'Test Recipe',
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
    image: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Recipe;
}

function makeSession(overrides: Partial<ChatSessionDoc> = {}): ChatSessionDoc {
  return {
    id: 'session-1',
    schemaVersion: 1,
    ownerUid: 'uid-1',
    recipeId: RECIPE_ID,
    title: 'Recipe chat',
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-15T00:00:00.000Z',
    ...overrides,
  } as ChatSessionDoc;
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
  mockRecipes._set([makeRecipe()]);
  mockSessions._set([]);
  mockEquipment._set({ items: [{ name: 'Sage Pizzaiolo' }] });
  vi.mocked(sendMessage).mockResolvedValue({ kind: 'ok', value: makeSession() });
});

function renderPage() {
  return render(RecipeViewPage, { props: { params: { id: RECIPE_ID } } });
}

describe('RecipeViewPage — optimise for my kitchen', () => {
  it('is hidden when the household owns no equipment', () => {
    // With an empty manifest the server injects no kit section, so the prompt would
    // ask the chef to re-work the method around nothing.
    mockEquipment._set({ items: [] });
    const { queryByTestId } = renderPage();

    expect(queryByTestId('recipe-optimise-kitchen-button')).toBeNull();
    expect(queryByTestId('recipe-optimise-kitchen-menu-item')).toBeNull();
  });

  it('sends the canned prompt as an ordinary user turn on the existing session', async () => {
    const session = makeSession();
    mockSessions._set([session]);
    const { getByTestId } = renderPage();

    await fireEvent.click(getByTestId('recipe-optimise-kitchen-button'));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    // Straight through sendMessage — no new callable, no special handling.
    expect(vi.mocked(sendMessage).mock.calls[0]![0]).toMatchObject({ id: session.id });
    expect(createChatSession).not.toHaveBeenCalled();
  });

  it('bootstraps a session and sends on the object createChatSession returned', async () => {
    // `activeSession` is $derived off the sessions store, which has not repopulated
    // by the time the send fires — the returned session is the only usable handle.
    const created = makeSession({ id: 'session-new' });
    vi.mocked(createChatSession).mockResolvedValue({ kind: 'ok', value: created });
    const { getByTestId } = renderPage();

    await fireEvent.click(getByTestId('recipe-optimise-kitchen-button'));

    await waitFor(() => expect(createChatSession).toHaveBeenCalledWith('uid-1', RECIPE_ID));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(vi.mocked(sendMessage).mock.calls[0]![0]).toMatchObject({ id: 'session-new' });
  });

  it('reveals the chat column so the turn streams somewhere visible', async () => {
    mockSessions._set([makeSession()]);
    const { getByTestId } = renderPage();

    expect(getByTestId('recipe-chat-sidebar').className).toContain('hidden');
    await fireEvent.click(getByTestId('recipe-optimise-kitchen-button'));

    await waitFor(() => expect(getByTestId('recipe-chat-sidebar').className).toContain('flex'));
    expect(getByTestId('recipe-chat-sidebar').className).not.toContain('hidden');
  });

  it('asks for a method-only rewrite, timings that move with it, and proportionality', async () => {
    mockSessions._set([makeSession()]);
    const { getByTestId } = renderPage();

    await fireEvent.click(getByTestId('recipe-optimise-kitchen-button'));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    const prompt = vi.mocked(sendMessage).mock.calls[0]![1];
    // Ingredients held: an ingredient rewrite would put every ingredient back
    // through canon matching for nothing.
    expect(prompt).toMatch(/method only/i);
    expect(prompt).toMatch(/ingredients/i);
    expect(prompt).toMatch(/servings/i);
    // Timings and temperatures have to move with the method.
    expect(prompt).toMatch(/timings and temperatures/i);
    // Leaving a step alone is a valid outcome.
    expect(prompt).toMatch(/proportionate/i);
    // A readable account of the change, before the diff.
    expect(prompt).toMatch(/what you changed and why/i);
    // The household's manifest is injected server-side — never hardcode kit here.
    expect(prompt).not.toMatch(/pizzaiolo|anova|magimix|kuhn rikon/i);
  });

  it('leaves the composer untouched — the canned prompt never lands in the input box', async () => {
    mockSessions._set([makeSession()]);
    vi.mocked(sendMessage).mockResolvedValue({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'transient' },
    } as Awaited<ReturnType<typeof sendMessage>>);
    const { getByTestId, getByPlaceholderText } = renderPage();

    await fireEvent.click(getByTestId('recipe-optimise-kitchen-button'));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    // Even on failure: the composer restores hand-typed text, not a canned paragraph.
    await waitFor(() =>
      expect((getByPlaceholderText('Message the chef…') as HTMLTextAreaElement).value).toBe(''),
    );
  });
});
