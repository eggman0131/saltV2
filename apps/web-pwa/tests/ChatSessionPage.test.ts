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
    basedOnRecipeId: null,
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

// "Save as new recipe" (issue #798): the counterpart on a chat that is ATTACHED
// to a dish. The pair either side of it is the point — "Review changes" folds the
// conversation into this dish, this makes it a different one — so what these
// tests pin is the two things that keep them apart: create mode with no base, and
// no claim.
describe('ChatSessionPage — save as NEW recipe', () => {
  it('is offered on an attached chat, and the general-chat save is not', () => {
    mockSessions._set([makeSession({ recipeId: 'lamb' })]);
    const { getByTestId, queryByTestId } = renderPage();

    expect(getByTestId('chat-save-new-recipe-btn')).toBeInTheDocument();
    // The two are counterparts, never both: one is for a chat with no dish, the
    // other for a chat with one.
    expect(queryByTestId('chat-save-recipe-btn')).toBeNull();
    // …and it sits beside the review gate, which is untouched.
    expect(getByTestId('chat-apply-changes-btn')).toBeInTheDocument();
  });

  it('is not offered on a general chat', () => {
    mockSessions._set([makeSession({ recipeId: null })]);
    const { queryByTestId } = renderPage();

    expect(queryByTestId('chat-save-new-recipe-btn')).toBeNull();
  });

  it('waits for the chef to have replied — an empty conversation has nothing to author', () => {
    mockSessions._set([
      makeSession({
        recipeId: 'lamb',
        messages: [
          { id: 'm1', role: 'user', text: 'hello', createdAt: '2026-01-01T00:00:00.000Z' },
        ],
      }),
    ]);
    const { queryByTestId } = renderPage();

    expect(queryByTestId('chat-save-new-recipe-btn')).toBeNull();
  });

  it('authors in create mode with no base, and leaves the conversation on the dish it came from', async () => {
    // The load-bearing pair. `basedOnRecipeId` would put the librarian in
    // variation mode and carry the lamb's ingredients into the salad;
    // `claimRecipe` would move this conversation off the lamb's chat card.
    mockSessions._set([makeSession({ recipeId: 'lamb', basedOnRecipeId: 'older-dish' })]);
    vi.mocked(authorRecipeTraced).mockResolvedValue({
      kind: 'ok',
      value: { id: 'salad', kind: 'recipe', metadata: { tags: [] } },
    } as Awaited<ReturnType<typeof authorRecipeTraced>>);
    const { getByTestId } = renderPage();

    await fireEvent.click(getByTestId('chat-save-new-recipe-btn'));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/recipes/salad'));
    const input = vi.mocked(authorRecipeTraced).mock.calls[0]![0];
    expect(input.recipeId).toBeUndefined();
    // `null` even though the session HAS a base — an accompaniment is not a variation.
    expect(input.basedOnRecipeId).toBeNull();
    expect(claimRecipe).not.toHaveBeenCalled();
  });
});

// A variation chat (issue #763): started from a dish it is not attached to. Two
// things carry the journey on this page — the chip that says which dish, and the
// base id reaching the librarian so the new recipe carries forward everything the
// conversation never mentioned.
describe('ChatSessionPage — a variation chat', () => {
  function pilaf(): Recipe {
    return { id: 'pilaf', title: 'Chorizo & Red Pepper Pilaf', metadata: { tags: [] } } as Recipe;
  }

  it('shows the Based on chip, and taps through to the dish it started from', async () => {
    mockRecipes._set([pilaf()]);
    mockSessions._set([makeSession({ basedOnRecipeId: 'pilaf' })]);
    const { getByTestId } = renderPage();

    const chip = getByTestId('chat-based-on-chip');
    expect(chip.textContent).toContain('Based on: Chorizo & Red Pepper Pilaf');

    await fireEvent.click(chip);
    expect(push).toHaveBeenCalledWith('/recipes/pilaf');
  });

  it('shows no chip on an ordinary chat', () => {
    mockRecipes._set([pilaf()]);
    mockSessions._set([makeSession()]);
    const { queryByTestId } = renderPage();

    expect(queryByTestId('chat-based-on-chip')).toBeNull();
  });

  it('drops the chip when the base recipe has been deleted, and still offers Save', () => {
    // Rule 10 on the client side: the base going away degrades the variation to
    // an ordinary chat rather than breaking the page or blocking the save.
    mockRecipes._set([]);
    mockSessions._set([makeSession({ basedOnRecipeId: 'pilaf' })]);
    const { queryByTestId, getByTestId } = renderPage();

    expect(queryByTestId('chat-based-on-chip')).toBeNull();
    expect(getByTestId('chat-save-recipe-btn')).toBeInTheDocument();
  });

  it('grounds the librarian on the base without handing it a recipe to edit', async () => {
    // `basedOnRecipeId` set, `recipeId` NOT — which is what keeps this on the
    // create path: a new dish with its own name, its own hero and no "makes"
    // link, and the original left untouched.
    mockRecipes._set([pilaf()]);
    mockSessions._set([makeSession({ basedOnRecipeId: 'pilaf' })]);
    vi.mocked(authorRecipeTraced).mockResolvedValue({
      kind: 'ok',
      value: { id: 'recipe-new', kind: 'recipe', metadata: { tags: [] } },
    } as Awaited<ReturnType<typeof authorRecipeTraced>>);
    const { getByTestId } = renderPage();

    await fireEvent.click(getByTestId('chat-save-recipe-btn'));

    await waitFor(() => expect(authorRecipeTraced).toHaveBeenCalled());
    const input = vi.mocked(authorRecipeTraced).mock.calls[0]![0];
    expect(input.basedOnRecipeId).toBe('pilaf');
    expect(input.recipeId).toBeUndefined();
    // The conversation ends up on the NEW dish, not the one it started from.
    await waitFor(() => expect(claimRecipe).toHaveBeenCalledWith('session-1', 'recipe-new'));
  });
});
