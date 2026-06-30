import type {
  HomeLocation,
  OpenMeteoForecastResponse,
  WeatherDaySummary,
  WeatherForecast,
} from '../schemas/index.js';
import { weatherSeverity } from './weatherSeverity.js';

// Pure weather aggregation + staleness logic (issue #382, Phase 2). NO I/O, no
// side effects (CLAUDE.md Rule 1): the CF does the Open-Meteo fetch and the
// Firestore read/write; these functions only transform ALREADY-FETCHED, validated
// data and compare timestamps/locations.

// The local-time window we summarise per day: the late afternoon / early evening
// (16:00 up to and including 19:00), the slot that decides "what's the evening
// like" for meal planning. With Open-Meteo `timezone=auto` the hourly `time`
// strings are LOCAL time at the home coordinates, so this is a plain hour filter
// — no timezone math.
const WINDOW_START_HOUR = 16;
const WINDOW_END_HOUR = 19;

// Default cache lifetime for the staleness check: 3 hours. Beyond this a cached
// forecast is considered stale and a refetch is warranted.
export const FORECAST_MAX_AGE_MS = 3 * 60 * 60 * 1000;

// Pulls the local date (`YYYY-MM-DD`) and hour (0–23) out of an Open-Meteo hourly
// `time` string (`YYYY-MM-DDTHH:mm`). Returns null for an unparseable string so a
// stray entry is skipped rather than poisoning a day's reduction.
function parseLocalDateHour(time: string): { date: string; hour: number } | null {
  // Expected form: 2026-06-30T16:00. Be defensive — only the leading
  // `YYYY-MM-DDTHH` is load-bearing.
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})/.exec(time);
  if (!match) return null;
  const hour = Number(match[2]);
  if (!Number.isInteger(hour)) return null;
  return { date: match[1]!, hour };
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// One in-window weather sample: a WMO code and the hour's day/night flag. Paired
// (rather than two parallel arrays) so the is_day chosen for the day is exactly
// the one belonging to the hour whose code was selected. `isDay` may be null when
// Open-Meteo omitted it for an otherwise-valid code hour.
interface WeatherSample {
  code: number;
  isDay: number | null;
}

// Accumulates the in-window hourly samples for one day before reducing to a
// summary. Each metric collects only its present (non-null) samples.
interface DayAccumulator {
  temps: number[];
  apparent: number[];
  humidity: number[];
  cloud: number[];
  precip: number[];
  // (code, is_day) pairs for hours with a present, finite weather_code. is_day is
  // carried alongside so the selected code's hour determines the day's isDay.
  weather: WeatherSample[];
}

function emptyAccumulator(): DayAccumulator {
  return { temps: [], apparent: [], humidity: [], cloud: [], precip: [], weather: [] };
}

function push(target: number[], value: number | null | undefined): void {
  if (typeof value === 'number' && Number.isFinite(value)) target.push(value);
}

// Collects a weather sample only when the hour has a present, finite weather_code
// (the load-bearing field); is_day rides along as-is (it may be null). Mirrors
// `push`'s "skip null/undefined" discipline for the code.
function pushWeather(
  target: WeatherSample[],
  code: number | null | undefined,
  isDay: number | null | undefined,
): void {
  if (typeof code === 'number' && Number.isFinite(code)) {
    target.push({ code, isDay: typeof isDay === 'number' ? isDay : null });
  }
}

// Reduces a day's in-window weather samples to the MOST-SIGNIFICANT code (by
// `weatherSeverity`) plus that hour's day/night flag. Returns null when the day
// has no valid weather_code sample, so the caller omits both fields rather than
// writing a bogus default. The representative `isDay` is the flag of the SELECTED
// code's hour (the most-significant sample); a tie resolves to the first such hour
// (stable). The flag maps Open-Meteo's 1/0 → true/false; a null/non-1/0 flag
// leaves isDay undefined so the icon mapper falls back to the day variant.
function reduceWeather(
  samples: readonly WeatherSample[],
): { weatherCode: number; isDay?: boolean } | null {
  let best: WeatherSample | null = null;
  let bestRank = -Infinity;
  for (const sample of samples) {
    const rank = weatherSeverity(sample.code);
    if (rank > bestRank) {
      bestRank = rank;
      best = sample;
    }
  }
  if (!best) return null;
  if (best.isDay === 1) return { weatherCode: best.code, isDay: true };
  if (best.isDay === 0) return { weatherCode: best.code, isDay: false };
  return { weatherCode: best.code };
}

