import {
  subscribeShoppingDaysInRange,
  saveShoppingDay,
  deleteShoppingDay,
} from '@salt/firebase-sync';
import { addCalendarDays, shopDayForWeek, weekStartFor } from '@salt/domain';
import type { ShoppingDayDoc, ShoppingSlot } from '@salt/domain/schemas';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { writable, derived, get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { auth } from './auth.svelte.js';
import { subscriptionErrorHandler } from './errorReporting.js';
import { selectedStartDate, extensionStartDate, firstDayOfWeek } from './mealPlanService.js';

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
// line has nothing useful to say.
const UPCOMING_WINDOW_DAYS = 13;

// ─── Reactive stores ─────────────────────────────────────────────────────────

// Shop markers keyed by WEEK START, because the planner can hold more than one
// week at a time (issue #639) and "one shop per week" is a claim about a
// specific week — not about whatever range happens to be on screen. Keying the
// markers by week is what lets `setShopDay` clear the right week's shop and only
// that week's: a window-wide "the current shop day" would have marking next
// week's shop delete this week's, and with it the reminder that depends on it.
const _shopDayByWeek = writable<Record<string, ShoppingDayDoc | null>>({});
// Week starts the planner is showing: the primary one, and the optional second.
const _weekStart = writable<string>('');
const _extensionWeekStart = writable<string>('');
const _upcomingShopDay = writable<ShoppingDayDoc | null | undefined>(undefined);

/** The shop day inside the planner week currently displayed, or null. */
export const weekShopDay: Readable<ShoppingDayDoc | null> = derived(
  [_shopDayByWeek, _weekStart],
  ([$byWeek, $start]) => $byWeek[$start] ?? null,
);

/** The shop day inside the extension week, or null when there isn't one. */
export const extensionWeekShopDay: Readable<ShoppingDayDoc | null> = derived(
  [_shopDayByWeek, _extensionWeekStart],
  ([$byWeek, $start]) => ($start ? ($byWeek[$start] ?? null) : null),
);

/**
 * The next shop from today onward (within the lookahead window).
 *
 * Three states, mirroring `defaultListId`: `undefined` = not loaded yet, `null`
 * = loaded and no shop is set, a doc = the next shop. The split is load-bearing
 * — the shopping list shows a "No shop day set" prompt on `null`, and without a
 * distinct not-loaded state that prompt would flash on every page load before
 * the subscription resolves.
 */
export const upcomingShopDay: Readable<ShoppingDayDoc | null | undefined> = _upcomingShopDay;

// ─── Subscriptions ───────────────────────────────────────────────────────────

// One range subscription per subscribed week, keyed by week start.
const weekUnsubs = new Map<string, () => void>();
let upcomingUnsub: (() => void) | null = null;
let startDateUnsub: (() => void) | null = null;
let extensionStartUnsub: (() => void) | null = null;

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA'); // en-CA renders local-tz YYYY-MM-DD
}

// Subscribe to one week's shop days. Idempotent — a re-emit of the same start is
// a no-op, so callers may re-assert the weeks they want freely.
function subscribeWeek(start: string): void {
  if (!start || weekUnsubs.has(start)) return;
  weekUnsubs.set(
    start,
    subscribeShoppingDaysInRange(
      start,
      addCalendarDays(start, 6),
      (days) => _shopDayByWeek.update((byWeek) => ({ ...byWeek, [start]: shopDayForWeek(days) })),
      // A failed/corrupt range read leaves the last-known marker in place; the
      // planner then shades exactly as it did before, which is the honest
      // fallback. The handler reports it to the category gate on the way past.
      subscriptionErrorHandler(),
    ),
  );
}

function unsubscribeWeek(start: string): void {
  weekUnsubs.get(start)?.();
  weekUnsubs.delete(start);
  _shopDayByWeek.update((byWeek) => {
    if (!(start in byWeek)) return byWeek;
    const next = { ...byWeek };
    delete next[start];
    return next;
  });
}

