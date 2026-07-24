import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CookSessionDoc, PushSubscriptionDoc } from '@salt/domain/schemas';

// Unit-level (mock-based, no emulator) coverage of the cook-timer DISPATCH handler
// (issue #544): re-read the live session, no-op stale/duplicate dispatches via the
// exactly-once ledger, then send an ids-only push to each owner subscription,
// pruning the dead and reporting the failed. CookSessionSchema and
// PushSubscriptionSchema are kept REAL.

vi.mock('firebase-functions/v2/tasks', () => ({
  onTaskDispatched: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: () => 'test-vapid-private' }),
}));

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockSendWebPush = vi.fn(async () => 'sent' as const);
vi.mock('../../src/adapters/sendWebPush.js', () => ({
  sendWebPush: mockSendWebPush,
}));

const mockReport = vi.fn();
const mockFlush = vi.fn().mockResolvedValue(undefined);
vi.mock('@salt/observability/server', () => ({
  flushServerObservability: mockFlush,
  createServerObservabilityErrorReportingAdapter: vi.fn(() => ({ report: mockReport })),
}));

// Collection-aware Firestore mock. State is mock-prefixed so the hoisted vi.mock
// factory may reference it. Each test sets the snapshots/docs it needs.
let mockCookSessionSnap: { exists: boolean; data: () => unknown } = {
  exists: false,
  data: () => undefined,
};
let mockLedgerSnap: { exists: boolean } = { exists: false };
let mockSubsDocs: Array<{ data: () => unknown; ref: { delete: () => Promise<void> } }> = [];
const mockTxSet = vi.fn();

const mockDb = {
  collection: (name: string) => {
    if (name === 'cookSessions') {
      return { doc: () => ({ get: async () => mockCookSessionSnap }) };
    }
    if (name === 'timerDeliveries') {
      return { doc: () => ({ id: 'ledger-ref' }) };
    }
    if (name === 'pushSubscriptions') {
      return { where: () => ({ get: async () => ({ docs: mockSubsDocs }) }) };
    }
    return { doc: () => ({}) };
  },
  runTransaction: async (fn: (tx: unknown) => Promise<void>) =>
    fn({ get: async () => mockLedgerSnap, set: mockTxSet }),
};
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => mockDb,
}));

const { onCookTimerDispatch } = await import('../../src/triggers/onCookTimerDispatch.js');

const STEP_ID = 'step-1';
const ENDS_AT = '2026-07-24T10:00:00.000Z';
const SESSION_ID = 'recipe-1_uid-1';

function makeSession(overrides: Partial<CookSessionDoc> = {}): CookSessionDoc {
  return {
    id: SESSION_ID,
    schemaVersion: 1,
    ownerUid: 'uid-1',
    recipeId: 'recipe-1',
    recipeUpdatedAtAtStart: '2026-07-24T09:00:00.000Z',
    checkedIngredientIds: [],
    completedStepIds: [],
    activeTimers: [{ stepId: STEP_ID, endsAt: ENDS_AT, notify: true }],
    createdAt: '2026-07-24T09:00:00.000Z',
    updatedAt: '2026-07-24T10:00:00.000Z',
    ...overrides,
  };
}

function makeSub(id: string): PushSubscriptionDoc {
  return {
    id,
    schemaVersion: 1,
    ownerUid: 'uid-1',
    endpoint: `https://push.example/${id}`,
    keys: { p256dh: `p256-${id}`, auth: `auth-${id}` },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function subDoc(sub: PushSubscriptionDoc) {
  return { data: () => sub, ref: { delete: vi.fn(async () => undefined) } };
}

function req() {
  return { data: { sessionId: SESSION_ID, stepId: STEP_ID, endsAt: ENDS_AT } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCookSessionSnap = { exists: false, data: () => undefined };
  mockLedgerSnap = { exists: false };
  mockSubsDocs = [];
  mockSendWebPush.mockResolvedValue('sent' as const);
  process.env['VAPID_PUBLIC_KEY'] = 'test-vapid-public';
  process.env['VAPID_SUBJECT'] = 'mailto:test@salt.app';
});

describe('onCookTimerDispatch', () => {
  it('no-ops when the session is absent', async () => {
    mockCookSessionSnap = { exists: false, data: () => undefined };

    await (onCookTimerDispatch as unknown as Function)(req());

    expect(mockSendWebPush).not.toHaveBeenCalled();
  });

  it('no-ops when the timer is no longer present (removed/extended)', async () => {
    // Session exists but its timer was removed (activeTimers empty).
    mockCookSessionSnap = { exists: true, data: () => makeSession({ activeTimers: [] }) };
    mockSubsDocs = [subDoc(makeSub('dev-1'))];

    await (onCookTimerDispatch as unknown as Function)(req());

    expect(mockSendWebPush).not.toHaveBeenCalled();
  });

  it('no-ops on duplicate delivery (ledger doc already exists)', async () => {
    mockCookSessionSnap = { exists: true, data: () => makeSession() };
    mockLedgerSnap = { exists: true }; // already delivered
    mockSubsDocs = [subDoc(makeSub('dev-1'))];

    await (onCookTimerDispatch as unknown as Function)(req());

    expect(mockSendWebPush).not.toHaveBeenCalled();
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it('sends an ids-only payload to each of the owner subscriptions', async () => {
    mockCookSessionSnap = { exists: true, data: () => makeSession() };
    mockSubsDocs = [subDoc(makeSub('dev-1')), subDoc(makeSub('dev-2'))];

    await (onCookTimerDispatch as unknown as Function)(req());

    expect(mockTxSet).toHaveBeenCalledTimes(1); // ledger claimed
    expect(mockSendWebPush).toHaveBeenCalledTimes(2);

    // Payload is ids + generic copy ONLY. The exact-equality assertion proves no
    // recipe/step free-text leaked: the only ids present are the session id (which
    // by design embeds the recipe id) and generic, timer-agnostic copy — the step
    // id, recipe title, and step text never appear.
    const payload = mockSendWebPush.mock.calls[0]![2] as Record<string, unknown>;
    expect(payload).toEqual({
      type: 'cook-timer',
      tag: `cook::${SESSION_ID}`,
      sessionId: SESSION_ID,
      title: 'Timer finished',
      body: 'A cook timer just finished.',
    });
    expect(JSON.stringify(payload)).not.toContain(STEP_ID);
  });

  it('prunes a subscription that returns gone', async () => {
    mockCookSessionSnap = { exists: true, data: () => makeSession() };
    const doc = subDoc(makeSub('dev-dead'));
    mockSubsDocs = [doc];
    mockSendWebPush.mockResolvedValue('gone' as const);

    await (onCookTimerDispatch as unknown as Function)(req());

    expect(doc.ref.delete).toHaveBeenCalledTimes(1);
  });

  it('reports (does not throw) when sendWebPush returns failed', async () => {
    mockCookSessionSnap = { exists: true, data: () => makeSession() };
    const doc = subDoc(makeSub('dev-1'));
    mockSubsDocs = [doc];
    mockSendWebPush.mockResolvedValue('failed' as const);

    await expect((onCookTimerDispatch as unknown as Function)(req())).resolves.toBeUndefined();

    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(doc.ref.delete).not.toHaveBeenCalled();
  });
});
