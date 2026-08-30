import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import type { ShoppingDayDoc } from '@salt/domain/schemas';

// The shop-day service (issue #629). Two things are its own (everything else is
// pass-through to the adapter): it follows the planner's selected week rather
// than owning week navigation, and it enforces ONE SHOP PER WEEK by clearing any
// other marked day before writing the new one.

const {
  mockSubscribeInRange,
  mockSaveShoppingDay,
  mockDeleteShoppingDay,
  mockSelectedStartDate,
  mockExtensionStartDate,
  mockFirstDayOfWeek,
  mockUnsub,
  mockUpcomingUnsub,
} = await vi.hoisted(async () => {
  // A minimal readable store, hand-rolled: vi.hoisted runs before imports, so
  // svelte/store's writable is not available here yet.
  const { makeStore } = await import('./support/testStore.js');
  return {
    mockSubscribeInRange: vi.fn(),
    mockSaveShoppingDay: vi.fn(),
    mockDeleteShoppingDay: vi.fn(),
    mockSelectedStartDate: makeStore(''),
    mockExtensionStartDate: makeStore(''),
    mockFirstDayOfWeek: makeStore('mon'),
    // Two unsubscribe spies, not one: `mockUnsub` is handed back for the
    // per-WEEK range reads, `mockUpcomingUnsub` for the single lookahead read
    // (see the mockImplementation in beforeEach). A shared spy could only say
    // "two of something fired" on teardown — these say which.
    mockUnsub: vi.fn(),
    mockUpcomingUnsub: vi.fn(),
  };
});

vi.mock('@salt/firebase-sync', () => ({
  subscribeShoppingDaysInRange: mockSubscribeInRange,
  saveShoppingDay: mockSaveShoppingDay,
  deleteShoppingDay: mockDeleteShoppingDay,
}));
vi.mock('../src/lib/mealPlanService.js', () => ({
  selectedStartDate: mockSelectedStartDate,
  extensionStartDate: mockExtensionStartDate,
  firstDayOfWeek: mockFirstDayOfWeek,
}));
vi.mock('../src/lib/auth.svelte.js', () => ({ auth: { user: { uid: 'uid-a' } } }));

import {
  weekShopDay,
  extensionWeekShopDay,
  upcomingShopDay,
  initShoppingDaySync,
  setShopDay,
  clearShopDay,
  seedWeekShopDay,
  seedShopDayForWeek,
  __resetShoppingDayServiceForTest,
} from '../src/lib/shoppingDayService.js';

const SATURDAY: ShoppingDayDoc = {
  date: '2026-08-15',
  slot: 'am',
  schemaVersion: 1,
  setBy: 'uid-a',
  setAt: '2026-08-10T09:00:00.000Z',
};

type RangeCall = [
  string,
  string,
  (days: ShoppingDayDoc[]) => void,
  (err: unknown, raw?: unknown) => void,
];

beforeEach(() => {
  vi.clearAllMocks();
  // Pin the clock inside the fixtures' own week. The lookahead window is
  // "today → +13 days" and the service drops a shop day already gone, so an
  // unpinned run reads SATURDAY as past from 2026-08-16 onward — the suite
  // would go red on a date, with nothing having changed.
  vi.useFakeTimers();
  // Every date in this file is a fixture around the week of 2026-08-10, but the
  // lookahead re-filters against a LIVE today (see the service) — so without a
  // pinned clock the suite silently rots the moment real time passes the
  // fixtures. Pin it once here rather than per test; `shouldAdvanceTime` keeps
  // the async mutation tests from waiting on a frozen clock.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-08-10T09:00:00.000Z'));
  // A week read spans seven days, the lookahead fourteen — the only thing that
  // tells the two subscriptions apart at the adapter seam.
  mockSubscribeInRange.mockImplementation((start: string, end: string) =>
    (Date.parse(end) - Date.parse(start)) / 86_400_000 > 6 ? mockUpcomingUnsub : mockUnsub,
  );
  mockSaveShoppingDay.mockResolvedValue({ kind: 'ok', value: undefined });
  mockDeleteShoppingDay.mockResolvedValue({ kind: 'ok', value: undefined });
  mockSelectedStartDate.set('');
  mockExtensionStartDate.set('');
  mockFirstDayOfWeek.set('mon');
});

afterEach(() => {
  vi.useRealTimers();
  __resetShoppingDayServiceForTest();
  vi.useRealTimers();
});

