// Pure calendar-date helpers for the shop day (issue #629). No I/O and no clock
// (CLAUDE.md Rule 1) — `now` is always injected by the caller.
//
// Used by the daily reminder, which must answer "what is tomorrow's date in
// Europe/London" from a UTC instant. `Intl.DateTimeFormat` is an ECMA-402
// built-in available in both runtimes (never a Node or browser API), and it is
// the only correct way to project an instant onto a zone's calendar.

/**
 * The calendar date (`YYYY-MM-DD`) that the instant `now` falls on in `timeZone`.
 *
 * `en-CA` renders ISO-ordered `YYYY-MM-DD` — the same trick the planner already
 * uses for local "today" — so no part-reassembly is needed.
 */
export function dateInZone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Whole calendar days from `from` to `to`, both `YYYY-MM-DD`. Negative when `to`
 * is the earlier date, `0` when they are the same day.
 *
 * Drives the shopping list's "today / tomorrow / Sat" phrasing. Same UTC,
 * date-only arithmetic as `addCalendarDays`, so a 23- or 25-hour local day
 * cannot round the answer off by one.
 */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}

/**
 * Shift a `YYYY-MM-DD` calendar date by `n` whole days.
 *
 * Arithmetic runs in UTC on a date-only value, so it is immune to DST: a zone
 * that gains or loses an hour still has exactly one calendar day per date, and
 * that is the only thing being counted here.
 */
export function addCalendarDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Tomorrow's calendar date in `timeZone`, as of the instant `now`.
 *
 * Deliberately "project the instant onto the zone's calendar, THEN add a day"
 * rather than "add 24 hours, then project": adding 24h to an instant lands on the
 * wrong wall-clock hour across a DST transition, and while the reminder's 17:00
 * firing time has an hour of slack either way, the two-step form has none to
 * spend and reads as what it means. Year rollover falls out of the same UTC
 * date arithmetic.
 */
export function tomorrowInZone(now: Date, timeZone: string): string {
  return addCalendarDays(dateInZone(now, timeZone), 1);
}
