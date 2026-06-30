import { describe, it, expect } from 'vitest';
import { weatherIcon } from '@salt/domain';
import type { WeatherIconId } from '@salt/domain';
import type { WeatherDaySummary } from '@salt/domain/schemas';

// Pure WMO-code → icon-id mapping (issue #387). The mapper collapses the WMO code
// set into the fixed 17-icon set, picking day/night variants from `isDay`, and
// returns null for an absent or unknown code (the caller renders no icon).

// A summary with only the fields the icon mapper reads; the rest carry harmless
// finite values so it's a valid WeatherDaySummary shape.
function summary(weatherCode?: number, isDay?: boolean): WeatherDaySummary {
  return {
    tempHigh: 18,
    tempLow: 12,
    apparentTemp: 15,
    humidity: 60,
    cloudCover: 50,
    precipitationChance: 10,
    ...(weatherCode !== undefined ? { weatherCode } : {}),
    ...(isDay !== undefined ? { isDay } : {}),
  };
}

describe('weatherIcon', () => {
  it('returns null when weatherCode is absent', () => {
    expect(weatherIcon(summary())).toBeNull();
  });

  it('returns null for an unknown / unmapped WMO code', () => {
    expect(weatherIcon(summary(4))).toBeNull(); // not a WMO interpretation code
    expect(weatherIcon(summary(123))).toBeNull();
    expect(weatherIcon(summary(-1))).toBeNull();
  });

  // ─── Non-variant codes (single icon regardless of day/night) ────────────────
  const fixed: Array<[number, WeatherIconId]> = [
    [3, 'overcast'],
    [45, 'fog'],
    [48, 'fog'],
    [51, 'drizzle'],
    [53, 'drizzle'],
    [55, 'drizzle'],
    [61, 'rain-light'],
    [63, 'rain-light'],
    [65, 'rain-heavy'],
    [56, 'sleet'],
    [57, 'sleet'],
    [66, 'sleet'],
    [67, 'sleet'],
    [71, 'snow-light'],
    [73, 'snow-light'],
    [77, 'snow-light'],
    [85, 'snow-light'],
    [75, 'snow-heavy'],
    [86, 'snow-heavy'],
    [95, 'thunder'],
    [96, 'thunder'],
    [99, 'thunder'],
  ];

  it.each(fixed)('maps WMO %i → %s (no day/night variant)', (code, icon) => {
    // Same icon whether isDay is true, false, or absent.
    expect(weatherIcon(summary(code, true))).toBe(icon);
    expect(weatherIcon(summary(code, false))).toBe(icon);
    expect(weatherIcon(summary(code))).toBe(icon);
  });

  // ─── Day/night variant codes ────────────────────────────────────────────────
  const variants: Array<[number, WeatherIconId, WeatherIconId]> = [
    [0, 'clear-day', 'clear-night'],
    [1, 'mostly-clear-day', 'mostly-clear-night'],
    [2, 'partly-cloudy-day', 'partly-cloudy-night'],
    [80, 'showers-day', 'showers-night'],
    [81, 'showers-day', 'showers-night'],
    [82, 'showers-day', 'showers-night'],
  ];

  it.each(variants)('maps WMO %i → %s by day / %s by night', (code, dayIcon, nightIcon) => {
    expect(weatherIcon(summary(code, true))).toBe(dayIcon);
    expect(weatherIcon(summary(code, false))).toBe(nightIcon);
    // Missing isDay falls back to the day variant.
    expect(weatherIcon(summary(code))).toBe(dayIcon);
  });

  it('every mapped code resolves to one of the 17 known icon ids', () => {
    const known = new Set<WeatherIconId>([
      'clear-day',
      'clear-night',
      'mostly-clear-day',
      'mostly-clear-night',
      'partly-cloudy-day',
      'partly-cloudy-night',
      'overcast',
      'fog',
      'drizzle',
      'rain-light',
      'rain-heavy',
      'showers-day',
      'showers-night',
      'sleet',
      'snow-light',
      'snow-heavy',
      'thunder',
    ]);
    const allCodes = [
      0, 1, 2, 3, 45, 48, 51, 53, 55, 61, 63, 65, 66, 67, 56, 57, 71, 73, 77, 85, 75, 86, 80, 81,
      82, 95, 96, 99,
    ];
    for (const code of allCodes) {
      const dayIcon = weatherIcon(summary(code, true));
      const nightIcon = weatherIcon(summary(code, false));
      expect(dayIcon).not.toBeNull();
      expect(nightIcon).not.toBeNull();
      expect(known.has(dayIcon!)).toBe(true);
      expect(known.has(nightIcon!)).toBe(true);
    }
  });
});
