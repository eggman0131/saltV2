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

// One explicit hourly row. `weatherCode`/`isDay` are OPTIONAL on the row builder
// (issue #387): a row that omits them emits a null in the parallel
// `weather_code`/`is_day` arrays, which lets a test simulate the pre-#387 fetch
// where those arrays carried no usable values for a day. `isDay` is Open-Meteo's
// 0/1 integer (not a boolean).
interface Row {
  time: string;
  temp: number | null;
  apparent: number | null;
  humidity: number | null;
  cloud: number | null;
  precip: number | null;
  weatherCode?: number | null;
  isDay?: number | null;
}

// Builds an Open-Meteo-shaped response from explicit hourly rows so each test
// controls exactly which hours/days are present. Each row is one hour. The new
// `weather_code`/`is_day` arrays are always present (the schema requires them);
// rows that don't specify a code/flag contribute a null in those arrays.
function buildResponse(rows: Row[]) {
  const raw = {
    timezone: 'Europe/London',
    hourly: {
      time: rows.map((r) => r.time),
      temperature_2m: rows.map((r) => r.temp),
      apparent_temperature: rows.map((r) => r.apparent),
      relative_humidity_2m: rows.map((r) => r.humidity),
      cloud_cover: rows.map((r) => r.cloud),
      precipitation_probability: rows.map((r) => r.precip),
      weather_code: rows.map((r) => r.weatherCode ?? null),
      is_day: rows.map((r) => r.isDay ?? null),
    },
  };
  // Round-trip through the response schema so the tests exercise the same shape
  // the CF validates at the trust boundary.
  return OpenMeteoForecastResponseSchema.parse(raw);
}

