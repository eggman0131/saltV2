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

// Pushover is the second, independent sink (issue #680). The transport and the
// uid→member→devices resolution are covered by their own suites; here we care
// only that the handler reacts correctly to each resolution outcome.
const mockSendPushover = vi.fn(async () => 'sent' as const);
vi.mock('../../src/adapters/sendPushover.js', () => ({
  sendPushover: mockSendPushover,
}));

const mockResolveTargets = vi.fn();
vi.mock('../../src/adapters/pushoverRecipient.js', () => ({
  resolvePushoverTargets: mockResolveTargets,
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
  mockSendPushover.mockResolvedValue('sent' as const);
  mockResolveTargets.mockResolvedValue({ kind: 'send', devices: ['daniel-phone'] });
  // VAPID keys and the Pushover credentials are provided via the mocked
  // defineSecret (.value() → a test string), so the handler treats both sinks as
  // provisioned.
});

describe('onCookTimerDispatch', () => {
  it('no-ops when the session is absent', async () => {
    mockCookSessionSnap = { exists: false, data: () => undefined };

    await (onCookTimerDispatch as unknown as Function)(req());

    expect(mockSendWebPush).not.toHaveBeenCalled();
    expect(mockSendPushover).not.toHaveBeenCalled();
  });

  it('no-ops when the timer is no longer present (removed/extended)', async () => {
    // Session exists but its timer was removed (activeTimers empty).
    mockCookSessionSnap = { exists: true, data: () => makeSession({ activeTimers: [] }) };
    mockSubsDocs = [subDoc(makeSub('dev-1'))];

    await (onCookTimerDispatch as unknown as Function)(req());

    expect(mockSendWebPush).not.toHaveBeenCalled();
    expect(mockSendPushover).not.toHaveBeenCalled();
  });

  it('no-ops on duplicate delivery (ledger doc already exists)', async () => {
    mockCookSessionSnap = { exists: true, data: () => makeSession() };
    mockLedgerSnap = { exists: true }; // already delivered
    mockSubsDocs = [subDoc(makeSub('dev-1'))];

    await (onCookTimerDispatch as unknown as Function)(req());

    expect(mockSendWebPush).not.toHaveBeenCalled();
    expect(mockSendPushover).not.toHaveBeenCalled();
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

// The Pushover sink (issue #680). It ships ALONGSIDE web push for the rollout,
// so the two are independent: neither may suppress or break the other.
describe('onCookTimerDispatch — Pushover sink', () => {
  beforeEach(() => {
    mockCookSessionSnap = { exists: true, data: () => makeSession() };
  });

  it('sends to the resolved devices with generic copy only', async () => {
    mockResolveTargets.mockResolvedValue({
      kind: 'send',
      devices: ['daniel-phone', 'daniel-tablet'],
    });

    await (onCookTimerDispatch as unknown as Function)(req());

    expect(mockSendPushover).toHaveBeenCalledTimes(1);
    const [, devices, message] = mockSendPushover.mock.calls[0]!;
    expect(devices).toEqual(['daniel-phone', 'daniel-tablet']);
    expect(message).toEqual({ title: 'Timer finished', body: 'A cook timer just finished.' });
    // Stricter than the web-push payload: this crosses to a third party, so not
    // even the session id (which embeds the recipe id) goes with it.
    expect(JSON.stringify(message)).not.toContain(SESSION_ID);
    expect(JSON.stringify(message)).not.toContain(STEP_ID);
  });

  it('sends via BOTH sinks during the rollout', async () => {
    mockSubsDocs = [subDoc(makeSub('dev-1'))];

    await (onCookTimerDispatch as unknown as Function)(req());

    expect(mockSendWebPush).toHaveBeenCalledTimes(1);
    expect(mockSendPushover).toHaveBeenCalledTimes(1);
  });

  it('still sends via Pushover when web push is unprovisioned or failing', async () => {
    mockSubsDocs = [subDoc(makeSub('dev-1'))];
    mockSendWebPush.mockResolvedValue('failed' as const);

    await (onCookTimerDispatch as unknown as Function)(req());

    expect(mockSendPushover).toHaveBeenCalledTimes(1);
  });

  it('sends NOTHING and reports when no device matched the member prefix', async () => {
    // The fail-open guard. Pushover would broadcast to the whole family if we
    // sent an unresolvable device name, so a zero-match must not send at all —
    // and must be reported, since it is a misconfiguration rather than a blip.
    mockResolveTargets.mockResolvedValue({ kind: 'no-devices', firstName: 'Daniel' });

    await (onCookTimerDispatch as unknown as Function)(req());

    expect(mockSendPushover).not.toHaveBeenCalled();
    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(String(mockReport.mock.calls[0]![0])).toContain('Daniel');
  });

  it('sends nothing and does NOT report when suppressed in non-production', async () => {
    mockResolveTargets.mockResolvedValue({ kind: 'suppressed' });

    await (onCookTimerDispatch as unknown as Function)(req());

    expect(mockSendPushover).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('sends nothing and does NOT report when resolution hits an operational blip', async () => {
    // An offline wobble is the expected, not the unexpected (§7.6).
    mockResolveTargets.mockResolvedValue({ kind: 'unresolved', reason: 'network' });

    await (onCookTimerDispatch as unknown as Function)(req());

    expect(mockSendPushover).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('reports (does not throw) when the Pushover send fails', async () => {
    mockSendPushover.mockResolvedValue('failed' as const);

    await expect((onCookTimerDispatch as unknown as Function)(req())).resolves.toBeUndefined();

    expect(mockReport).toHaveBeenCalledTimes(1);
  });
});
