import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import type { ChatSessionDoc } from '@salt/domain/schemas';
import type { Recipe } from '@salt/domain';

// Back goes where you came from, and "Save as recipe" leaves the conversation
// attached to the dish it produced (issue #696).

const { mockSessions, mockIsLoading, mockRecipes } = vi.hoisted(() => {
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
    mockSessions: makeStore<readonly ChatSessionDoc[]>([]),
    mockIsLoading: makeStore<boolean>(false),
    mockRecipes: makeStore<readonly Recipe[]>([]),
  };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn(), pop: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('@salt/observability', () => ({ trackUsageEvent: vi.fn() }));
vi.mock('@salt/firebase-sync', () => ({
  saveRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));
vi.mock('../src/lib/chatService.js', () => ({
  sessions: mockSessions,
  isLoadingSessions: mockIsLoading,
  sendMessage: vi.fn(),
  claimRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
  authorRecipeTraced: vi.fn(),
}));

import ChatSessionPage from '../src/routes/chat/ChatSessionPage.svelte';
import { claimRecipe } from '../src/lib/chatService.js';
import { authorRecipeTraced } from '../src/lib/recipeService.js';
import { push } from 'svelte-spa-router';

function makeSession(overrides: Partial<ChatSessionDoc> = {}): ChatSessionDoc {
  return {
    id: 'session-1',
    schemaVersion: 1,
    ownerUid: 'uid-1',
    recipeId: null,
    title: 'New chat',
    messages: [
      { id: 'm1', role: 'user', text: 'hello', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'm2', role: 'assistant', text: 'hi', createdAt: '2026-01-01T00:00:01.000Z' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-15T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockIsLoading._set(false);
  mockRecipes._set([]);
  // No in-app history behind the current entry, so `goBack` takes its fallback
  // route (what these tests assert). See src/lib/nav.ts.
  window.history.replaceState(null, '', '#/');
});

function renderPage(id = 'session-1') {
  return render(ChatSessionPage, { props: { params: { id } } });
}

describe('ChatSessionPage — where back goes', () => {
  it('falls back to the recipe when the chat belongs to one', async () => {
    mockSessions._set([makeSession({ recipeId: 'recipe-1' })]);
    const { getByRole } = renderPage();

    await fireEvent.click(getByRole('button', { name: 'Back' }));

    expect(push).toHaveBeenCalledWith('/recipes/recipe-1');
  });

  it('falls back to the chat list for a general chat', async () => {
    mockSessions._set([makeSession({ recipeId: null })]);
    const { getByRole } = renderPage();

    await fireEvent.click(getByRole('button', { name: 'Back' }));

    expect(push).toHaveBeenCalledWith('/chat');
  });
});

describe('ChatSessionPage — save as recipe', () => {
  it('leaves the conversation attached to the recipe it produced', async () => {
    mockSessions._set([makeSession({ recipeId: null })]);
    vi.mocked(authorRecipeTraced).mockResolvedValue({
      kind: 'ok',
      value: { id: 'recipe-new', kind: 'recipe', metadata: { tags: [] } },
    } as Awaited<ReturnType<typeof authorRecipeTraced>>);
    const { getByTestId } = renderPage();

    await fireEvent.click(getByTestId('chat-save-recipe-btn'));

    await waitFor(() => expect(claimRecipe).toHaveBeenCalledWith('session-1', 'recipe-new'));
    expect(push).toHaveBeenCalledWith('/recipes/recipe-new');
  });

  it('does not claim when the recipe never saved', async () => {
    mockSessions._set([makeSession({ recipeId: null })]);
    vi.mocked(authorRecipeTraced).mockResolvedValue({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'offline' },
    } as Awaited<ReturnType<typeof authorRecipeTraced>>);
    const { getByTestId } = renderPage();

    await fireEvent.click(getByTestId('chat-save-recipe-btn'));

    await waitFor(() => expect(authorRecipeTraced).toHaveBeenCalled());
    expect(claimRecipe).not.toHaveBeenCalled();
  });
});
