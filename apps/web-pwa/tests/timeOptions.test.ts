import { describe, it, expect } from 'vitest';
import { quarterHourOptions } from '../src/lib/timeOptions.js';

// The quarter-hour arithmetic behind two pickers that offer DIFFERENT windows
// (issue #1055). The windows themselves are pinned at their own surfaces —
// `MealCookPlanPage.test.ts` for 16:00–22:45 and `MealPlanWeekPage.test.ts` for
// 17:00–22:45 — so what is asserted here is only the generator.

describe('quarterHourOptions', () => {
  it('walks the quarter hours from the hour it is given', () => {
    expect(quarterHourOptions(17, 6)).toEqual([
      '17:00',
      '17:15',
      '17:30',
      '17:45',
      '18:00',
      '18:15',
    ]);
  });

  it.each([
    ["the cook plan's serve-time window", 16, 28, '16:00', '22:45'],
    ["the planner's home-time window", 17, 24, '17:00', '22:45'],
  ])('produces %s', (_case, fromHour, count, first, last) => {
    // The two live windows, side by side. They end at the same time and start an
    // hour apart, which is exactly the difference a shared LIST would have
    // erased — and would have been a product change, not a refactor.
    const options = quarterHourOptions(fromHour, count);
    expect(options).toHaveLength(count);
    expect(options.at(0)).toBe(first);
    expect(options.at(-1)).toBe(last);
  });

  it('pads the minutes but not the hour, matching stored "HH:MM" values', () => {
    // Stored home times are compared and displayed as plain strings, so the
    // shape has to match what is already in Firestore.
    expect(quarterHourOptions(9, 2)).toEqual(['9:00', '9:15']);
  });

  it('rolls into the next hour every four entries', () => {
    expect(quarterHourOptions(16, 9).at(-1)).toBe('18:00');
  });

  it('yields nothing for a zero count rather than a stray first entry', () => {
    expect(quarterHourOptions(17, 0)).toEqual([]);
  });
});
