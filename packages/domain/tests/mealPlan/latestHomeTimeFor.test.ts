import { describe, it, expect } from 'vitest';
import {
  addAttendee,
  emptyWeek,
  latestHomeTimeFor,
  setDayRecipes,
  type MealPlanWeek,
} from '../../src/index.js';

// The default a meal's cook plan seeds its serve time from (issue #752, phase 4):
// the last person home on the night this dish is planned for. Pure — the date key
// is injected, exactly as `today` is for `upcomingChefDays`.

const WEEK_START = '2026-08-10';
const TONIGHT = '2026-08-16';
const ROAST = 'roast-1';

function nightWith(
  recipeIds: string[],
  attendees: Array<{ memberId: string; homeTime: string | null }>,
): MealPlanWeek {
  return attendees.reduce(
    (w, a) => addAttendee(w, TONIGHT, { ...a, note: '' }),
    setDayRecipes(emptyWeek(WEEK_START), TONIGHT, recipeIds),
  );
}

describe('latestHomeTimeFor', () => {
  it('picks the LATEST home time — the earliest moment everybody can sit down', () => {
    const week = nightWith(
      [ROAST],
      [
        { memberId: 'alex@e.org', homeTime: '18:15' },
        { memberId: 'sam@e.org', homeTime: '19:45' },
        { memberId: 'jo@e.org', homeTime: '09:30' },
      ],
    );
    expect(latestHomeTimeFor([week], ROAST, TONIGHT)).toBe('19:45');
  });

  it('compares zero-padded "HH:mm" lexicographically, which IS chronologically', () => {
    // 09:05 must not beat 18:15 on string length or first digit.
    const week = nightWith(
      [ROAST],
      [
        { memberId: 'alex@e.org', homeTime: '09:05' },
        { memberId: 'sam@e.org', homeTime: '18:15' },
      ],
    );
    expect(latestHomeTimeFor([week], ROAST, TONIGHT)).toBe('18:15');
  });

  it('is null when the dish is not planned on that day at all', () => {
    const week = nightWith(['something-else'], [{ memberId: 'alex@e.org', homeTime: '19:45' }]);
    expect(latestHomeTimeFor([week], ROAST, TONIGHT)).toBeNull();
  });

  it('is null when the night has no attendees', () => {
    expect(latestHomeTimeFor([nightWith([ROAST], [])], ROAST, TONIGHT)).toBeNull();
  });

  it('is null when every attendee is coming at an unknown time', () => {
    // A null homeTime is "attending, time unknown" — a valid saved state that
    // simply does not get a vote, never a zero.
    const week = nightWith(
      [ROAST],
      [
        { memberId: 'alex@e.org', homeTime: null },
        { memberId: 'sam@e.org', homeTime: null },
      ],
    );
    expect(latestHomeTimeFor([week], ROAST, TONIGHT)).toBeNull();
  });

  it('ignores the attendees with no time and answers from the ones that have one', () => {
    const week = nightWith(
      [ROAST],
      [
        { memberId: 'alex@e.org', homeTime: null },
        { memberId: 'sam@e.org', homeTime: '18:30' },
      ],
    );
    expect(latestHomeTimeFor([week], ROAST, TONIGHT)).toBe('18:30');
  });

  it('is null when no week held covers that date', () => {
    const week = nightWith([ROAST], [{ memberId: 'alex@e.org', homeTime: '19:45' }]);
    expect(latestHomeTimeFor([week], ROAST, '2026-09-01')).toBeNull();
    expect(latestHomeTimeFor([], ROAST, TONIGHT)).toBeNull();
  });

  it('spans whatever weeks the caller is holding', () => {
    const other = emptyWeek('2026-08-03');
    const week = nightWith([ROAST], [{ memberId: 'alex@e.org', homeTime: '20:15' }]);
    expect(latestHomeTimeFor([other, week], ROAST, TONIGHT)).toBe('20:15');
  });

  it('does not mutate the weeks it reads', () => {
    const week = nightWith([ROAST], [{ memberId: 'alex@e.org', homeTime: '19:45' }]);
    const before = JSON.stringify(week);
    latestHomeTimeFor([week], ROAST, TONIGHT);
    expect(JSON.stringify(week)).toBe(before);
  });
});
