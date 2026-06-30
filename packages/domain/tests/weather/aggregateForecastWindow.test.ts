import { describe, it, expect } from 'vitest';
import { aggregateForecastWindow, isForecastStale, FORECAST_MAX_AGE_MS } from '@salt/domain';
import type { HomeLocation } from '@salt/domain/schemas';
import { OpenMeteoForecastResponseSchema } from '@salt/domain/schemas';

// Pure weather aggregation + staleness logic (issue #382, Phase 2). These are the
// load-bearing pure functions: the CF feeds them already-fetched, validated
// Open-Meteo data and a clock, and they must reduce the 16:00–19:00 local window
// per day, carry a temperature high/low range, omit days with no in-window hours,
// and correctly decide cache staleness across the absent/stale/moved/fresh
// branches.

const LONDON: HomeLocation = {
  latitude: 51.5085,
  longitude: -0.1257,
  timezone: 'Europe/London',
  label: 'London, England, United Kingdom',
};

// Builds an Open-Meteo-shaped response from explicit hourly rows so each test
// controls exactly which hours/days are present. Each row is one hour.
function buildResponse(
  rows: Array<{
    time: string;
    temp: number | null;
    apparent: number | null;
    humidity: number | null;
    cloud: number | null;
    precip: number | null;
  }>,
) {
  const raw = {
    timezone: 'Europe/London',
    hourly: {
      time: rows.map((r) => r.time),
      temperature_2m: rows.map((r) => r.temp),
      apparent_temperature: rows.map((r) => r.apparent),
      relative_humidity_2m: rows.map((r) => r.humidity),
      cloud_cover: rows.map((r) => r.cloud),
      precipitation_probability: rows.map((r) => r.precip),
    },
  };
  // Round-trip through the response schema so the tests exercise the same shape
  // the CF validates at the trust boundary.
  return OpenMeteoForecastResponseSchema.parse(raw);
}

// A full 24h of one day, with the in-window hours (16–19) carrying distinct
// values so we can assert the reduction precisely.
function fullDay(date: string) {
  const rows: Parameters<typeof buildResponse>[0] = [];
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    const inWindow = h >= 16 && h <= 19;
    rows.push({
      time: `${date}T${hh}:00`,
      // Out-of-window hours carry sentinel values that MUST NOT affect the
      // summary; in-window hours carry the values we assert on.
      temp: inWindow ? { 16: 18, 17: 21, 18: 20, 19: 16 }[h]! : 99,
      apparent: inWindow ? { 16: 17, 17: 20, 18: 19, 19: 15 }[h]! : 99,
      humidity: inWindow ? { 16: 60, 17: 64, 18: 66, 19: 70 }[h]! : 0,
      cloud: inWindow ? { 16: 40, 17: 50, 18: 50, 19: 60 }[h]! : 0,
      precip: inWindow ? { 16: 10, 17: 20, 18: 30, 19: 40 }[h]! : 0,
    });
  }
  return rows;
}