// A full 24h of one day, with the in-window hours (16–19) carrying distinct
// values so we can assert the reduction precisely. In-window weather codes
// escalate clear(0) → partly-cloudy(2) → overcast(3) → light-rain(61), so the
// most-significant in-window code is the light-rain at hour 19. The out-of-window
// hours carry a thunder code (95) that MUST NOT be selected — it proves the window
// filter applies to the weather code too. is_day is 1 (day) across the window.
function fullDay(date: string): Row[] {
  const rows: Row[] = [];
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
      weatherCode: inWindow ? { 16: 0, 17: 2, 18: 3, 19: 61 }[h]! : 95,
      isDay: inWindow ? 1 : 0,
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
    // Most-significant in-window code is the light-rain (61) at hour 19; the
    // out-of-window thunder (95) must NOT be selected. isDay is true (1) for the
    // window.
    expect(d.weatherCode).toBe(61);
    expect(d.isDay).toBe(true);
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

describe('aggregateForecastWindow — weather code & is_day (issue #387)', () => {
  it('selects the MOST-SIGNIFICANT in-window code via severity, ignoring out-of-window codes', () => {
    const rows: Row[] = [
      // Out-of-window thunder (95) — the most severe code overall, but must be
      // excluded by the window filter.
      { time: '2026-06-30T12:00', temp: 20, apparent: 19, humidity: 60, cloud: 40, precip: 0, weatherCode: 95, isDay: 1 }, // prettier-ignore
      // In window: clear, partly-cloudy, light-rain → light-rain (61) is most
      // significant and must win over the earlier, milder codes.
      { time: '2026-06-30T16:00', temp: 20, apparent: 19, humidity: 60, cloud: 40, precip: 0, weatherCode: 0, isDay: 1 }, // prettier-ignore
      { time: '2026-06-30T17:00', temp: 21, apparent: 20, humidity: 62, cloud: 50, precip: 10, weatherCode: 2, isDay: 1 }, // prettier-ignore
      { time: '2026-06-30T18:00', temp: 19, apparent: 18, humidity: 70, cloud: 80, precip: 40, weatherCode: 61, isDay: 1 }, // prettier-ignore
    ];
    const d = aggregateForecastWindow(buildResponse(rows))['2026-06-30']!;
    expect(d.weatherCode).toBe(61);
  });

  it('uses the is_day of the hour whose code was selected (representative flag)', () => {
    // The most-significant code is the heavy-rain (65) at hour 18, which is a
    // NIGHT hour (is_day 0) — even though the other in-window hours are day.
    const rows: Row[] = [
      { time: '2026-06-30T16:00', temp: 20, apparent: 19, humidity: 60, cloud: 40, precip: 0, weatherCode: 1, isDay: 1 }, // prettier-ignore
      { time: '2026-06-30T17:00', temp: 19, apparent: 18, humidity: 65, cloud: 60, precip: 20, weatherCode: 3, isDay: 1 }, // prettier-ignore
      { time: '2026-06-30T18:00', temp: 17, apparent: 16, humidity: 80, cloud: 90, precip: 70, weatherCode: 65, isDay: 0 }, // prettier-ignore
    ];
    const d = aggregateForecastWindow(buildResponse(rows))['2026-06-30']!;
    expect(d.weatherCode).toBe(65);
    expect(d.isDay).toBe(false); // taken from the selected (hour 18) sample
  });

  it('maps is_day 1 → true and 0 → false', () => {
    const dayRows: Row[] = [
      { time: '2026-06-30T16:00', temp: 20, apparent: 19, humidity: 60, cloud: 40, precip: 0, weatherCode: 0, isDay: 1 }, // prettier-ignore
    ];
    const nightRows: Row[] = [
      { time: '2026-06-30T16:00', temp: 20, apparent: 19, humidity: 60, cloud: 40, precip: 0, weatherCode: 0, isDay: 0 }, // prettier-ignore
    ];
    expect(aggregateForecastWindow(buildResponse(dayRows))['2026-06-30']!.isDay).toBe(true);
    expect(aggregateForecastWindow(buildResponse(nightRows))['2026-06-30']!.isDay).toBe(false);
  });

  it('omits weatherCode (and isDay) when the day has no valid in-window code, but keeps the rest', () => {
    // In-window hours have temps but NO weather_code (the pre-#387 fetch shape, or
    // a sparse far-edge day). The summary still has temps; weatherCode/isDay are
    // omitted rather than defaulted.
    const rows: Row[] = [
      { time: '2026-06-30T16:00', temp: 18, apparent: 17, humidity: 60, cloud: 40, precip: 10 },
      { time: '2026-06-30T17:00', temp: 21, apparent: 20, humidity: 64, cloud: 50, precip: 20 },
    ];
    const d = aggregateForecastWindow(buildResponse(rows))['2026-06-30']!;
    expect(d.tempHigh).toBe(21);
    expect(d.tempLow).toBe(18);
    expect(d.weatherCode).toBeUndefined();
    expect(d.isDay).toBeUndefined();
    expect('weatherCode' in d).toBe(false);
    expect('isDay' in d).toBe(false);
  });

  it('skips null weather_code samples within the window', () => {
    const rows: Row[] = [
      { time: '2026-06-30T16:00', temp: 20, apparent: 19, humidity: 60, cloud: 40, precip: 10, weatherCode: null, isDay: 1 }, // prettier-ignore
      { time: '2026-06-30T17:00', temp: 21, apparent: 20, humidity: 64, cloud: 50, precip: 20, weatherCode: 2, isDay: 1 }, // prettier-ignore
    ];
    const d = aggregateForecastWindow(buildResponse(rows))['2026-06-30']!;
    // Only the non-null code (partly-cloudy 2) is considered.
    expect(d.weatherCode).toBe(2);
  });

  it('leaves isDay undefined when the selected hour has a null is_day but a valid code', () => {
    const rows: Row[] = [
      { time: '2026-06-30T16:00', temp: 20, apparent: 19, humidity: 60, cloud: 40, precip: 10, weatherCode: 61, isDay: null }, // prettier-ignore
    ];
    const d = aggregateForecastWindow(buildResponse(rows))['2026-06-30']!;
    expect(d.weatherCode).toBe(61);
    expect(d.isDay).toBeUndefined();
  });

  it('back-compat: old-shape rows (no weather codes) still parse and aggregate the existing metrics', () => {
    // Same as the original "rounds temperatures" case — no weather_code/is_day on
    // any row. The response still validates (the arrays are present but all-null)
    // and the temperature/percentage reduction is unchanged.
    const rows: Row[] = [
      { time: '2026-06-30T16:00', temp: 18.4, apparent: 17.6, humidity: 60.2, cloud: 41.5, precip: 9.4 }, // prettier-ignore
      { time: '2026-06-30T17:00', temp: 21.6, apparent: 20.1, humidity: 63.8, cloud: 49.5, precip: 20.6 }, // prettier-ignore
    ];
    const d = aggregateForecastWindow(buildResponse(rows))['2026-06-30']!;
    expect(d.tempHigh).toBe(22);
    expect(d.tempLow).toBe(18);
    expect(d.weatherCode).toBeUndefined();
  });

  it('prefers a known condition over an unknown in-window code', () => {
    const rows: Row[] = [
      { time: '2026-06-30T16:00', temp: 20, apparent: 19, humidity: 60, cloud: 40, precip: 0, weatherCode: 999, isDay: 1 }, // prettier-ignore
      { time: '2026-06-30T17:00', temp: 21, apparent: 20, humidity: 62, cloud: 50, precip: 0, weatherCode: 0, isDay: 1 }, // prettier-ignore
    ];
    const d = aggregateForecastWindow(buildResponse(rows))['2026-06-30']!;
    // The unknown 999 must not out-rank the real clear (0).
    expect(d.weatherCode).toBe(0);
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
