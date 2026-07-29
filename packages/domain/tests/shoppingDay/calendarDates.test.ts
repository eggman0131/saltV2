import { describe, it, expect } from 'vitest';
import { dateInZone, addCalendarDays, tomorrowInZone } from '../../src/index.js';

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
