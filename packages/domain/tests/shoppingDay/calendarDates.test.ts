import { describe, it, expect } from 'vitest';
import { addCalendarDays, daysBetween, tomorrowInZone } from '../../src/index.js';
import { dateInZone } from '../../src/shoppingDay/index.js';

const LONDON = 'Europe/London';

describe('dateInZone', () => {
  it('projects an instant onto the zone calendar', () => {
    // 17:00 Europe/London in summer is 16:00 UTC (BST, UTC+1).
    expect(dateInZone(new Date('2026-08-15T16:00:00.000Z'), LONDON)).toBe('2026-08-15');
  });

  it('is a zone projection, not a UTC slice', () => {
    // 23:30 UTC is already the NEXT day in London during BST — the case a naive
    // toISOString().slice(0, 10) gets wrong.
    expect(dateInZone(new Date('2026-08-15T23:30:00.000Z'), LONDON)).toBe('2026-08-16');
    // …and the mirror case: 00:30 UTC is still the previous day in New York.
    expect(dateInZone(new Date('2026-08-16T00:30:00.000Z'), 'America/New_York')).toBe('2026-08-15');
  });
});

describe('addCalendarDays', () => {
  it('advances within a month', () => {
    expect(addCalendarDays('2026-08-15', 1)).toBe('2026-08-16');
  });

  it('crosses a month boundary', () => {
    expect(addCalendarDays('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('crosses a year boundary', () => {
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('handles a leap day', () => {
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addCalendarDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('goes backwards too', () => {
    expect(addCalendarDays('2027-01-01', -1)).toBe('2026-12-31');
  });
});

describe('daysBetween', () => {
  it('counts today, tomorrow and the rest of the week', () => {
    // The three cases the shopping-list phrasing branches on.
    expect(daysBetween('2026-08-12', '2026-08-12')).toBe(0);
    expect(daysBetween('2026-08-12', '2026-08-13')).toBe(1);
    expect(daysBetween('2026-08-12', '2026-08-15')).toBe(3);
  });

  it('goes negative for a date that has passed', () => {
    // A window left open across midnight can surface a shop that already
    // happened; the caller needs to be able to tell.
    expect(daysBetween('2026-08-16', '2026-08-15')).toBe(-1);
  });

  it('crosses month, year and leap boundaries', () => {
    expect(daysBetween('2026-07-31', '2026-08-01')).toBe(1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2); // 2028 is a leap year
    expect(daysBetween('2026-08-01', '2026-09-01')).toBe(31);
  });

  it('is not thrown off by a DST transition in the middle', () => {
    // Clocks go forward 2026-03-29 in Europe/London. UTC date-only arithmetic
    // means the 23-hour local day still counts as exactly one.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('tomorrowInZone', () => {
  it('resolves tomorrow from the 17:00 London cron instant in summer', () => {
    // BST (UTC+1): 17:00 local == 16:00Z.
    expect(tomorrowInZone(new Date('2026-08-14T16:00:00.000Z'), LONDON)).toBe('2026-08-15');
  });

  it('resolves tomorrow from the 17:00 London cron instant in winter', () => {
    // GMT (UTC+0): 17:00 local == 17:00Z.
    expect(tomorrowInZone(new Date('2026-01-09T17:00:00.000Z'), LONDON)).toBe('2026-01-10');
  });

  it('is correct on the eve of the spring-forward DST transition', () => {
    // Clocks go forward 2026-03-29 in Europe/London. Firing at 17:00 GMT on the
    // 28th must still name the 29th — the day that loses an hour.
    expect(tomorrowInZone(new Date('2026-03-28T17:00:00.000Z'), LONDON)).toBe('2026-03-29');
  });

  it('is correct on the eve of the autumn fall-back DST transition', () => {
    // Clocks go back 2026-10-25. Firing at 17:00 BST (16:00Z) on the 24th must
    // name the 25th — the 25-hour day.
    expect(tomorrowInZone(new Date('2026-10-24T16:00:00.000Z'), LONDON)).toBe('2026-10-25');
  });

  it('is correct on the DST transition day itself', () => {
    // 17:00 GMT on the 29th (already switched to BST → 18:00 local, still the
    // 29th) must name the 30th. Adding 24h to the instant would too, but only by
    // luck; the calendar projection is exact.
    expect(tomorrowInZone(new Date('2026-03-29T16:00:00.000Z'), LONDON)).toBe('2026-03-30');
  });

  it('rolls the year over', () => {
    expect(tomorrowInZone(new Date('2026-12-31T17:00:00.000Z'), LONDON)).toBe('2027-01-01');
  });
});
