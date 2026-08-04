import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatSessionDoc } from '@salt/domain/schemas';

// Retention (issue #696). A chat attached to a recipe has the same lifetime as
// the recipe, so it is written with a far-future `expiresAt` and the per-project
// TTL policy — which stays exactly as configured — never sweeps it. General
// kitchen chats keep tidying themselves away after a fortnight.

const { mockSetDoc, mockDoc, mockGetFirestore } = vi.hoisted(() => ({
  mockSetDoc: vi.fn().mockResolvedValue(undefined),
  mockDoc: vi.fn(() => 'mock-doc-ref'),
  mockGetFirestore: vi.fn(() => 'mock-db'),
}));

vi.mock('firebase/app', () => ({ getApp: vi.fn(() => ({})) }));

vi.mock('firebase/firestore', () => ({
  getFirestore: mockGetFirestore,
  collection: vi.fn(() => 'mock-collection-ref'),
  doc: mockDoc,
  onSnapshot: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  setDoc: mockSetDoc,
  deleteDoc: vi.fn(),
  getDoc: vi.fn(),
}));

import { saveChatSession } from '../src/chatSessionSubscription.js';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

function makeSession(overrides: Partial<ChatSessionDoc> = {}): ChatSessionDoc {
  return {
    id: 'session-1',
    schemaVersion: 1,
    ownerUid: 'uid-1',
    recipeId: null,
    title: 'New chat',
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function writtenDoc(): ChatSessionDoc {
  return mockSetDoc.mock.calls[0]![1] as ChatSessionDoc;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
});

describe('saveChatSession — expiry', () => {
  it('keeps a recipe-attached chat for good', async () => {
    const result = await saveChatSession(makeSession({ recipeId: 'recipe-1' }));

    expect(result.kind).toBe('ok');
    // Far enough away that no plausible sweep reaches it, and a value a human
    // reading the document recognises as "never" rather than as a date.
    expect(new Date(writtenDoc().expiresAt).getUTCFullYear()).toBe(9999);
  });

  it('still sweeps a general chat after a fortnight', async () => {
    const before = Date.now();
    await saveChatSession(makeSession({ recipeId: null }));
    const after = Date.now();

    const expiry = new Date(writtenDoc().expiresAt).getTime();
    expect(expiry).toBeGreaterThanOrEqual(before + FOURTEEN_DAYS_MS);
    expect(expiry).toBeLessThanOrEqual(after + FOURTEEN_DAYS_MS);
  });

  it('overwrites whatever expiry the caller passed in', async () => {
    // The caller's `expiresAt` is never authoritative — the adapter owns it, which
    // is what lets a general chat that later claims a recipe stop expiring.
    await saveChatSession(
      makeSession({ recipeId: 'recipe-1', expiresAt: '2026-01-02T00:00:00.000Z' }),
    );

    expect(writtenDoc().expiresAt).not.toBe('2026-01-02T00:00:00.000Z');
  });

  it('returns a Failure rather than throwing when the write fails', async () => {
    mockSetDoc.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'unavailable' }));

    const result = await saveChatSession(makeSession());

    expect(result.kind).toBe('err');
  });
});