describe('initShoppingDaySync', () => {
  it('follows the planner week rather than owning week navigation', () => {
    mockSelectedStartDate.set('2026-08-10');
    initShoppingDaySync();

    // The week read is exactly the seven days the planner is showing — the shop
    // marker sits INSIDE whatever week firstDayOfWeek produced, untouched.
    const weekCall = mockSubscribeInRange.mock.calls.find(
      (c) => (c as RangeCall)[0] === '2026-08-10',
    ) as RangeCall | undefined;
    expect(weekCall?.[1]).toBe('2026-08-16');
  });

  it('re-subscribes when the planner navigates to another week', () => {
    mockSelectedStartDate.set('2026-08-10');
    initShoppingDaySync();
    const before = mockSubscribeInRange.mock.calls.length;

    mockSelectedStartDate.set('2026-08-17');

    expect(mockUnsub).toHaveBeenCalled();
    const after = mockSubscribeInRange.mock.calls.at(-1) as RangeCall;
    expect(mockSubscribeInRange.mock.calls.length).toBeGreaterThan(before);
    expect(after[0]).toBe('2026-08-17');
    expect(after[1]).toBe('2026-08-23');
  });

  it('publishes the week shop day the range read delivers', () => {
    mockSelectedStartDate.set('2026-08-10');
    initShoppingDaySync();
    const weekCall = mockSubscribeInRange.mock.calls.find(
      (c) => (c as RangeCall)[0] === '2026-08-10',
    ) as RangeCall;

    weekCall[2]([SATURDAY]);
    expect(get(weekShopDay)).toEqual(SATURDAY);

    // A cleared shop day is simply an empty range, not a "cleared" state.
    weekCall[2]([]);
    expect(get(weekShopDay)).toBeNull();
  });

  it('also watches ahead for the shopping list line', () => {
    mockSelectedStartDate.set('2026-08-10');
    initShoppingDaySync();
    // Second subscription: today → +13 days, so the line still has something to
    // say once this week's shop has been and gone.
    expect(mockSubscribeInRange).toHaveBeenCalledTimes(2);
    const upcomingCall = mockSubscribeInRange.mock.calls.at(-1) as RangeCall;
    upcomingCall[2]([SATURDAY]);
    expect(get(upcomingShopDay)).toEqual(SATURDAY);
  });

  it('distinguishes "not loaded" from "no shop set"', () => {
    // The shopping list shows a prompt on null; without a distinct undefined it
    // would flash that prompt on every page load. undefined until a snapshot
    // lands, null once one lands empty.
    expect(get(upcomingShopDay)).toBeUndefined();
    initShoppingDaySync();
    expect(get(upcomingShopDay)).toBeUndefined();
    const upcomingCall = mockSubscribeInRange.mock.calls.at(-1) as RangeCall;
    upcomingCall[2]([]);
    expect(get(upcomingShopDay)).toBeNull();
  });

  it('leaves the store not-loaded when the very first read fails', () => {
    // "No shop set" would be a claim we cannot make on a failed read.
    initShoppingDaySync();
    const upcomingCall = mockSubscribeInRange.mock.calls.at(-1) as RangeCall;
    upcomingCall[3]({ kind: 'NetworkError', reason: 'offline' });
    expect(get(upcomingShopDay)).toBeUndefined();
  });

  it('drops a shop day that has already happened from the lookahead', () => {
    // The range is computed once at sign-in, so an app left open for days would
    // otherwise keep offering a past shop as "upcoming".
    vi.setSystemTime(new Date('2026-08-20T09:00:00.000Z'));
    initShoppingDaySync();
    const upcomingCall = mockSubscribeInRange.mock.calls.at(-1) as RangeCall;
    upcomingCall[2]([SATURDAY]); // 2026-08-15, five days gone
    expect(get(upcomingShopDay)).toBeNull();
  });

  // Teardown is written out TWICE in the service — the closure
  // `initShoppingDaySync` returns, and `__resetShoppingDayServiceForTest` — as
  // two byte-identical blocks that differ only by a comment. A store added to
  // one and not the other bleeds state from test to test and surfaces as an
  // unrelated flake somewhere else entirely. Driving both entry points through
  // the SAME table makes their equivalence a machine-checked fact rather than
  // something a reader has to diff by eye, which is what makes collapsing them
  // onto a single hoisted `teardown()` legal (issue #1055).
  const TEARDOWN_ENTRY_POINTS: { name: string; teardown: (stop: () => void) => void }[] = [
    { name: 'the closure initShoppingDaySync returns', teardown: (stop) => stop() },
    {
      name: '__resetShoppingDayServiceForTest',
      teardown: () => __resetShoppingDayServiceForTest(),
    },
  ];

  it.each(TEARDOWN_ENTRY_POINTS)(
    'drops every subscription and resets every store — via $name',
    async ({ teardown }) => {
      const THIS_WEEK = '2026-08-10';
      const NEXT_WEEK = '2026-08-17';
      const NEXT_WEEK_SHOP: ShoppingDayDoc = { ...SATURDAY, date: '2026-08-19', slot: 'pm' };

      // Both planner weeks are set BEFORE init, so the two week reads land first
      // and the lookahead is the last subscribe call.
      mockSelectedStartDate.set(THIS_WEEK);
      mockExtensionStartDate.set(NEXT_WEEK);
      const stop = initShoppingDaySync();
      const rangeCallFor = (start: string) =>
        mockSubscribeInRange.mock.calls.find((c) => (c as RangeCall)[0] === start) as RangeCall;

      rangeCallFor(THIS_WEEK)[2]([SATURDAY]);
      rangeCallFor(NEXT_WEEK)[2]([NEXT_WEEK_SHOP]);
      (mockSubscribeInRange.mock.calls.at(-1) as RangeCall)[2]([SATURDAY]);

      // Every store holds something other than its reset value, so what follows
      // is a transition and not a vacuous truth.
      expect(get(weekShopDay)).toEqual(SATURDAY);
      expect(get(extensionWeekShopDay)).toEqual(NEXT_WEEK_SHOP);
      expect(get(upcomingShopDay)).toEqual(SATURDAY);

      mockUnsub.mockClear();
      mockUpcomingUnsub.mockClear();

      teardown(stop);

      // One unsubscribe per subscribed week, plus the lookahead's own.
      expect(mockUnsub).toHaveBeenCalledTimes(2);
      expect(mockUpcomingUnsub).toHaveBeenCalledTimes(1);

      expect(get(weekShopDay)).toBeNull();
      expect(get(extensionWeekShopDay)).toBeNull();
      // Back to not-loaded, not to "no shop set" — a signed-out app knows nothing.
      expect(get(upcomingShopDay)).toBeUndefined();

      // The two planner-store subscriptions are gone: navigating the planner now
      // starts nothing. (These unsubscribes return no spy, so the observable
      // fact is that no further week read is opened.)
      mockSubscribeInRange.mockClear();
      mockSelectedStartDate.set('2026-08-24');
      mockExtensionStartDate.set('2026-08-31');
      expect(mockSubscribeInRange).not.toHaveBeenCalled();

      // `_shopDayByWeek` is empty, read back through the one-shop-per-week clear:
      // a stale SATURDAY left in the map would have this delete it.
      await setShopDay('2026-08-13', 'am');
      expect(mockDeleteShoppingDay).not.toHaveBeenCalled();

      // `_weekStart` and `_extensionWeekStart` are back to '', read back through
      // the derived stores they feed: a marker seeded under '' surfaces on
      // weekShopDay only while _weekStart is '', and extensionWeekShopDay is
      // null for an empty extension start whatever the map holds.
      const EMPTY_WEEK_PROBE: ShoppingDayDoc = { ...SATURDAY, date: '2026-08-01' };
      seedShopDayForWeek('', EMPTY_WEEK_PROBE);
      seedShopDayForWeek(NEXT_WEEK, NEXT_WEEK_SHOP);
      expect(get(weekShopDay)).toEqual(EMPTY_WEEK_PROBE);
      expect(get(extensionWeekShopDay)).toBeNull();
    },
  );
});

