import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PushSubscriptionDoc, ShoppingDayDoc } from '@salt/domain/schemas';

// Unit-level (mock-based, no emulator) coverage of the daily shop-day reminder
// (issue #629): a single `get` by deterministic id decides whether anything
// happens at all, then the nudge broadcasts to every device, pruning the dead.
// ShoppingDaySchema / ShoppingListsConfigSchema / PushSubscriptionSchema and the
// `tomorrowInZone` domain helper are all kept REAL.

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: () => 'test-vapid-key' }),
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
// factory may reference it. `mockShoppingDayGets` records every id the handler
// asked for, which is how the "one read by id, no scan" claim is asserted.
let mockShoppingDaySnap: { exists: boolean; data: () => unknown } = {
  exists: false,
  data: () => undefined,
};
const mockShoppingDayGets: string[] = [];
let mockConfigSnap: { data: () => unknown } = { data: () => undefined };
let mockSubsDocs: Array<{ data: () => unknown; ref: { delete: () => Promise<void> } }> = [];
const mockSubsListed = vi.fn();

const mockDb = {
  collection: (name: string) => {
    if (name === 'shoppingDays') {
      return {
        doc: (id: string) => ({
          get: async () => {
            mockShoppingDayGets.push(id);
            return mockShoppingDaySnap;
          },
        }),
      };
    }
    if (name === 'shoppingListsConfig') {
      return { doc: () => ({ get: async () => mockConfigSnap }) };
    }
    if (name === 'pushSubscriptions') {
      return {
        get: async () => {
          mockSubsListed();
          return { docs: mockSubsDocs };
        },
      };
    }
    return { doc: () => ({}) };
  },
};
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => mockDb,
}));

const { remindShoppingDay } = await import('../../src/maintenance/remindShoppingDay.js');

function shoppingDay(overrides: Partial<ShoppingDayDoc> = {}): ShoppingDayDoc {
  return {
    date: '2026-08-15',
    slot: 'am',
    schemaVersion: 1,
    setBy: 'uid-a',
    setAt: '2026-08-10T09:00:00.000Z',
    ...overrides,
  };
}