// Keep exactly the weeks the planner is showing subscribed.
function pruneWeeks(): void {
  const keep = new Set([get(_weekStart), get(_extensionWeekStart)].filter(Boolean));
  for (const start of [...weekUnsubs.keys()]) {
    if (!keep.has(start)) unsubscribeWeek(start);
  }
}

// The start date of the week `date` belongs to, under the household's
// firstDayOfWeek. The single definition of "this date's week" in this service.
function weekOf(date: string): string {
  return weekStartFor(date, get(firstDayOfWeek));
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
  startDateUnsub = selectedStartDate.subscribe((start) => {
    _weekStart.set(start);
    subscribeWeek(start);
    pruneWeeks();
  });
  // The second week, when the planner holds one, follows the planner too — this
  // service still owns no week navigation of its own.
  extensionStartUnsub = extensionStartDate.subscribe((start) => {
    _extensionWeekStart.set(start);
    subscribeWeek(start);
    pruneWeeks();
  });

  const today = todayIso();
  upcomingUnsub = subscribeShoppingDaysInRange(
    today,
    addCalendarDays(today, UPCOMING_WINDOW_DAYS),
    // Re-filter against a FRESH today on every snapshot. The range above is
    // computed once at sign-in, so an app left open for days would otherwise
    // keep offering a shop that has already happened as "upcoming".
    (days) => _upcomingShopDay.set(shopDayForWeek(days.filter((d) => d.date >= todayIso()))),
    // As above — reported, and the line keeps its last-known value. Note this
    // leaves the store `undefined` if the very first read fails, which renders
    // nothing: the right call, since "no shop set" would be a claim we cannot
    // make.
    subscriptionErrorHandler(),
  );

  return () => {
    startDateUnsub?.();
    extensionStartUnsub?.();
    upcomingUnsub?.();
    startDateUnsub = extensionStartUnsub = upcomingUnsub = null;
    for (const unsub of weekUnsubs.values()) unsub();
    weekUnsubs.clear();
    _shopDayByWeek.set({});
    _weekStart.set('');
    _extensionWeekStart.set('');
    // Back to not-loaded, not to "no shop set" — a signed-out app knows nothing.
    _upcomingShopDay.set(undefined);
  };
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Mark `date` as the shop for its week, at `slot`.
 *
 * There is ONE shop per week, so any other shop day already in THAT DATE'S week
 * is cleared first. The clear is a plain delete of a date-keyed doc — no "cleared"
 * state to represent, nothing stale left to filter out.
 *
 * "That date's week" is `weekStartFor(date, firstDayOfWeek)`, which is what one
 * shop per week always meant — not "the week range currently on screen". With
 * two weeks displayed those are different answers, and the screen-shaped one
 * deletes a shop in a week the user was not touching, taking its reminder with
 * it. If we hold no marker for the date's week (never subscribed), there is
 * nothing we can honestly clear, so we only write.
 */
export async function setShopDay(
  date: string,
  slot: ShoppingSlot,
): Promise<ReadResult<void, DomainError>> {
  const existing = get(_shopDayByWeek)[weekOf(date)] ?? null;
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
  extensionStartUnsub?.();
  upcomingUnsub?.();
  startDateUnsub = extensionStartUnsub = upcomingUnsub = null;
  for (const unsub of weekUnsubs.values()) unsub();
  weekUnsubs.clear();
  _shopDayByWeek.set({});
  _weekStart.set('');
  _extensionWeekStart.set('');
  _upcomingShopDay.set(undefined);
}

/** Seed a shop marker for an arbitrary week (used by tests / e2e). */
export function seedShopDayForWeek(weekStart: string, day: ShoppingDayDoc | null): void {
  _shopDayByWeek.update((byWeek) => ({ ...byWeek, [weekStart]: day }));
}

/** Seed the DISPLAYED week's shop marker, moving the displayed week to match it. */
export function seedWeekShopDay(day: ShoppingDayDoc | null): void {
  const start = day ? weekOf(day.date) : get(_weekStart);
  _weekStart.set(start);
  seedShopDayForWeek(start, day);
}

export function seedUpcomingShopDay(day: ShoppingDayDoc | null | undefined): void {
  _upcomingShopDay.set(day);
}