// Reduces the already-fetched, validated Open-Meteo HOURLY data into a per-day
// summary of the 16:00–19:00 local window, keyed by local `YYYY-MM-DD`. The
// hourly arrays are parallel-indexed with `hourly.time`. A day with NO hours in
// the window (the far edge of the forecast horizon) is omitted from the result
// rather than emitting a summary full of NaNs. Temperatures round to whole
// degrees; the averaged percentages round to whole numbers.
export function aggregateForecastWindow(
  response: OpenMeteoForecastResponse,
): Record<string, WeatherDaySummary> {
  const {
    time,
    temperature_2m,
    apparent_temperature,
    relative_humidity_2m,
    cloud_cover,
    precipitation_probability,
    weather_code,
    is_day,
  } = response.hourly;

  const byDay = new Map<string, DayAccumulator>();

  for (let i = 0; i < time.length; i++) {
    const parsed = parseLocalDateHour(time[i]!);
    if (!parsed) continue;
    if (parsed.hour < WINDOW_START_HOUR || parsed.hour > WINDOW_END_HOUR) continue;

    let acc = byDay.get(parsed.date);
    if (!acc) {
      acc = emptyAccumulator();
      byDay.set(parsed.date, acc);
    }
    push(acc.temps, temperature_2m[i]);
    push(acc.apparent, apparent_temperature[i]);
    push(acc.humidity, relative_humidity_2m[i]);
    push(acc.cloud, cloud_cover[i]);
    push(acc.precip, precipitation_probability[i]);
    pushWeather(acc.weather, weather_code[i], is_day[i]);
  }

  const days: Record<string, WeatherDaySummary> = {};
  for (const [date, acc] of byDay) {
    // A day only earns a summary if it has at least one temperature sample in
    // the window (the primary metric). Without it there is no high/low to
    // report, so omit the day rather than emit NaNs.
    if (acc.temps.length === 0) continue;

    // Reduce the window's weather codes to the most-significant one (+ its hour's
    // day/night flag). Omit both fields entirely when the day has no valid
    // in-window code sample — older fetches lacked these arrays, and a far-edge
    // day may have temps but no code — rather than writing a bogus default.
    const weather = reduceWeather(acc.weather);

    days[date] = {
      tempHigh: Math.round(Math.max(...acc.temps)),
      tempLow: Math.round(Math.min(...acc.temps)),
      // Secondary metrics fall back to 0 only if a day has temps but somehow no
      // samples for that metric (Open-Meteo returns parallel arrays, so in
      // practice they're all present together); 0 is a safe, finite default.
      apparentTemp: acc.apparent.length ? Math.round(mean(acc.apparent)) : 0,
      humidity: acc.humidity.length ? Math.round(mean(acc.humidity)) : 0,
      cloudCover: acc.cloud.length ? Math.round(mean(acc.cloud)) : 0,
      precipitationChance: acc.precip.length ? Math.round(mean(acc.precip)) : 0,
      ...(weather ?? {}),
    };
  }

  return days;
}

// True when a home location's coordinates/timezone differ from a cached
// forecast's location snapshot. The `label` is human-readable metadata and does
// NOT invalidate a forecast on its own — only the coordinates and timezone change
// what the forecast actually is.
function locationDiffers(a: HomeLocation, b: HomeLocation): boolean {
  return a.latitude !== b.latitude || a.longitude !== b.longitude || a.timezone !== b.timezone;
}

// Decides whether a cached forecast needs a refetch. Returns true when:
//   • the cache is absent (no forecast yet),
//   • it is older than `maxAgeMs` (default 3h), or
//   • its location snapshot no longer matches the current home location.
// Otherwise the cache is fresh and the CF can skip the external fetch. Pure —
// `nowMs` is passed in so callers control the clock (and tests are deterministic).
export function isForecastStale(
  cache: WeatherForecast | null | undefined,
  currentLocation: HomeLocation,
  nowMs: number,
  maxAgeMs: number = FORECAST_MAX_AGE_MS,
): boolean {
  if (!cache) return true;
  if (nowMs - cache.fetchedAt >= maxAgeMs) return true;
  if (locationDiffers(cache.location, currentLocation)) return true;
  return false;
}