function makeSub(id: string): PushSubscriptionDoc {
  return {
    id,
    schemaVersion: 1,
    ownerUid: `uid-${id}`,
    endpoint: `https://push.example/${id}`,
    keys: { p256dh: `p256-${id}`, auth: `auth-${id}` },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function subDoc(sub: PushSubscriptionDoc) {
  return { data: () => sub, ref: { delete: vi.fn(async () => undefined) } };
}

// The handler reads the wall clock to work out "tomorrow", so pin it. 16:00Z on
// 2026-08-14 is 17:00 BST — the exact instant the cron fires — making tomorrow
// 2026-08-15.
const CRON_INSTANT = new Date('2026-08-14T16:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(CRON_INSTANT);
  mockShoppingDaySnap = { exists: false, data: () => undefined };
  mockShoppingDayGets.length = 0;
  mockConfigSnap = { data: () => ({ defaultListId: 'list-weekly', schemaVersion: 1 }) };
  mockSubsDocs = [];
  mockSendWebPush.mockResolvedValue('sent' as const);
});

describe('remindShoppingDay', () => {
  it('short-circuits before any push when no shop day is set for tomorrow', async () => {
    mockShoppingDaySnap = { exists: false, data: () => undefined };

    await (remindShoppingDay as unknown as Function)();

    // The whole daily cost on the ~6 quiet days: one document read by id.
    expect(mockShoppingDayGets).toEqual(['2026-08-15']);
    expect(mockSubsListed).not.toHaveBeenCalled();
    expect(mockSendWebPush).not.toHaveBeenCalled();
    expect(mockFlush).toHaveBeenCalled();
  });

  it('reads tomorrow by deterministic id in the reminder time zone', async () => {
    // Winter instant: 17:00 GMT. Tomorrow must be the 10th, not the 9th.
    vi.setSystemTime(new Date('2026-01-09T17:00:00.000Z'));

    await (remindShoppingDay as unknown as Function)();

    expect(mockShoppingDayGets).toEqual(['2026-01-10']);
  });

  it('broadcasts an ids-only nudge to every device when a shop is set', async () => {
    mockShoppingDaySnap = { exists: true, data: () => shoppingDay() };
    mockSubsDocs = [subDoc(makeSub('a')), subDoc(makeSub('b'))];

    await (remindShoppingDay as unknown as Function)();

    expect(mockSendWebPush).toHaveBeenCalledTimes(2);
    const payload = mockSendWebPush.mock.calls[0]?.[2];
    expect(payload).toEqual({
      type: 'shopping-reminder',
      tag: 'shopping::2026-08-15',
      url: '/#/shopping/list-weekly',
      title: 'Shopping tomorrow AM',
      body: 'Add anything missing to the list.',
      renotify: false,
    });
    // No free text from the list or the planner rides on the transport (#544).
    expect(JSON.stringify(payload)).not.toContain('setBy');
  });

  it('says PM for an afternoon shop, at the same hour', async () => {
    mockShoppingDaySnap = { exists: true, data: () => shoppingDay({ slot: 'pm' }) };
    mockSubsDocs = [subDoc(makeSub('a'))];

    await (remindShoppingDay as unknown as Function)();

    const payload = mockSendWebPush.mock.calls[0]?.[2] as { title: string };
    expect(payload.title).toBe('Shopping tomorrow PM');
  });

  it('prunes a subscription the push service reports as gone', async () => {
    mockShoppingDaySnap = { exists: true, data: () => shoppingDay() };
    const dead = subDoc(makeSub('dead'));
    const live = subDoc(makeSub('live'));
    mockSubsDocs = [dead, live];
    mockSendWebPush.mockResolvedValueOnce('gone' as const).mockResolvedValueOnce('sent' as const);

    await (remindShoppingDay as unknown as Function)();

    expect(dead.ref.delete).toHaveBeenCalledTimes(1);
    expect(live.ref.delete).not.toHaveBeenCalled();
    // A dead device must not stop the rest of the household being told.
    expect(mockSendWebPush).toHaveBeenCalledTimes(2);
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('reports a transient send failure without pruning', async () => {
    mockShoppingDaySnap = { exists: true, data: () => shoppingDay() };
    const sub = subDoc(makeSub('a'));
    mockSubsDocs = [sub];
    mockSendWebPush.mockResolvedValue('failed' as const);

    await (remindShoppingDay as unknown as Function)();

    expect(sub.ref.delete).not.toHaveBeenCalled();
    expect(mockReport).toHaveBeenCalledTimes(1);
  });

  it('still notifies when no default list is configured', async () => {
    // The reminder matters most when nothing is set up; the deep link just lands
    // on the list index instead of a specific list.
    mockShoppingDaySnap = { exists: true, data: () => shoppingDay() };
    mockConfigSnap = { data: () => undefined };
    mockSubsDocs = [subDoc(makeSub('a'))];

    await (remindShoppingDay as unknown as Function)();

    const payload = mockSendWebPush.mock.calls[0]?.[2] as { url: string };
    expect(payload.url).toBe('/#/shopping');
  });

  it('skips a corrupt shoppingDay doc without sending', async () => {
    mockShoppingDaySnap = { exists: true, data: () => ({ date: 'not-a-date', slot: 'whenever' }) };
    mockSubsDocs = [subDoc(makeSub('a'))];

    await (remindShoppingDay as unknown as Function)();

    expect(mockSendWebPush).not.toHaveBeenCalled();
  });

  it('never throws out of the scheduled handler, and always flushes', async () => {
    mockShoppingDaySnap = {
      exists: true,
      get data(): () => unknown {
        throw new Error('firestore exploded');
      },
    };

    await expect((remindShoppingDay as unknown as Function)()).resolves.toBeUndefined();
    expect(mockReport).toHaveBeenCalledWith(expect.any(Error), 'SyncError');
    expect(mockFlush).toHaveBeenCalled();
  });
});
