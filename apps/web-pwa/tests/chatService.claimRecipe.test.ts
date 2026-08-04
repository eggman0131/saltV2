import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import { get } from 'svelte/store';
import type { ChatSessionDoc } from '@salt/domain/schemas';

// The origin chat claims the recipe it produced (issue #696), and a chat started
// from a recipe is named after the dish. Both are one-line writes whose VALUE is
// entirely in when they do and do not happen.

vi.mock('@salt/observability', () => ({
  trackUsageEvent: vi.fn(),
  createObservabilityErrorReportingAdapter: vi.fn(() => ({ report: vi.fn() })),
  isReportableCategory: vi.fn(() => false),
}));

vi.mock('@salt/firebase-sync', () => ({
  subscribeChatSessions: vi.fn(() => vi.fn()),
  saveChatSession: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  deleteChatSession: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  streamChefChat: vi.fn(),
  callGenerateChatTitle: vi.fn().mockResolvedValue({ kind: 'ok', value: '' }),
}));

import * as firebaseSync from '@salt/firebase-sync';
import { claimRecipe, createChatSession, sessions } from '../src/lib/chatService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

function saved(): ChatSessionDoc[] {
  return fs.saveChatSession.mock.calls.map((c) => c[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  fs.saveChatSession.mockResolvedValue({ kind: 'ok', value: undefined });
});

describe('createChatSession — seed title', () => {
  it('names a recipe chat after the dish', async () => {
    const result = await createChatSession('uid-1', 'recipe-1', 'Cauliflower Steaks');

    expect(result.kind).toBe('ok');
    expect(saved()[0]!.title).toBe('Cauliflower Steaks chat');
  });

  it('falls back to the old wording when no title is to hand', async () => {
    await createChatSession('uid-1', 'recipe-1');

    expect(saved()[0]!.title).toBe('Recipe chat');
  });

  it('leaves a general chat alone', async () => {
    await createChatSession('uid-1', null, 'Cauliflower Steaks');

    expect(saved()[0]!.title).toBe('New chat');
    expect(saved()[0]!.recipeId).toBeNull();
  });
});

describe('claimRecipe', () => {
  it('attaches a general chat to the recipe it produced', async () => {
    const created = await createChatSession('uid-1', null);
    expect(created.kind).toBe('ok');
    const id = created.kind === 'ok' ? created.value.id : '';
    fs.saveChatSession.mockClear();

    const result = await claimRecipe(id, 'recipe-1');

    expect(result.kind).toBe('ok');
    expect(saved()[0]!.recipeId).toBe('recipe-1');
    expect(get(sessions).find((s) => s.id === id)!.recipeId).toBe('recipe-1');
  });

  it('never moves a link that already exists — first claim wins', async () => {
    const created = await createChatSession('uid-1', 'recipe-1', 'Cauliflower Steaks');
    const id = created.kind === 'ok' ? created.value.id : '';
    fs.saveChatSession.mockClear();

    const result = await claimRecipe(id, 'recipe-2');

    expect(result.kind).toBe('ok');
    expect(fs.saveChatSession).not.toHaveBeenCalled();
    expect(get(sessions).find((s) => s.id === id)!.recipeId).toBe('recipe-1');
  });

  it('is a no-op for a session the store has never seen', async () => {
    fs.saveChatSession.mockClear();

    const result = await claimRecipe('ghost', 'recipe-1');

    expect(result.kind).toBe('ok');
    expect(fs.saveChatSession).not.toHaveBeenCalled();
  });
});
