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

// The seven consecutive "YYYY-MM-DD" date keys of a week starting at `startDate`.
export function weekDates(startDate: string): string[] {
  const start = toUtcDate(startDate);
  return Array.from({ length: 7 }, (_unused, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return formatUtc(d);
  });
}
