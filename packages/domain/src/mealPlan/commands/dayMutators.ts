import type { Attendee, Day } from '../entities/Day.js';

// Day mutators operate on a "day container" — either a MealPlanWeek (date-keyed)
// or a MealPlanTemplate (weekday-keyed). They are generic over the key type so a
// week is mutated with a "YYYY-MM-DD" key and a template with a weekday key,
// while sharing one implementation. All return a new container and never mutate
// the input (pure, time-free — the service stamps `updatedAt` on save).

type DayContainer<K extends string> = { readonly days: Readonly<Record<K, Day>> };

function withDay<K extends string, T extends DayContainer<K>>(
  container: T,
  dayKey: K,
  update: (day: Day) => Day,
): T {
  const next = update(container.days[dayKey]);
  return { ...container, days: { ...container.days, [dayKey]: next } } as T;
}

function withAttendee(day: Day, memberId: string, update: (a: Attendee) => Attendee): Day {
  return {
    ...day,
    attendees: day.attendees.map((a) => (a.memberId === memberId ? update(a) : a)),
  };
}

export function setDayNote<K extends string, T extends DayContainer<K>>(
  container: T,
  dayKey: K,
  note: string,
): T {
  return withDay(container, dayKey, (day) => ({ ...day, note }));
}

export function setDayChefs<K extends string, T extends DayContainer<K>>(
  container: T,
  dayKey: K,
  chefs: readonly string[],
): T {
  return withDay(container, dayKey, (day) => ({ ...day, chefs: [...chefs] }));
}

// Set the count of extra unnamed guests. Negative inputs are clamped to 0.
export function setDayGuests<K extends string, T extends DayContainer<K>>(
  container: T,
  dayKey: K,
  guests: number,
): T {
  return withDay(container, dayKey, (day) => ({ ...day, guests: Math.max(0, Math.trunc(guests)) }));
}

// Add an attendee. Idempotent on memberId: an existing entry for the same member
// is replaced, so a member can never appear twice.
export function addAttendee<K extends string, T extends DayContainer<K>>(
  container: T,
  dayKey: K,
  attendee: Attendee,
): T {
  return withDay(container, dayKey, (day) => ({
    ...day,
    attendees: [...day.attendees.filter((a) => a.memberId !== attendee.memberId), { ...attendee }],
  }));
}

export function removeAttendee<K extends string, T extends DayContainer<K>>(
  container: T,
  dayKey: K,
  memberId: string,
): T {
  return withDay(container, dayKey, (day) => ({
    ...day,
    attendees: day.attendees.filter((a) => a.memberId !== memberId),
  }));
}

// Set an attendee's home time. `null` (blank) is a valid saved state.
export function setAttendeeHomeTime<K extends string, T extends DayContainer<K>>(
  container: T,
  dayKey: K,
  memberId: string,
  homeTime: string | null,
): T {
  return withDay(container, dayKey, (day) =>
    withAttendee(day, memberId, (a) => ({ ...a, homeTime })),
  );
}

export function setAttendeeNote<K extends string, T extends DayContainer<K>>(
  container: T,
  dayKey: K,
  memberId: string,
  note: string,
): T {
  return withDay(container, dayKey, (day) => withAttendee(day, memberId, (a) => ({ ...a, note })));
}
