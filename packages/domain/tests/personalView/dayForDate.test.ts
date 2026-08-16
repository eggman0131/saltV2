import { describe, it, expect } from 'vitest';
import {
  dayForDate,
  emptyWeek,
  setDayChefs,
  setDayNote,
  type MealPlanWeek,
} from '../../src/index.js';

// The quiet screen's headline (#843). Sibling of `upcomingChefDays` and
// deliberately NOT a special case of it: that one answers "which nights are
// mine", this one answers "what is happening on this date" for anybody.

const ALEX = 'alex@e.org';
const SAM = 'sam@e.org';

describe('dayForDate', () => {
  it('returns the plan for that date', () => {
    const week = setDayNote(emptyWeek('2026-06-08'), '2026-06-10', 'something with the leeks');

    expect(dayForDate([week], '2026-06-10')?.note).toBe('something with the leeks');
  });

  it("answers for a night that is somebody else's", () => {
    // The whole point. Filtering by chef would blank the screen on precisely the
    // evenings someone else has it covered — not a quieter answer, a wrong one.
    const week = setDayChefs(emptyWeek('2026-06-08'), '2026-06-10', [SAM]);

    expect(dayForDate([week], '2026-06-10')?.chefs).toEqual([SAM]);
  });

  it('spans whichever weeks the caller is holding', () => {
    const thisWeek = setDayNote(emptyWeek('2026-06-08'), '2026-06-09', 'ragu');
    const nextWeek = setDayNote(emptyWeek('2026-06-15'), '2026-06-16', 'focaccia');

    expect(dayForDate([thisWeek, nextWeek], '2026-06-16')?.note).toBe('focaccia');
  });

  it('is null for a date no held week covers', () => {
    const week = emptyWeek('2026-06-08');

    expect(dayForDate([week], '2026-07-30')).toBeNull();
  });

  it('is null for an empty date key rather than guessing', () => {
    // `kitchenAnchorDate` is '' while the slot is empty; a page must not get a
    // dinner out of "we do not know what day it is".
    expect(dayForDate([emptyWeek('2026-06-08')], '')).toBeNull();
  });

  it('lets the first week holding a date win, matching upcomingChefDays', () => {
    // Two documents can disagree about which week owns a date once
    // `firstDayOfWeek` has moved. Both projections have to resolve that the same
    // way or the headline and the list would name different dinners.
    const first = setDayNote(emptyWeek('2026-06-08'), '2026-06-14', 'from the earlier doc');
    const second = setDayNote(emptyWeek('2026-06-14'), '2026-06-14', 'from the later doc');

    expect(dayForDate([first, second], '2026-06-14')?.note).toBe('from the earlier doc');
  });

  it('reads stored keys, not the seven a start date implies', () => {
    // A document written before `firstDayOfWeek` moved holds the keys current
    // when it was saved, so a computed cycle can ask for keys that are not there.
    const week = setDayNote(emptyWeek('2026-06-08'), '2026-06-21', 'written under an old cycle');

    expect(dayForDate([week], '2026-06-21')?.note).toBe('written under an old cycle');
  });

  it('is null when no weeks are held at all', () => {
    expect(dayForDate([], '2026-06-10')).toBeNull();
  });
});

// Guard the shape the page relies on: a day it can render without a null check
// on every field.
describe('dayForDate — the shape the headline reads', () => {
  it('carries recipeIds, note and chefs together', () => {
    const week: MealPlanWeek = setDayChefs(
      setDayNote(emptyWeek('2026-06-08'), '2026-06-10', 'a note'),
      '2026-06-10',
      [ALEX],
    );
    const day = dayForDate([week], '2026-06-10');

    expect(day).not.toBeNull();
    expect(Array.isArray(day?.recipeIds)).toBe(true);
    expect(day?.note).toBe('a note');
    expect(day?.chefs).toEqual([ALEX]);
  });
});
