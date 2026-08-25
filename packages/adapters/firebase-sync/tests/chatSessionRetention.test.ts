import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatSessionDoc } from '@salt/domain/schemas';

// Retention (issues #696, #939). Every chat is written with a finite `expiresAt`
// and the length is the whole of the policy: a fortnight for a general kitchen
// chat, eighteen months for one attached to a recipe. The longer window is #696 —
// the recipe page lists every conversation about a dish, and a fortnightly sweep
// would empty that list for the recipes you have lived with longest — sized in
// #939 to survive a dish cooked once a year.
//
// What #939 removed was the `9999-12-31` sentinel that window replaced. A chat
// claims its recipe as soon as it produces one, so "never" was the majority case
// and the collection had no bound at all. THE ASSERTION BELOW IS THAT THE WINDOW
// IS FINITE as much as that it is long: a test that only checked "later than a
// fortnight" would pass on the sentinel again.
//
// None of this is enforced yet — `expiresAt` is an ISO string and a Firestore TTL
// policy only acts on a `Timestamp`. See the constants in the source.

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

const DAY_MS = 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * DAY_MS;
const EIGHTEEN_MONTHS_MS = 540 * DAY_MS;

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

// The two windows, and the fact that each is bounded at BOTH ends. The upper
// bound is what the sentinel would fail (UT-D1: one table, two rows, each naming
// itself).
const WINDOWS = [
  { name: 'a general kitchen chat', recipeId: null, ttlMs: FOURTEEN_DAYS_MS },
  { name: 'a chat attached to a recipe', recipeId: 'recipe-1', ttlMs: EIGHTEEN_MONTHS_MS },
] as const;

describe('saveChatSession — expiry', () => {
  it.each(WINDOWS)('$name expires $ttlMs ms from the write', async ({ recipeId, ttlMs }) => {
    const before = Date.now();
    const result = await saveChatSession(makeSession({ recipeId }));
    const after = Date.now();

    expect(result.kind).toBe('ok');
    const expiry = new Date(writtenDoc().expiresAt).getTime();
    expect(expiry).toBeGreaterThanOrEqual(before + ttlMs);
    expect(expiry).toBeLessThanOrEqual(after + ttlMs);
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
