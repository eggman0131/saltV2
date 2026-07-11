import { describe, it, expect } from 'vitest';
import {
  WEEKDAYS,
  weekStartFor,
  weekDates,
  weekdayOf,
  emptyDay,
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
  type Weekday,
} from '@salt/domain';

const config = (firstDayOfWeek: Weekday): MealPlanConfig => ({
  firstDayOfWeek,
  schemaVersion: 1,
});

describe('weekdayOf', () => {
  it('maps known dates to their weekday', () => {
    // 2026-06-08 is a Monday; the following six days walk the week.
    expect(weekdayOf('2026-06-08')).toBe('mon');
    expect(weekdayOf('2026-06-09')).toBe('tue');
    expect(weekdayOf('2026-06-13')).toBe('sat');
    expect(weekdayOf('2026-06-14')).toBe('sun');
  });
});

describe('weekStartFor', () => {
  // 2026-06-10 is a Wednesday.
  it('finds the Monday-start of a midweek date', () => {
    expect(weekStartFor('2026-06-10', 'mon')).toBe('2026-06-08');
  });

  it('returns the date itself when it is already the start day', () => {
    expect(weekStartFor('2026-06-08', 'mon')).toBe('2026-06-08');
  });

  it('handles every firstDayOfWeek for the same Wednesday', () => {
    // Wed 2026-06-10. The start is the most recent occurrence of firstDayOfWeek.
    expect(weekStartFor('2026-06-10', 'mon')).toBe('2026-06-08');
    expect(weekStartFor('2026-06-10', 'tue')).toBe('2026-06-09');
    expect(weekStartFor('2026-06-10', 'wed')).toBe('2026-06-10');
    expect(weekStartFor('2026-06-10', 'thu')).toBe('2026-06-04');
    expect(weekStartFor('2026-06-10', 'fri')).toBe('2026-06-05');
    expect(weekStartFor('2026-06-10', 'sat')).toBe('2026-06-06');
    expect(weekStartFor('2026-06-10', 'sun')).toBe('2026-06-07');
  });

  it('crosses a month boundary correctly', () => {
    // Wed 2026-07-01 with a Friday start day → previous Friday is 2026-06-26.
    expect(weekStartFor('2026-07-01', 'fri')).toBe('2026-06-26');
  });

  it('accepts a Date and uses its local calendar day', () => {
    const d = new Date(2026, 5, 10); // local Wed 2026-06-10
    expect(weekStartFor(d, 'mon')).toBe('2026-06-08');
  });
});

describe('weekDates', () => {
  it('returns seven consecutive dates from the start', () => {
    expect(weekDates('2026-06-08')).toEqual([
      '2026-06-08',
      '2026-06-09',
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
    ]);
  });
});

describe('emptyDay / emptyWeek / emptyTemplate', () => {
  it('emptyDay is fully blank', () => {
    expect(emptyDay()).toEqual({ note: '', recipeIds: [], chefs: [], attendees: [], guests: 0 });
  });

  it('emptyTemplate has all seven weekdays blank', () => {
    const t = emptyTemplate();
    expect(Object.keys(t.days).sort()).toEqual([...WEEKDAYS].sort());
    for (const wd of WEEKDAYS) expect(t.days[wd]).toEqual(emptyDay());
  });

  it('emptyWeek is keyed by its seven dates with a blank updatedAt', () => {
    const w = emptyWeek('2026-06-08');
    expect(w.id).toBe('2026-06-08');
    expect(w.startDate).toBe('2026-06-08');
    expect(w.updatedAt).toBe('');
    expect(Object.keys(w.days)).toEqual(weekDates('2026-06-08'));
  });
});

