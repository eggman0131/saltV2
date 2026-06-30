import { describe, it, expect } from 'vitest';
import { weatherSeverity, mostSignificantWeatherCode } from '@salt/domain';

// Pure WMO weather-code severity ranking (issue #387). The ranking lets
// `aggregateForecastWindow` collapse a window of hourly codes to the single
// most-significant one; the icon mapper then turns that code into a pictogram.

describe('weatherSeverity', () => {
  it('ranks conditions in increasing significance (clear < cloud < rain < snow < thunder)', () => {
    // One representative code per group, least → most significant.
    const ascending = [
      0, // clear
      1, // mainly clear
      2, // partly cloudy
      3, // overcast
      45, // fog
      51, // drizzle
      61, // light rain
      80, // showers
      66, // sleet / freezing
      65, // heavy rain
      71, // light snow
      75, // heavy snow
      95, // thunder
    ];
    for (let i = 1; i < ascending.length; i++) {
      expect(weatherSeverity(ascending[i]!)).toBeGreaterThan(weatherSeverity(ascending[i - 1]!));
    }
  });

  it('treats codes within the same group as equal rank', () => {
    expect(weatherSeverity(45)).toBe(weatherSeverity(48)); // fog pair
    expect(weatherSeverity(51)).toBe(weatherSeverity(53));
    expect(weatherSeverity(53)).toBe(weatherSeverity(55)); // drizzle trio
    expect(weatherSeverity(80)).toBe(weatherSeverity(82)); // showers
    expect(weatherSeverity(95)).toBe(weatherSeverity(99)); // thunder
  });

  it('ranks showers above steady light rain and freezing/snow above plain rain', () => {
    expect(weatherSeverity(80)).toBeGreaterThan(weatherSeverity(61)); // showers > light rain
    expect(weatherSeverity(66)).toBeGreaterThan(weatherSeverity(61)); // sleet > light rain
    expect(weatherSeverity(71)).toBeGreaterThan(weatherSeverity(65)); // light snow > heavy rain
    expect(weatherSeverity(75)).toBeGreaterThan(weatherSeverity(71)); // heavy snow > light snow
    expect(weatherSeverity(95)).toBeGreaterThan(weatherSeverity(75)); // thunder is top
  });

  it('gives unknown or non-finite codes a rank below every real condition', () => {
    const clearRank = weatherSeverity(0); // the lowest real condition (rank 0)
    expect(weatherSeverity(4)).toBeLessThan(clearRank); // unmapped WMO code
    expect(weatherSeverity(-1)).toBeLessThan(clearRank);
    expect(weatherSeverity(123)).toBeLessThan(clearRank);
    expect(weatherSeverity(NaN)).toBeLessThan(clearRank);
    expect(weatherSeverity(Infinity)).toBeLessThan(clearRank);
  });

  it('never throws on any numeric input (total function)', () => {
    expect(() => weatherSeverity(Number.MAX_SAFE_INTEGER)).not.toThrow();
    expect(() => weatherSeverity(-Infinity)).not.toThrow();
  });
});

describe('mostSignificantWeatherCode', () => {
  it('picks the highest-severity code from a window of samples', () => {
    // clear, partly-cloudy, thunder → thunder wins.
    expect(mostSignificantWeatherCode([0, 2, 95])).toBe(95);
    // light rain vs showers → showers (more significant).
    expect(mostSignificantWeatherCode([61, 80, 3])).toBe(80);
  });

  it('returns null for an empty window', () => {
    expect(mostSignificantWeatherCode([])).toBeNull();
  });

  it('returns the FIRST sample at the max rank when several tie (stable)', () => {
    // 80, 81, 82 are all in the showers group (equal rank) — the first wins.
    expect(mostSignificantWeatherCode([80, 81, 82])).toBe(80);
    expect(mostSignificantWeatherCode([82, 80, 81])).toBe(82);
  });

  it('prefers a known condition over an unknown code even if the unknown is larger', () => {
    expect(mostSignificantWeatherCode([0, 999])).toBe(0);
  });
});
