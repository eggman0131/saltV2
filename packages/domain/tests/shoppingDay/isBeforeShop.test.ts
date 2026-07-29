import { describe, it, expect } from 'vitest';
import { isBeforeShop, shopDayForWeek } from '../../src/index.js';
import type { ShoppingDayDoc } from '../../src/schemas/index.js';

describe('isBeforeShop', () => {
  const SHOP = '2026-08-15'; // a Saturday

  it('shades the days before the shop', () => {
    expect(isBeforeShop('2026-08-14', SHOP)).toBe(true);
    expect(isBeforeShop('2026-08-10', SHOP)).toBe(true);
  });

  it('does not shade the shop day itself', () => {
    // The shop happens ON this day, so it is provisioned by it.
    expect(isBeforeShop(SHOP, SHOP)).toBe(false);
  });

  it('does not shade the days after the shop', () => {
    expect(isBeforeShop('2026-08-16', SHOP)).toBe(false);
    expect(isBeforeShop('2026-08-21', SHOP)).toBe(false);
  });

  it('shades nothing when no shop day is set', () => {
    // An unmarked week makes no claim about provisioning — shading it all would
    // be a lie, not a safe default.
    expect(isBeforeShop('2026-08-14', null)).toBe(false);
    expect(isBeforeShop('2026-08-16', null)).toBe(false);
  });

  it('compares correctly across a month boundary', () => {
    // Plain string comparison on fixed-width YYYY-MM-DD — the case that would
    // break under any home-rolled numeric parsing.
    expect(isBeforeShop('2026-07-31', '2026-08-01')).toBe(true);
    expect(isBeforeShop('2026-08-01', '2026-07-31')).toBe(false);
  });

  it('compares correctly across a year boundary', () => {
    expect(isBeforeShop('2026-12-31', '2027-01-02')).toBe(true);
    expect(isBeforeShop('2027-01-03', '2026-12-31')).toBe(false);
  });
});

describe('shopDayForWeek', () => {
  const day = (date: string): ShoppingDayDoc => ({
    date,
    slot: 'am',
    schemaVersion: 1,
    setBy: 'uid-a',
    setAt: '2026-08-10T09:00:00.000Z',
  });

  it('returns null for a week with no shop day', () => {
    expect(shopDayForWeek([])).toBeNull();
  });

  it('returns the single shop day', () => {
    expect(shopDayForWeek([day('2026-08-15')])?.date).toBe('2026-08-15');
  });

  it('prefers the earliest when a week transiently holds two', () => {
    // A concurrent mark from another device, or a delete that has not landed.
    // Shading up to the FIRST shop never claims a day is unprovisioned when it
    // might not be.
    expect(shopDayForWeek([day('2026-08-15'), day('2026-08-12')])?.date).toBe('2026-08-12');
    expect(shopDayForWeek([day('2026-08-12'), day('2026-08-15')])?.date).toBe('2026-08-12');
  });
});