describe('instantiateWeek', () => {
  function templateWithLabels(): MealPlanTemplate {
    const days = Object.fromEntries(
      WEEKDAYS.map((wd) => [wd, { ...emptyDay(), note: `usual-${wd}` }]),
    );
    return { schemaVersion: 1, days: days as MealPlanTemplate['days'] };
  }

  it('copies each weekday template day onto the matching dated day (Monday start)', () => {
    const week = instantiateWeek('2026-06-08', config('mon'), templateWithLabels());
    expect(week.days['2026-06-08']!.note).toBe('usual-mon');
    expect(week.days['2026-06-14']!.note).toBe('usual-sun');
  });

  it('maps weekdays correctly when firstDayOfWeek is not Monday', () => {
    // Friday start: 2026-06-12 is a Friday.
    const week = instantiateWeek('2026-06-12', config('fri'), templateWithLabels());
    expect(week.startDate).toBe('2026-06-12');
    expect(week.days['2026-06-12']!.note).toBe('usual-fri');
    expect(week.days['2026-06-13']!.note).toBe('usual-sat');
    expect(week.days['2026-06-18']!.note).toBe('usual-thu');
  });

  it('normalises a midweek startDate to the true week start', () => {
    const week = instantiateWeek('2026-06-10', config('mon'), templateWithLabels());
    expect(week.id).toBe('2026-06-08');
    expect(week.startDate).toBe('2026-06-08');
  });

  it('deep-copies template days (no shared array references)', () => {
    const template = emptyTemplate();
    const week = instantiateWeek('2026-06-08', config('mon'), template);
    expect(week.days['2026-06-08']!.chefs).not.toBe(template.days.mon.chefs);
  });
});

describe('day mutators (immutability + correctness)', () => {
  const base = emptyWeek('2026-06-08');
  const key = '2026-06-08';
  const attendee: Attendee = { memberId: 'a@x.org', homeTime: '18:00', note: '' };

  it('setDayNote sets the note and does not mutate the input', () => {
    const next = setDayNote(base, key, 'pasta');
    expect(next.days[key]!.note).toBe('pasta');
    expect(base.days[key]!.note).toBe('');
  });

  it('setDayChefs replaces chefs with a fresh array', () => {
    const next = setDayChefs(base, key, ['a@x.org', 'b@x.org']);
    expect(next.days[key]!.chefs).toEqual(['a@x.org', 'b@x.org']);
    expect(base.days[key]!.chefs).toEqual([]);
  });

  it('setDayRecipes replaces recipeIds with a fresh array and does not mutate the input', () => {
    const next = setDayRecipes(base, key, ['r1', 'r2']);
    expect(next.days[key]!.recipeIds).toEqual(['r1', 'r2']);
    // fresh array, not the caller's reference
    const src = ['r3'];
    expect(setDayRecipes(base, key, src).days[key]!.recipeIds).not.toBe(src);
    // input untouched
    expect(base.days[key]!.recipeIds).toEqual([]);
  });

  it('setDayGuests sets a non-negative integer count and clamps junk to 0', () => {
    expect(setDayGuests(base, key, 3).days[key]!.guests).toBe(3);
    expect(setDayGuests(base, key, -2).days[key]!.guests).toBe(0);
    expect(setDayGuests(base, key, 2.9).days[key]!.guests).toBe(2);
    expect(base.days[key]!.guests).toBe(0);
  });

  it('addAttendee appends and is idempotent on memberId', () => {
    const once = addAttendee(base, key, attendee);
    const twice = addAttendee(once, key, { ...attendee, homeTime: '19:30' });
    expect(twice.days[key]!.attendees).toHaveLength(1);
    expect(twice.days[key]!.attendees[0]!.homeTime).toBe('19:30');
    expect(base.days[key]!.attendees).toHaveLength(0);
  });

  it('removeAttendee drops the matching member', () => {
    const withA = addAttendee(base, key, attendee);
    const without = removeAttendee(withA, key, 'a@x.org');
    expect(without.days[key]!.attendees).toHaveLength(0);
  });

  it('setAttendeeHomeTime round-trips a blank time as null', () => {
    const withA = addAttendee(base, key, attendee);
    const blanked = setAttendeeHomeTime(withA, key, 'a@x.org', null);
    expect(blanked.days[key]!.attendees[0]!.homeTime).toBeNull();
    // input untouched
    expect(withA.days[key]!.attendees[0]!.homeTime).toBe('18:00');
  });

  it('setAttendeeNote updates only the per-person note', () => {
    const withA = addAttendee(base, key, attendee);
    const noted = setAttendeeNote(withA, key, 'a@x.org', 'portion for tomorrow');
    expect(noted.days[key]!.attendees[0]!.note).toBe('portion for tomorrow');
    expect(noted.days[key]!.attendees[0]!.homeTime).toBe('18:00');
  });

  it('mutators also operate on a template keyed by weekday', () => {
    const template = emptyTemplate();
    const next = setDayNote(template, 'fri', 'pizza');
    expect(next.days.fri.note).toBe('pizza');
    expect(template.days.fri.note).toBe('');
  });
});