describe('setShopDay', () => {
  it('clears the week’s existing shop day before marking a new one', async () => {
    seedWeekShopDay(SATURDAY);

    const result = await setShopDay('2026-08-13', 'pm');

    expect(mockDeleteShoppingDay).toHaveBeenCalledWith('2026-08-15');
    expect(mockSaveShoppingDay).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-08-13', slot: 'pm', schemaVersion: 1, setBy: 'uid-a' }),
    );
    expect(result.kind).toBe('ok');
  });

  it('does not delete-then-rewrite when only the slot changes', async () => {
    seedWeekShopDay(SATURDAY);

    await setShopDay('2026-08-15', 'pm');

    expect(mockDeleteShoppingDay).not.toHaveBeenCalled();
    expect(mockSaveShoppingDay).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-08-15', slot: 'pm' }),
    );
  });

  it('does not write a second shop day when the clear fails', async () => {
    // Otherwise a failed clear would leave the week holding two.
    seedWeekShopDay(SATURDAY);
    mockDeleteShoppingDay.mockResolvedValue({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'offline' },
    });

    const result = await setShopDay('2026-08-13', 'am');

    expect(mockSaveShoppingDay).not.toHaveBeenCalled();
    expect(result.kind).toBe('err');
  });

  it('marks a day in a week that had none', async () => {
    seedWeekShopDay(null);
    await setShopDay('2026-08-13', 'am');
    expect(mockDeleteShoppingDay).not.toHaveBeenCalled();
    expect(mockSaveShoppingDay).toHaveBeenCalledTimes(1);
  });
});

