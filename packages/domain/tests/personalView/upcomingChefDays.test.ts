import { describe, it, expect } from 'vitest';
import { upcomingChefDays, emptyWeek, setDayChefs, type MealPlanWeek } from '../../src/index.js';

// The projection behind "Cooking soon" (#755). The decision under test is the
// WINDOW (from today onward) and the SPAN (across whatever weeks are held) —
// membership itself is just `chefs.includes`.

const ALEX = 'alex@e.org';
const SAM = 'sam@e.org';

// A Monday-start week with the named member down to cook on each of `dates`.
function weekWithChef(start: string, memberId: string, dates: string[]): MealPlanWeek {
  return dates.reduce((w, d) => setDayChefs(w, d, [memberId]), emptyWeek(start));
}

describe('upcomingChefDays', () => {
  it('lists my nights from today onward, in date order', () => {
    const week = weekWithChef('2026-06-08', ALEX, ['2026-06-09', '2026-06-13', '2026-06-11']);

    expect(upcomingChefDays([week], ALEX, '2026-06-08').map((n) => n.date)).toEqual([
      '2026-06-09',
      '2026-06-11',
      '2026-06-13',
    ]);
  });

  it('drops the nights that have already been — today itself is still ahead', () => {
    // The boundary is `>=`: it is only tonight's dinner once, and it is still
    // yours to cook at 6pm on the day.
    const week = weekWithChef('2026-06-08', ALEX, ['2026-06-08', '2026-06-10', '2026-06-12']);

    expect(upcomingChefDays([week], ALEX, '2026-06-10').map((n) => n.date)).toEqual([
      '2026-06-10',
      '2026-06-12',
    ]);
  });

  it('spans the week boundary without a merge step above it', () => {
    // The whole reason it takes an array: in the last days of a cycle the nights
    // you need are in the document you are not looking at.
    const thisWeek = weekWithChef('2026-06-08', ALEX, ['2026-06-13']);
    const nextWeek = weekWithChef('2026-06-15', ALEX, ['2026-06-16', '2026-06-19']);

    expect(upcomingChefDays([thisWeek, nextWeek], ALEX, '2026-06-12').map((n) => n.date)).toEqual([
      '2026-06-13',
      '2026-06-16',
      '2026-06-19',
    ]);
  });

  it('matches nothing at all for an empty memberId', () => {
    // Nobody resolved yet (roster still loading, or no member matches the
    // sign-in). A screen claiming every night was yours would be worse than one
    // claiming none.
    const week = weekWithChef('2026-06-08', ALEX, ['2026-06-09', '2026-06-10']);
    expect(upcomingChefDays([week], '', '2026-06-08')).toEqual([]);
  });

  it('leaves out somebody else’s nights', () => {
    const week = setDayChefs(weekWithChef('2026-06-08', ALEX, ['2026-06-09']), '2026-06-10', [SAM]);

    expect(upcomingChefDays([week], ALEX, '2026-06-08').map((n) => n.date)).toEqual(['2026-06-09']);
  });

  it('counts a chef who is not at the table — cooking is not eating', () => {
    // `attendees` is deliberately not consulted: cooking for a household you are
    // not eating with is an ordinary Tuesday, and an attendance filter would drop
    // exactly those nights.
    const week = weekWithChef('2026-06-08', ALEX, ['2026-06-09']);
    expect(week.days['2026-06-09']!.attendees).toEqual([]);
    expect(upcomingChefDays([week], ALEX, '2026-06-08').map((n) => n.date)).toEqual(['2026-06-09']);
  });

  it('reads the keys a week was STORED with, not the ones its start implies', () => {
    // A Sunday-start document read back after firstDayOfWeek moved to Monday: its
    // date keys no longer line up with the computed cycle. Iterating the computed
    // dates would find holes; iterating what is stored cannot.
    const stored = weekWithChef('2026-06-07', ALEX, ['2026-06-07', '2026-06-13']);
    const relabelled: MealPlanWeek = { ...stored, startDate: '2026-06-08', id: '2026-06-08' };

    expect(upcomingChefDays([relabelled], ALEX, '2026-06-07').map((n) => n.date)).toEqual([
      '2026-06-07',
      '2026-06-13',
    ]);
  });

  it('yields one night, not two, when two held weeks both carry the same date', () => {
    // Same divergence seen from the other side: after firstDayOfWeek moves, two
    // documents can both hold a date. A duplicate row would be a visible defect.
    const older = weekWithChef('2026-06-07', ALEX, ['2026-06-13']);
    const newer = weekWithChef('2026-06-08', ALEX, ['2026-06-13']);

    expect(upcomingChefDays([older, newer], ALEX, '2026-06-08').map((n) => n.date)).toEqual([
      '2026-06-13',
    ]);
  });

  it('carries the whole day, so the caller can say what is planned', () => {
    const week = weekWithChef('2026-06-08', ALEX, ['2026-06-09']);
    const [night] = upcomingChefDays([week], ALEX, '2026-06-08');
    expect(night?.day.chefs).toEqual([ALEX]);
    expect(night?.day.recipeIds).toEqual([]);
  });

  it('is empty with no weeks held at all', () => {
    expect(upcomingChefDays([], ALEX, '2026-06-08')).toEqual([]);
  });
});