describe('aggregateForecastWindow', () => {
  it('reduces only the 16:00–19:00 local hours per day into a summary', () => {
    const days = aggregateForecastWindow(buildResponse(fullDay('2026-06-30')));

    expect(Object.keys(days)).toEqual(['2026-06-30']);
    const d = days['2026-06-30']!;
    // High/low across the four in-window temps (18,21,20,16). The out-of-window
    // 99s must be excluded.
    expect(d.tempHigh).toBe(21);
    expect(d.tempLow).toBe(16);
    // Averaged feels-like over (17,20,19,15) = 17.75 → rounds to 18.
    expect(d.apparentTemp).toBe(18);
    // Averaged humidity over (60,64,66,70) = 65.
    expect(d.humidity).toBe(65);
    // Averaged cloud over (40,50,50,60) = 50.
    expect(d.cloudCover).toBe(50);
    // Averaged precip chance over (10,20,30,40) = 25.
    expect(d.precipitationChance).toBe(25);
  });

  it('summarises each day independently across a multi-day horizon', () => {
    const days = aggregateForecastWindow(
      buildResponse([...fullDay('2026-06-30'), ...fullDay('2026-07-01')]),
    );
    expect(Object.keys(days).sort()).toEqual(['2026-06-30', '2026-07-01']);
    expect(days['2026-07-01']!.tempHigh).toBe(21);
  });

  it('omits a day that has no hours in the 16:00–19:00 window', () => {
    // A day whose only hours are BEFORE the window — the far edge of the horizon
    // where Open-Meteo's hourly arrays stop mid-day. That day must be omitted
    // rather than emitting NaNs.
    const rows = [
      ...fullDay('2026-06-30'),
      { time: '2026-07-01T13:00', temp: 22, apparent: 21, humidity: 55, cloud: 30, precip: 5 },
      { time: '2026-07-01T14:00', temp: 23, apparent: 22, humidity: 54, cloud: 30, precip: 5 },
      { time: '2026-07-01T15:00', temp: 24, apparent: 23, humidity: 53, cloud: 30, precip: 5 },
    ];
    const days = aggregateForecastWindow(buildResponse(rows));
    expect(Object.keys(days)).toEqual(['2026-06-30']);
    expect(days['2026-07-01']).toBeUndefined();
  });

  it('rounds temperatures to whole degrees and never emits NaN', () => {
    const rows = [
      {
        time: '2026-06-30T16:00',
        temp: 18.4,
        apparent: 17.6,
        humidity: 60.2,
        cloud: 41.5,
        precip: 9.4,
      },
      {
        time: '2026-06-30T17:00',
        temp: 21.6,
        apparent: 20.1,
        humidity: 63.8,
        cloud: 49.5,
        precip: 20.6,
      },
    ];
    const days = aggregateForecastWindow(buildResponse(rows));
    const d = days['2026-06-30']!;
    for (const v of Object.values(d)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Number.isInteger(v)).toBe(true);
    }
    expect(d.tempHigh).toBe(22); // round(21.6)
    expect(d.tempLow).toBe(18); // round(18.4)
  });

  it('skips null hourly samples within the window', () => {
    const rows = [
      { time: '2026-06-30T16:00', temp: 20, apparent: 19, humidity: 60, cloud: 40, precip: 10 },
      // A null temp hour: excluded from the high/low entirely.
      {
        time: '2026-06-30T17:00',
        temp: null,
        apparent: null,
        humidity: null,
        cloud: null,
        precip: null,
      },
      { time: '2026-06-30T18:00', temp: 24, apparent: 23, humidity: 70, cloud: 60, precip: 30 },
    ];
    const days = aggregateForecastWindow(buildResponse(rows));
    const d = days['2026-06-30']!;
    expect(d.tempHigh).toBe(24);
    expect(d.tempLow).toBe(20);
    // Averages computed over the two present samples only.
    expect(d.humidity).toBe(65); // mean(60,70)
  });

  it('returns an empty record when no hours fall in any window', () => {
    const rows = [
      { time: '2026-06-30T08:00', temp: 15, apparent: 14, humidity: 80, cloud: 20, precip: 0 },
      { time: '2026-06-30T22:00', temp: 12, apparent: 11, humidity: 85, cloud: 30, precip: 0 },
    ];
    expect(aggregateForecastWindow(buildResponse(rows))).toEqual({});
  });
});

describe('isForecastStale', () => {
  const now = 1_751_000_000_000; // arbitrary fixed clock (ms)

  const freshCache = {
    days: {},
    fetchedAt: now - 60 * 60 * 1000, // 1h old
    location: LONDON,
    timezone: 'Europe/London',
  };

  it('is stale when the cache is absent', () => {
    expect(isForecastStale(null, LONDON, now)).toBe(true);
    expect(isForecastStale(undefined, LONDON, now)).toBe(true);
  });

  it('is stale when the cache is older than the max age (default 3h)', () => {
    const stale = { ...freshCache, fetchedAt: now - (FORECAST_MAX_AGE_MS + 1) };
    expect(isForecastStale(stale, LONDON, now)).toBe(true);
  });

  it('is stale when the cached location differs from the current location', () => {
    const moved: HomeLocation = {
      ...LONDON,
      latitude: 48.8566,
      longitude: 2.3522,
      timezone: 'Europe/Paris',
    };
    expect(isForecastStale(freshCache, moved, now)).toBe(true);
  });

  it('is NOT stale when fresh, recent, and same location', () => {
    expect(isForecastStale(freshCache, LONDON, now)).toBe(false);
  });

  it('treats a forecast exactly at the max-age boundary as stale', () => {
    const boundary = { ...freshCache, fetchedAt: now - FORECAST_MAX_AGE_MS };
    expect(isForecastStale(boundary, LONDON, now)).toBe(true);
  });

  it('ignores a label-only change (label is not part of what the forecast is)', () => {
    const relabelled: HomeLocation = { ...LONDON, label: 'Home' };
    expect(isForecastStale(freshCache, relabelled, now)).toBe(false);
  });

  it('honours a custom maxAgeMs', () => {
    const cache = { ...freshCache, fetchedAt: now - 30 * 60 * 1000 }; // 30m old
    expect(isForecastStale(cache, LONDON, now, 20 * 60 * 1000)).toBe(true);
    expect(isForecastStale(cache, LONDON, now, 60 * 60 * 1000)).toBe(false);
  });
});
