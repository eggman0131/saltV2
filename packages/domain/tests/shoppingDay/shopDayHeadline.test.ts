import { describe, it, expect } from 'vitest';
import { shopDayHeadline } from '../../src/shoppingDay/shopDayHeadline.js';

/**
 * The shop-day headline (issue #1054, Phase 2) — the sentence the shopping list
 * shows and the daily reminder pushes.
 *
 * The three renderings each had their own spelling in a different app until this
 * module took them, so what is asserted here is the full vocabulary rather than
 * only the branch the two happened to share.
 */
describe('shopDayHeadline', () => {
  // One row per rendering, each naming itself (UT-D1/D2).
  it.each([
    [
      'today, with the slot uppercased',
      { days: 0, date: '2026-08-15', slot: 'am' },
      'Shopping today AM',
    ],
    [
      'tomorrow — the branch the push reminder uses',
      { days: 1, date: '2026-08-16', slot: 'pm' },
      'Shopping tomorrow PM',
    ],
    [
      'a weekday for anything further out',
      { days: 2, date: '2026-08-15', slot: 'am' },
      'Shopping Sat AM',
    ],
    ['a weekday six days out', { days: 6, date: '2026-08-19', slot: 'pm' }, 'Shopping Wed PM'],
    [
      'an already-uppercase slot is unharmed',
      { days: 0, date: '2026-08-15', slot: 'AM' },
      'Shopping today AM',
    ],
  ])('renders %s', (_name, input, expected) => {
    expect(shopDayHeadline(input)).toBe(expected);
  });

  // The service worker's case: it never read the payload, so it cannot know the
  // slot. The day alone is the one thing that is still true.
  it.each([
    ['omitted', { days: 1, date: '2026-08-16' }],
    ['null', { days: 1, date: '2026-08-16', slot: null }],
    ['empty', { days: 1, date: '2026-08-16', slot: '' }],
  ])('renders the day alone when the slot is %s', (_name, input) => {
    expect(shopDayHeadline(input)).toBe('Shopping tomorrow');
  });

  it('reads the weekday in UTC, not the machine zone', () => {
    // A date-only value names one weekday. Formatting it as a local instant
    // would shift it a day west of UTC, which is how "Sat" silently becomes
    // "Fri" for half the world.
    expect(shopDayHeadline({ days: 3, date: '2026-08-16', slot: 'am' })).toBe('Shopping Sun AM');
  });

  it('renders the weekday for a distance in the past', () => {
    // Deliberate, and the boundary of what this function decides: whether a shop
    // that has already happened should be shown AT ALL is the caller's policy —
    // the shopping list suppresses it, the reminder can never produce it.
    expect(shopDayHeadline({ days: -1, date: '2026-08-14', slot: 'am' })).toBe('Shopping Fri AM');
  });
});
