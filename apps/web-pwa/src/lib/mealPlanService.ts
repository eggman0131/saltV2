import {
  subscribeMealPlanConfig,
  subscribeMealPlanTemplate,
  subscribeMealPlanWeek,
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
import type { DomainError, ReadResult } from '@salt/shared-types';
import { writable, derived, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

// Meal planning service (issue #169). Subscribes to the two singletons (config +
// template) once and to the currently-selected week, re-subscribing as the user
// navigates. Domain commands compute new documents; the adapter persists them.
// See docs/meal-planning.md.

const DEFAULT_FIRST_DAY: Weekday = 'mon';

// ─── Local date helpers (date-only YYYY-MM-DD, UTC arithmetic) ────────────────

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── Reactive stores ──────────────────────────────────────────────────────────

const _config = writable<MealPlanConfig | null>(null);
const _template = writable<MealPlanTemplate | null>(null);
const _week = writable<MealPlanWeek | null>(null);
// The anchor date the user is viewing; the displayed week is the one containing
// it under the current firstDayOfWeek.
const _anchorDate = writable<string>(todayIso());
// Start date of the week currently subscribed/displayed.
const _subscribedStart = writable<string>('');

const _isLoadingConfig = writable(true);
const _isLoadingTemplate = writable(true);
const _isLoadingWeek = writable(true);

export const mealPlanConfig: Readable<MealPlanConfig | null> = _config;
export const mealPlanTemplate: Readable<MealPlanTemplate | null> = _template;
export const selectedStartDate: Readable<string> = _subscribedStart;
export const isLoadingMealPlanConfig: Readable<boolean> = _isLoadingConfig;
export const isLoadingMealPlanTemplate: Readable<boolean> = _isLoadingTemplate;
export const isLoadingMealPlanWeek: Readable<boolean> = _isLoadingWeek;

// firstDayOfWeek with a 'mon' fallback until the config doc loads.
export const firstDayOfWeek: Readable<Weekday> = derived(
  _config,
  ($c) => $c?.firstDayOfWeek ?? DEFAULT_FIRST_DAY,
);

// The displayed week — falls back to an unsaved empty week (only persisted on
// first edit / load-template) so the editor always has seven days to render.
export const currentWeek: Readable<MealPlanWeek> = derived(
  [_week, _subscribedStart],
  ([$w, $start]) => $w ?? emptyWeek($start || todayIso()),
);

// ─── Subscriptions / navigation ───────────────────────────────────────────────

let configUnsub: (() => void) | null = null;
let templateUnsub: (() => void) | null = null;
let weekUnsub: (() => void) | null = null;
// Newest week `updatedAt` we've applied (from a local optimistic write or an
// accepted snapshot). Guards against an in-flight stale snapshot echo landing
// after a newer local edit and reverting it (e.g. select-then-deselect chef).
let latestWeekUpdatedAt = '';

function firstDay(): Weekday {
  return get(_config)?.firstDayOfWeek ?? DEFAULT_FIRST_DAY;
}

// (Re)subscribe to the week containing the anchor date under the current
// firstDayOfWeek. No-op when the start date is unchanged.
function syncWeekSubscription(): void {
  const start = weekStartFor(get(_anchorDate), firstDay());
  if (start === get(_subscribedStart) && weekUnsub) return;
  weekUnsub?.();
  _subscribedStart.set(start);
  _week.set(null);
  latestWeekUpdatedAt = '';
  _isLoadingWeek.set(true);
  weekUnsub = subscribeMealPlanWeek(
    start,
    (w) => {
      // Drop a stale snapshot that predates a newer local edit of this week.
      if (w && w.updatedAt < latestWeekUpdatedAt) {
        _isLoadingWeek.set(false);
        return;
      }
      if (w) latestWeekUpdatedAt = w.updatedAt;
      _week.set(w);
      _isLoadingWeek.set(false);
    },
    () => _isLoadingWeek.set(false),
  );
}

export function initMealPlanSync(): () => void {
  _isLoadingConfig.set(true);
  _isLoadingTemplate.set(true);
  configUnsub = subscribeMealPlanConfig(
    (c) => {
      _config.set(c);
      _isLoadingConfig.set(false);
      // firstDayOfWeek may have changed which date this week starts on.
      syncWeekSubscription();
    },
    () => _isLoadingConfig.set(false),
  );
  templateUnsub = subscribeMealPlanTemplate(
    (t) => {
      _template.set(t);
      _isLoadingTemplate.set(false);
    },
    () => _isLoadingTemplate.set(false),
  );
  syncWeekSubscription();
  return () => {
    configUnsub?.();
    templateUnsub?.();
    weekUnsub?.();
    configUnsub = templateUnsub = weekUnsub = null;
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

function currentWeekObject(): MealPlanWeek {
  return get(_week) ?? emptyWeek(get(_subscribedStart) || todayIso());
}

function currentTemplateObject(): MealPlanTemplate {
  return get(_template) ?? emptyTemplate();
}

// Stamp updatedAt, update the store optimistically, then persist.
async function persistWeek(week: MealPlanWeek): Promise<ReadResult<void, DomainError>> {
  const stamped: MealPlanWeek = { ...week, updatedAt: new Date().toISOString() };
  latestWeekUpdatedAt = stamped.updatedAt;
  _week.set(stamped);
  return saveMealPlanWeek(stamped);
}

async function persistTemplate(template: MealPlanTemplate): Promise<ReadResult<void, DomainError>> {
  _template.set(template);
  return saveMealPlanTemplate(template);
}

// Load the standard template into the current week (overwrites it back to the
// standard, ready for exception-tweaking).
export function loadTemplateIntoCurrentWeek(): Promise<ReadResult<void, DomainError>> {
  const start = get(_subscribedStart) || todayIso();
  const week = instantiateWeek(
    start,
    get(_config) ?? { firstDayOfWeek: firstDay(), schemaVersion: 1 },
    currentTemplateObject(),
  );
  return persistWeek(week);
}

// — Week day/attendee mutators —
export function setWeekDayNote(dateKey: string, note: string) {
  return persistWeek(setDayNote(currentWeekObject(), dateKey, note));
}
export function setWeekDayChefs(dateKey: string, chefs: readonly string[]) {
  return persistWeek(setDayChefs(currentWeekObject(), dateKey, chefs));
}
export function setWeekDayRecipes(dateKey: string, recipeIds: readonly string[]) {
  return persistWeek(setDayRecipes(currentWeekObject(), dateKey, recipeIds));
}
export function setWeekDayGuests(dateKey: string, guests: number) {
  return persistWeek(setDayGuests(currentWeekObject(), dateKey, guests));
}
export function addWeekAttendee(dateKey: string, attendee: Attendee) {
  return persistWeek(addAttendee(currentWeekObject(), dateKey, attendee));
}
export function removeWeekAttendee(dateKey: string, memberId: string) {
  return persistWeek(removeAttendee(currentWeekObject(), dateKey, memberId));
}
export function setWeekAttendeeHomeTime(
  dateKey: string,
  memberId: string,
  homeTime: string | null,
) {
  return persistWeek(setAttendeeHomeTime(currentWeekObject(), dateKey, memberId, homeTime));
}
export function setWeekAttendeeNote(dateKey: string, memberId: string, note: string) {
  return persistWeek(setAttendeeNote(currentWeekObject(), dateKey, memberId, note));
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
  weekUnsub?.();
  configUnsub = templateUnsub = weekUnsub = null;
  latestWeekUpdatedAt = '';
  _config.set(null);
  _template.set(null);
  _week.set(null);
  _anchorDate.set(todayIso());
  _subscribedStart.set('');
  _isLoadingConfig.set(true);
  _isLoadingTemplate.set(true);
  _isLoadingWeek.set(true);
}

export function seedMealPlanConfig(config: MealPlanConfig | null): void {
  _config.set(config);
  _isLoadingConfig.set(false);
}

export function seedMealPlanTemplate(template: MealPlanTemplate | null): void {
  _template.set(template);
  _isLoadingTemplate.set(false);
}

// Seed a concrete week as the displayed one (used by tests / e2e).
export function seedMealPlanWeek(week: MealPlanWeek): void {
  _anchorDate.set(week.startDate);
  _subscribedStart.set(week.startDate);
  latestWeekUpdatedAt = week.updatedAt;
  _week.set(week);
  _isLoadingWeek.set(false);
}

export function getMealPlanWeekSnapshot(): MealPlanWeek {
  return currentWeekObject();
}
