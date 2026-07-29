import {
  subscribeShoppingDaysInRange,
  saveShoppingDay,
  deleteShoppingDay,
} from '@salt/firebase-sync';
import { addCalendarDays, shopDayForWeek } from '@salt/domain';
import type { ShoppingDayDoc, ShoppingSlot } from '@salt/domain/schemas';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { auth } from './auth.svelte.js';
import { selectedStartDate } from './mealPlanService.js';

// Shop-day service (issue #629). The shop date is provisioning state for the
// household's WEEK — days before it can only be cooked from food already in the
// house — so it is read by two surfaces, and this service holds one subscription
// for each:
//
//   1. the PLANNER week on screen, which shades its pre-shop days and offers the
//      AM/PM marker; and
//   2. the NEXT shop coming up, which the shopping list shows as a read-only chip
//      so you know what you are stocking for.
//
// Both are range reads over doc ids (the id IS the date), so neither needs an
// index. Nothing is cached outside Firestore's own persistent cache (Rule 3).

// How far ahead the shopping list looks for "the next shop". Two weeks covers
// this week's shop and next week's once this week's has passed; beyond that the
// chip has nothing useful to say.
const UPCOMING_WINDOW_DAYS = 13;

// ─── Reactive stores ─────────────────────────────────────────────────────────

const _weekShopDay = writable<ShoppingDayDoc | null>(null);
const _upcomingShopDay = writable<ShoppingDayDoc | null>(null);

/** The shop day inside the planner week currently displayed, or null. */
export const weekShopDay: Readable<ShoppingDayDoc | null> = _weekShopDay;

/** The next shop from today onward (within the lookahead window), or null. */
export const upcomingShopDay: Readable<ShoppingDayDoc | null> = _upcomingShopDay;

// ─── Subscriptions ───────────────────────────────────────────────────────────

let weekUnsub: (() => void) | null = null;
let upcomingUnsub: (() => void) | null = null;
let startDateUnsub: (() => void) | null = null;
// The week range currently subscribed, so a re-emit of the same start is a no-op.
let subscribedStart = '';

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA'); // en-CA renders local-tz YYYY-MM-DD
}

function subscribeWeek(start: string): void {
  if (!start || start === subscribedStart) return;
  weekUnsub?.();
  subscribedStart = start;
  _weekShopDay.set(null);
  weekUnsub = subscribeShoppingDaysInRange(
    start,
    addCalendarDays(start, 6),
    (days) => _weekShopDay.set(shopDayForWeek(days)),
    () => {
      // A failed/corrupt range read leaves the last-known marker in place; the
      // planner then shades exactly as it did before, which is the honest
      // fallback. The adapter reports per the observability gate.
    },
  );
}

/**
 * Start both subscriptions. Bootstrapped from App.svelte's post-auth `$effect`
 * alongside the other sync services; returns an unsubscribe for its cleanup.
 *
 * The planner-week subscription FOLLOWS `selectedStartDate` from mealPlanService
 * rather than owning its own week navigation — `firstDayOfWeek` and planner
 * layout are untouched by this feature (the shop marker sits inside whatever week
 * the planner is already showing).
 */
export function initShoppingDaySync(): () => void {
  startDateUnsub = selectedStartDate.subscribe((start) => subscribeWeek(start));

  const today = todayIso();
  upcomingUnsub = subscribeShoppingDaysInRange(
    today,
    addCalendarDays(today, UPCOMING_WINDOW_DAYS),
    (days) => _upcomingShopDay.set(shopDayForWeek(days)),
    () => {
      // As above — the chip keeps its last-known value (or stays hidden).
    },
  );

  return () => {
    startDateUnsub?.();
    weekUnsub?.();
    upcomingUnsub?.();
    startDateUnsub = weekUnsub = upcomingUnsub = null;
    subscribedStart = '';
    _weekShopDay.set(null);
    _upcomingShopDay.set(null);
  };
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Mark `date` as the shop for its week, at `slot`.
 *
 * There is ONE shop per week, so any other shop day already in the displayed week
 * is cleared first. The clear is a plain delete of a date-keyed doc — no "cleared"
 * state to represent, nothing stale left to filter out.
 */
export async function setShopDay(
  date: string,
  slot: ShoppingSlot,
): Promise<ReadResult<void, DomainError>> {
  const existing = get(_weekShopDay);
  if (existing && existing.date !== date) {
    const cleared = await deleteShoppingDay(existing.date);
    // A failed clear would leave two shop days in the week; don't compound it by
    // writing the second. The caller surfaces the failure.
    if (cleared.kind === 'err') return cleared;
  }
  return saveShoppingDay({
    date,
    slot,
    schemaVersion: 1,
    // Audit only — the rules deliberately do not pin it, because either of them
    // may reschedule the other's shop.
    setBy: auth.user?.uid ?? '',
    setAt: new Date().toISOString(),
  });
}

/** Clear the shop day on `date`. Clearing an unmarked date is a harmless no-op. */
export function clearShopDay(date: string): Promise<ReadResult<void, DomainError>> {
  return deleteShoppingDay(date);
}

// ─── Test / e2e helpers ──────────────────────────────────────────────────────

export function __resetShoppingDayServiceForTest(): void {
  startDateUnsub?.();
  weekUnsub?.();
  upcomingUnsub?.();
  startDateUnsub = weekUnsub = upcomingUnsub = null;
  subscribedStart = '';
  _weekShopDay.set(null);
  _upcomingShopDay.set(null);
}

export function seedWeekShopDay(day: ShoppingDayDoc | null): void {
  _weekShopDay.set(day);
}

export function seedUpcomingShopDay(day: ShoppingDayDoc | null): void {
  _upcomingShopDay.set(day);
}