// Two weeks on screen (issue #639) is exactly where "the shop day" stops being a
// single answer. These prove the marker is keyed by WEEK, both on the way in
// (subscriptions) and on the way out (the one-shop-per-week clear).
describe('two weeks at once', () => {
  const THIS_WEEK = '2026-08-10';
  const NEXT_WEEK = '2026-08-17';
  const NEXT_WEEK_SHOP: ShoppingDayDoc = {
    date: '2026-08-19',
    slot: 'pm',
    schemaVersion: 1,
    setBy: 'uid-a',
    setAt: '2026-08-10T09:00:00.000Z',
  };

  function rangeCallFor(start: string): RangeCall | undefined {
    return mockSubscribeInRange.mock.calls.find((c) => (c as RangeCall)[0] === start) as
      RangeCall | undefined;
  }

  it('follows the planner’s second week as its own subscription', () => {
    mockSelectedStartDate.set(THIS_WEEK);
    initShoppingDaySync();
    mockExtensionStartDate.set(NEXT_WEEK);

    // A second seven-day range read, not a widened one — a widened window would
    // collapse two weeks into one "current shop day".
    expect(rangeCallFor(NEXT_WEEK)?.[1]).toBe('2026-08-23');
    expect(rangeCallFor(THIS_WEEK)?.[1]).toBe('2026-08-16');
  });

  it('keeps each week’s marker to itself', () => {
    mockSelectedStartDate.set(THIS_WEEK);
    initShoppingDaySync();
    mockExtensionStartDate.set(NEXT_WEEK);

    rangeCallFor(THIS_WEEK)![2]([SATURDAY]);
    rangeCallFor(NEXT_WEEK)![2]([NEXT_WEEK_SHOP]);

    expect(get(weekShopDay)).toEqual(SATURDAY);
    expect(get(extensionWeekShopDay)).toEqual(NEXT_WEEK_SHOP);
  });

  it('drops the second week when the planner lets it go', () => {
    mockSelectedStartDate.set(THIS_WEEK);
    initShoppingDaySync();
    mockExtensionStartDate.set(NEXT_WEEK);
    rangeCallFor(NEXT_WEEK)![2]([NEXT_WEEK_SHOP]);
    mockUnsub.mockClear();

    mockExtensionStartDate.set('');

    expect(mockUnsub).toHaveBeenCalledTimes(1);
    expect(get(extensionWeekShopDay)).toBeNull();
  });

  it('marking a shop in one week leaves the other week’s shop untouched', async () => {
    // The bug this exists to prevent: clearing "the current shop day" from a
    // window covering two weeks deletes a shop the user never touched — and the
    // daily reminder that hangs off it.
    seedShopDayForWeek(THIS_WEEK, SATURDAY); // 2026-08-15
    seedShopDayForWeek(NEXT_WEEK, NEXT_WEEK_SHOP); // 2026-08-19

    const result = await setShopDay('2026-08-18', 'am'); // move NEXT week's shop

    expect(mockDeleteShoppingDay).toHaveBeenCalledTimes(1);
    expect(mockDeleteShoppingDay).toHaveBeenCalledWith('2026-08-19');
    expect(mockDeleteShoppingDay).not.toHaveBeenCalledWith(SATURDAY.date);
    expect(mockSaveShoppingDay).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-08-18', slot: 'am' }),
    );
    expect(result.kind).toBe('ok');
  });

  it('marks a week that has no shop without clearing another week’s', async () => {
    seedShopDayForWeek(THIS_WEEK, SATURDAY);

    await setShopDay('2026-08-18', 'am');

    expect(mockDeleteShoppingDay).not.toHaveBeenCalled();
    expect(mockSaveShoppingDay).toHaveBeenCalledTimes(1);
  });

  it('decides which week a date belongs to with firstDayOfWeek, not a fixed Monday', async () => {
    // Production runs fri-first weeks. Under fri, 2026-08-15 (Sat) and
    // 2026-08-17 (Mon) share the week starting 2026-08-14; under mon they do not.
    mockFirstDayOfWeek.set('fri');
    seedShopDayForWeek('2026-08-14', SATURDAY);

    await setShopDay('2026-08-17', 'am');

    expect(mockDeleteShoppingDay).toHaveBeenCalledWith('2026-08-15');
  });
});

describe('clearShopDay', () => {
  it('deletes the date-keyed doc', async () => {
    await clearShopDay('2026-08-15');
    expect(mockDeleteShoppingDay).toHaveBeenCalledWith('2026-08-15');
  });
});
