import type { Weekday } from '../entities/Weekday.js';
import { WEEKDAYS } from '../entities/Weekday.js';

// Monday-first index of each weekday (mon = 0 … sun = 6).
export const WEEKDAY_INDEX: Readonly<Record<Weekday, number>> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

// Parse a date-only "YYYY-MM-DD" string as a UTC instant. All week arithmetic is
// done in UTC so it never drifts across DST or the local timezone.
function toUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

// Format a Date back to its UTC "YYYY-MM-DD" calendar day.
function formatUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Monday-first index (0–6) of any UTC Date.
function mondayFirstIndex(d: Date): number {
  // getUTCDay: 0 = Sun … 6 = Sat. Shift so Monday = 0.
  return (d.getUTCDay() + 6) % 7;
}

// The weekday name of a "YYYY-MM-DD" date.
export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[mondayFirstIndex(toUtcDate(date))]!;
}

// The "YYYY-MM-DD" start date of the week containing `date`, where weeks start
// on `firstDayOfWeek`. Accepts a Date (its local calendar day is used) or a
// "YYYY-MM-DD" string.
export function weekStartFor(date: Date | string, firstDayOfWeek: Weekday): string {
  const d =
    typeof date === 'string'
      ? toUtcDate(date)
      : new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const diff = (mondayFirstIndex(d) - WEEKDAY_INDEX[firstDayOfWeek] + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return formatUtc(d);
}

// The 0–6 position of `date` within the week starting at `startDate`, or -1 when
// it falls outside that week (or either string is not a date).
//
// This is the "does this week contain today?" test — `>= 0` — and, in the same
// number, the count of days that sit above `date` in the week (issue #639: the
// planner opens on today, with that many earlier days scrollable above it).
// Pure by contract: there is no clock in domain, so the caller supplies today.
export function dayIndexInWeek(startDate: string, date: string): number {
  const diff = Math.round(
    (toUtcDate(date).getTime() - toUtcDate(startDate).getTime()) / 86_400_000,
  );
  return Number.isFinite(diff) && diff >= 0 && diff < 7 ? diff : -1;
}

// How close to the END of a cycle the planner starts showing the next one
// (issue #639). Deliberately expressed as a position in the CYCLE rather than as
// the literal weekday "Wednesday": what makes Wednesday the trigger is that it is
// the penultimate day of a Friday-start week, and `firstDayOfWeek` is a
// configurable admin setting. Move the first day of the week and the trigger
// moves with it — which is the intent, because "the week you need is the one you
// are not looking at" is a fact about the shop and the plan, both of which sit at
// the end of the cycle, not about Wednesday.
export const WEEK_EXTENSION_DAYS = 2;

// Does the week starting `startDate` show the whole of next week beneath it?
//
// True only for TODAY's week, and only once today has reached the last
// `WEEK_EXTENSION_DAYS` days of it. Every other week shows alone — the extension
// belongs to today's week, not to whatever the user navigated to.
//
// Pure by contract: there is no clock in domain, so the caller supplies today.
export function weekExtendsIntoNext(
  startDate: string,
  today: string,
  firstDayOfWeek: Weekday,
): boolean {
  // "Contains today" is asked of the CYCLE, not of the two strings: a startDate
  // that is not a week start under `firstDayOfWeek` is not today's week at all,
  // whatever its distance from today happens to be.
  if (weekStartFor(today, firstDayOfWeek) !== startDate) return false;
  return dayIndexInWeek(startDate, today) >= 7 - WEEK_EXTENSION_DAYS;
}

// How many weeks the planner offers to fill from the standard template
// (issue #639): this week, next week, and the week after next — "week
// commencing", the one week further out worth templating early.
export const TEMPLATE_WEEK_OFFERS = 3;

// The start dates, in offer order, of the weeks the load-template picker offers.
//
// Start dates only: what each one is CALLED ("This week", "Next week", "Week
// commencing") and how its dates are formatted are presentation, and stay in the
// page. What is domain is that the three are consecutive cycles anchored on the
// week that contains today — so they follow `firstDayOfWeek` like every other
// week in the planner, and the picker can never offer a date that is not the
// first day of a real document.
//
// Pure by contract: there is no clock in domain, so the caller supplies today.
export function templateWeekStarts(today: string, firstDayOfWeek: Weekday): string[] {
  const start = toUtcDate(weekStartFor(today, firstDayOfWeek));
  return Array.from({ length: TEMPLATE_WEEK_OFFERS }, (_unused, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i * 7);
    return formatUtc(d);
  });
}

// The seven consecutive "YYYY-MM-DD" date keys of a week starting at `startDate`.
export function weekDates(startDate: string): string[] {
  const start = toUtcDate(startDate);
  return Array.from({ length: 7 }, (_unused, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return formatUtc(d);
  });
}
