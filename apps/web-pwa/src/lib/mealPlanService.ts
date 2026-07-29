import {
  subscribeMealPlanConfig,
  subscribeMealPlanTemplate,
  subscribeMealPlanWeek,
  loadMealPlanWeek,
  saveMealPlanConfig,
  saveMealPlanTemplate,
  saveMealPlanWeek,
} from '@salt/firebase-sync';
import {
  weekStartFor,
  emptyWeek,
  emptyTemplate,
  instantiateWeek,
  setDayNote,
  setDayChefs,
  setDayRecipes,
  setDayGuests,
  addAttendee,
  removeAttendee,
  setAttendeeHomeTime,
  setAttendeeNote,
  type Attendee,
  type MealPlanConfig,
  type MealPlanTemplate,
  type MealPlanWeek,
  type Weekday,
} from '@salt/domain';
import { ErrorCode, failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import { writable, derived, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

// Meal planning service (issue #169). Subscribes to the two singletons (config +
// template) once and to the currently-selected week, re-subscribing as the user
// navigates. Domain commands compute new documents; the adapter persists them.
// See docs/meal-planning.md.
//
// The service can hold MORE THAN ONE week at a time (issue #639, phase 5): the
// primary week the user is on, plus an optional "extension" week the planner may
// scroll on into. Everything that is per-week — the loaded document, the
// stale-snapshot watermark, the subscription handle, the loading flag — is
// therefore keyed by week start date, and every mutation resolves its target
// document FROM ITS DATE KEY rather than from whatever happens to be displayed.
// That routing is the whole point: `MealPlanWeek.days` is a
// `Record<string, Day>`, so writing a foreign date key into the wrong week's
// document is not an error anywhere in the stack — it is silent corruption of
// production data.

const DEFAULT_FIRST_DAY: Weekday = 'mon';

// ─── Local date helpers (date-only YYYY-MM-DD, UTC arithmetic) ────────────────

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA'); // en-CA renders local-tz YYYY-MM-DD
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Drop a key from a record without mutating it (returns the same object when
// the key is absent, so derived stores don't churn).
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

// ─── Reactive stores ──────────────────────────────────────────────────────────

const _config = writable<MealPlanConfig | null>(null);
const _template = writable<MealPlanTemplate | null>(null);
// Loaded week documents, keyed by start date. A key is present only while we
// hold a real document for that week; absent means "no doc" (the readers fall
// back to an unsaved empty week).
const _weeks = writable<Record<string, MealPlanWeek>>({});
// The anchor date the user is viewing; the displayed week is the one containing
// it under the current firstDayOfWeek.
const _anchorDate = writable<string>(todayIso());
// Start date of the PRIMARY week — the one `selectedStartDate` and `currentWeek`
// mean, and the one week navigation moves.
const _subscribedStart = writable<string>('');
// Start date of the optional SECOND week held alongside the primary one, or ''
// for none. Purely additive: it never changes what "the current week" means.
const _extensionStart = writable<string>('');
// Per-week loading flags, keyed by start date. Absent = not loaded yet.
const _loading = writable<Record<string, boolean>>({});

export const mealPlanTemplate: Readable<MealPlanTemplate | null> = _template;
export const selectedStartDate: Readable<string> = _subscribedStart;
/** Start date of the extension week, or '' when only one week is held. */
export const extensionStartDate: Readable<string> = _extensionStart;
export const isLoadingMealPlanWeek: Readable<boolean> = derived(
  [_loading, _subscribedStart],
  ([$l, $start]) => $l[$start] ?? true,
);
export const isLoadingExtensionWeek: Readable<boolean> = derived(
  [_loading, _extensionStart],
  ([$l, $start]) => ($start ? ($l[$start] ?? true) : false),
);

// firstDayOfWeek with a 'mon' fallback until the config doc loads.
export const firstDayOfWeek: Readable<Weekday> = derived(
  _config,
  ($c) => $c?.firstDayOfWeek ?? DEFAULT_FIRST_DAY,
);

// The displayed week — falls back to an unsaved empty week (only persisted on
// first edit / load-template) so the editor always has seven days to render.
export const currentWeek: Readable<MealPlanWeek> = derived(
  [_weeks, _subscribedStart],
  ([$w, $start]) => $w[$start] ?? emptyWeek($start || todayIso()),
);

/** The extension week, or null when only one week is held. */
export const extensionWeek: Readable<MealPlanWeek | null> = derived(
  [_weeks, _extensionStart],
  ([$w, $start]) => ($start ? ($w[$start] ?? emptyWeek($start)) : null),
);

// ─── Subscriptions / navigation ───────────────────────────────────────────────

let configUnsub: (() => void) | null = null;
let templateUnsub: (() => void) | null = null;
// One subscription handle per subscribed week, keyed by start date.
const weekUnsubs = new Map<string, () => void>();
// Newest `updatedAt` we've applied PER WEEK (from a local optimistic write or an
// accepted snapshot). Guards against an in-flight stale snapshot echo landing
// after a newer local edit and reverting it (e.g. select-then-deselect chef).
// Keyed by week, and that is load-bearing: a single shared watermark would let
// one week's newer edit silently discard the other week's perfectly good
// snapshot, since the two documents' timestamps are unrelated.
const latestWeekUpdatedAt = new Map<string, string>();

// The household's first day of the week, falling back to 'mon' until the config
// snapshot lands.
//
// One synchronous source of truth on purpose: subscription targets, mutation
// targets and the shop-day week clear all resolve through THIS function, so they
// can never disagree with each other about which document a date belongs to —
// whatever value it happens to be returning. The only residual window is config
// arriving between a day being rendered and that same day being edited, which
// moves the target document under a date key already on screen; `editWeekDay`
// catches exactly that case by refusing to write a week it has not read, rather
// than clobbering it.
function firstDay(): Weekday {
  return get(_config)?.firstDayOfWeek ?? DEFAULT_FIRST_DAY;
}

function setLoading(start: string, value: boolean): void {
  _loading.update((l) => ({ ...l, [start]: value }));
}

// Subscribe to one week document. Idempotent — an already-subscribed week is a
// no-op, so callers may re-assert the set of weeks they want freely.
function subscribeWeekDoc(start: string): void {
  if (!start || weekUnsubs.has(start)) return;
  setLoading(start, true);
  weekUnsubs.set(
    start,
    subscribeMealPlanWeek(
      start,
      (w) => {
        // Drop a stale snapshot that predates a newer local edit of THIS week.
        if (w && w.updatedAt < (latestWeekUpdatedAt.get(start) ?? '')) {
          setLoading(start, false);
          return;
        }
        if (w) latestWeekUpdatedAt.set(start, w.updatedAt);
        _weeks.update((weeks) => (w ? { ...weeks, [start]: w } : without(weeks, start)));
        setLoading(start, false);
      },
      () => setLoading(start, false),
    ),
  );
}

// Drop a week entirely: stop listening and forget everything we knew about it,
// so navigating back to it shows the loading state and re-reads, exactly as a
// first visit does.
function unsubscribeWeekDoc(start: string): void {
  weekUnsubs.get(start)?.();
  weekUnsubs.delete(start);
  latestWeekUpdatedAt.delete(start);
  _weeks.update((weeks) => without(weeks, start));
  _loading.update((l) => without(l, start));
}

// Keep exactly the primary and (if set) extension weeks subscribed.
function pruneWeekSubscriptions(): void {
  const keep = new Set([get(_subscribedStart), get(_extensionStart)].filter(Boolean));
  for (const start of [...weekUnsubs.keys()]) {
    if (!keep.has(start)) unsubscribeWeekDoc(start);
  }
}

// (Re)subscribe to the week containing the anchor date under the current
// firstDayOfWeek. No-op when the start date is unchanged and already subscribed.
function syncWeekSubscription(): void {
  const start = weekStartFor(get(_anchorDate), firstDay());
  if (start !== get(_subscribedStart)) _subscribedStart.set(start);
  subscribeWeekDoc(start);
  pruneWeekSubscriptions();
}

/**
 * Hold a SECOND week alongside the primary one, or drop it with `null`.
 *
 * Additive by construction: `selectedStartDate`, `currentWeek` and week
 * navigation keep meaning the primary week. The extension week is a real
 * subscription with its own document, watermark and loading flag, so edits to
 * its dates route to its own document like any other.
 */
export function setExtensionWeek(start: string | null): void {
  const next = start ? weekStartFor(start, firstDay()) : '';
  if (next === get(_extensionStart)) return;
  _extensionStart.set(next);
  if (next) subscribeWeekDoc(next);
  pruneWeekSubscriptions();
}

export function initMealPlanSync(): () => void {
  configUnsub = subscribeMealPlanConfig(
    (c) => {
      _config.set(c);
      // firstDayOfWeek may have changed which date this week starts on.
      syncWeekSubscription();
    },
    () => {
      // Config load errors leave the last-known config (or null) in place; the
      // adapter reports per the observability gate, nothing to do here.
    },
  );
  templateUnsub = subscribeMealPlanTemplate(
    (t) => {
      _template.set(t);
    },
    () => {
      // As above — template errors leave the last-known template in place.
    },
  );
  syncWeekSubscription();
  return () => {
    configUnsub?.();
    templateUnsub?.();
    configUnsub = templateUnsub = null;
    _extensionStart.set('');
    for (const start of [...weekUnsubs.keys()]) unsubscribeWeekDoc(start);
  };
}

export function goToWeek(date: string): void {
  _anchorDate.set(date);
  syncWeekSubscription();
}

export function thisWeek(): void {
  goToWeek(todayIso());
}

export function nextWeek(): void {
  goToWeek(addDays(get(_subscribedStart) || todayIso(), 7));
}

export function prevWeek(): void {
  goToWeek(addDays(get(_subscribedStart) || todayIso(), -7));
}

// ─── Mutations ────────────────────────────────────────────────────────────────

function weekObjectFor(start: string): MealPlanWeek {
  return get(_weeks)[start] ?? emptyWeek(start);
}

function currentWeekObject(): MealPlanWeek {
  return weekObjectFor(get(_subscribedStart) || todayIso());
}

function currentTemplateObject(): MealPlanTemplate {
  return get(_template) ?? emptyTemplate();
}

// True once we can honestly claim to know what is in a week's document: either
// we hold a snapshot, or we have a live subscription that has told us (or is
// about to tell us) there is none.
function weekIsKnown(start: string): boolean {
  return weekUnsubs.has(start) || get(_weeks)[start] !== undefined;
}

/**
 * Apply a day-level edit to the document `dateKey` actually belongs in.
 *
 * The target is derived from the date key, never from what is displayed — with
 * two weeks on screen, "the subscribed week" is not an answer to "which document
 * does this day live in".
 *
 * The week must be one we know (see `weekIsKnown`). Persisting is a full-document
 * write under LWW, so writing a week we have never read would blow away its other
 * six days; refusing is the only safe answer. Reachable in principle only if
 * `firstDayOfWeek` arrives between a day being rendered and being edited — see
 * the note on `firstDay()`.
 */
function editWeekDay(
  dateKey: string,
  apply: (week: MealPlanWeek) => MealPlanWeek,
): Promise<ReadResult<void, DomainError>> {
  const start = weekStartFor(dateKey, firstDay());
  if (!weekIsKnown(start)) {
    return Promise.resolve(
      failure({
        kind: 'ValidationError',
        code: ErrorCode.WEEK_NOT_LOADED,
        message: `Refusing to write ${start}: that week has not been loaded.`,
      }),
    );
  }
  return persistWeek(apply(weekObjectFor(start)));
}

// Stamp updatedAt, update the store optimistically, then persist. The target
// document is the week's own `startDate` — the object carries where it belongs.
async function persistWeek(week: MealPlanWeek): Promise<ReadResult<void, DomainError>> {
  const stamped: MealPlanWeek = { ...week, updatedAt: new Date().toISOString() };
  latestWeekUpdatedAt.set(stamped.startDate, stamped.updatedAt);
  _weeks.update((weeks) => ({ ...weeks, [stamped.startDate]: stamped }));
  return saveMealPlanWeek(stamped);
}

async function persistTemplate(template: MealPlanTemplate): Promise<ReadResult<void, DomainError>> {
  _template.set(template);
  return saveMealPlanTemplate(template);
}

/**
 * Load the standard template into the week containing `date` (overwrites it back
 * to the standard, ready for exception-tweaking).
 *
 * Unlike the day mutators this deliberately needs no loaded document — it
 * replaces the whole week by design, so there is nothing to preserve.
 */
export function loadTemplateIntoWeek(date: string): Promise<ReadResult<void, DomainError>> {
  const start = weekStartFor(date, firstDay());
  const week = instantiateWeek(
    start,
    get(_config) ?? { firstDayOfWeek: firstDay(), schemaVersion: 1 },
    currentTemplateObject(),
  );
  return persistWeek(week);
}

/**
 * Does the week containing `date` already hold saved edits (issue #639, phase 7)?
 *
 * The load-template picker offers three weeks and warns against each one that
 * would lose work, so this must answer for weeks the planner is not showing.
 *
 * A week we HOLD is answered from the document we hold — that is the freshest
 * answer there is, since it includes an optimistic write that has not landed
 * yet. A week we do not hold is READ, one shot. Deliberately not inferred from
 * the absence of a document in memory: "we never loaded it" and "it has no
 * edits" are different facts, and confusing them overwrites a real plan without
 * warning. A read failure stays a `Failure` so the caller can say it could not
 * check, rather than implying safety (Rule 10).
 */
export async function weekHasEdits(date: string): Promise<ReadResult<boolean, DomainError>> {
  const start = weekStartFor(date, firstDay());
  const held = get(_weeks)[start];
  // `updatedAt` is stamped by every persist; the empty-week fallback carries ''.
  if (held) return success(held.updatedAt !== '');
  const read = await loadMealPlanWeek(start);
  if (read.kind !== 'ok') return read;
  return success(read.value !== null && read.value.updatedAt !== '');
}

// — Week day/attendee mutators —
// Each routes to the document its `dateKey` belongs in; see `editWeekDay`.
export function setWeekDayNote(dateKey: string, note: string) {
  return editWeekDay(dateKey, (w) => setDayNote(w, dateKey, note));
}
export function setWeekDayChefs(dateKey: string, chefs: readonly string[]) {
  return editWeekDay(dateKey, (w) => setDayChefs(w, dateKey, chefs));
}
export function setWeekDayRecipes(dateKey: string, recipeIds: readonly string[]) {
  return editWeekDay(dateKey, (w) => setDayRecipes(w, dateKey, recipeIds));
}
export function setWeekDayGuests(dateKey: string, guests: number) {
  return editWeekDay(dateKey, (w) => setDayGuests(w, dateKey, guests));
}
export function addWeekAttendee(dateKey: string, attendee: Attendee) {
  return editWeekDay(dateKey, (w) => addAttendee(w, dateKey, attendee));
}
export function removeWeekAttendee(dateKey: string, memberId: string) {
  return editWeekDay(dateKey, (w) => removeAttendee(w, dateKey, memberId));
}
export function setWeekAttendeeHomeTime(
  dateKey: string,
  memberId: string,
  homeTime: string | null,
) {
  return editWeekDay(dateKey, (w) => setAttendeeHomeTime(w, dateKey, memberId, homeTime));
}
export function setWeekAttendeeNote(dateKey: string, memberId: string, note: string) {
  return editWeekDay(dateKey, (w) => setAttendeeNote(w, dateKey, memberId, note));
}

// — Config —
export function saveFirstDayOfWeek(day: Weekday): Promise<ReadResult<void, DomainError>> {
  return saveMealPlanConfig({ firstDayOfWeek: day, schemaVersion: 1 });
}

// — Template day/attendee mutators (keyed by weekday) —
export function setTemplateDayNote(weekday: Weekday, note: string) {
  return persistTemplate(setDayNote(currentTemplateObject(), weekday, note));
}
export function setTemplateDayChefs(weekday: Weekday, chefs: readonly string[]) {
  return persistTemplate(setDayChefs(currentTemplateObject(), weekday, chefs));
}
export function setTemplateDayGuests(weekday: Weekday, guests: number) {
  return persistTemplate(setDayGuests(currentTemplateObject(), weekday, guests));
}
export function addTemplateAttendee(weekday: Weekday, attendee: Attendee) {
  return persistTemplate(addAttendee(currentTemplateObject(), weekday, attendee));
}
export function removeTemplateAttendee(weekday: Weekday, memberId: string) {
  return persistTemplate(removeAttendee(currentTemplateObject(), weekday, memberId));
}
export function setTemplateAttendeeHomeTime(
  weekday: Weekday,
  memberId: string,
  homeTime: string | null,
) {
  return persistTemplate(setAttendeeHomeTime(currentTemplateObject(), weekday, memberId, homeTime));
}
export function setTemplateAttendeeNote(weekday: Weekday, memberId: string, note: string) {
  return persistTemplate(setAttendeeNote(currentTemplateObject(), weekday, memberId, note));
}

// ─── Test / e2e helpers ───────────────────────────────────────────────────────

export function __resetMealPlanServiceForTest(): void {
  configUnsub?.();
  templateUnsub?.();
  configUnsub = templateUnsub = null;
  for (const unsub of weekUnsubs.values()) unsub();
  weekUnsubs.clear();
  latestWeekUpdatedAt.clear();
  _config.set(null);
  _template.set(null);
  _weeks.set({});
  _anchorDate.set(todayIso());
  _subscribedStart.set('');
  _extensionStart.set('');
  _loading.set({});
}

export function seedMealPlanConfig(config: MealPlanConfig | null): void {
  _config.set(config);
}

export function seedMealPlanTemplate(template: MealPlanTemplate | null): void {
  _template.set(template);
}

// Seed a concrete week as the displayed one (used by tests / e2e).
export function seedMealPlanWeek(week: MealPlanWeek): void {
  _anchorDate.set(week.startDate);
  _subscribedStart.set(week.startDate);
  seedMealPlanWeekDoc(week);
}

// Seed a week WITHOUT making it the displayed one — the second week of a
// two-week planner, so a test can prove an edit lands in the right document.
export function seedMealPlanWeekDoc(week: MealPlanWeek): void {
  latestWeekUpdatedAt.set(week.startDate, week.updatedAt);
  _weeks.update((weeks) => ({ ...weeks, [week.startDate]: week }));
  setLoading(week.startDate, false);
}

export function getMealPlanWeekSnapshot(): MealPlanWeek {
  return currentWeekObject();
}
