import { z } from 'zod';
import { HomeLocationSchema } from './appSettings.js';

// Weather forecast cache (issue #382, Phase 2). A single Firestore singleton doc
// (`weatherForecast/singleton`) holds the server-fetched, pre-aggregated forecast
// for the family's home location. The `refreshWeatherForecast` callable fetches
// ~14 days of HOURLY Open-Meteo data server-side, reduces the 16:00–19:00
// local-time window per day into a `WeatherDaySummary`, and writes this doc; the
// client subscribes to it via firebase-sync.
//
// This is a NEW greenfield collection — no back-compat burden. The shared schema
// here is the single source of truth for the doc shape, used by BOTH the CF write
// and the firebase-sync client read.

// Per-day summary of the late-afternoon window (16:00–19:00 local time), the
// slot that matters for "what's the evening like" meal-planning decisions. Every
// raw value the later render phase needs is carried here so that phase isn't
// blocked: a high/low temperature range, plus averaged feels-like, humidity,
// cloud cover and rain chance. Units are Open-Meteo metric defaults (°C, %).
// Values are rounded to whole numbers; a day with no hours in the window (the
// far edge of the forecast horizon) is omitted from `days` rather than emitting a
// summary with NaNs.
export const WeatherDaySummarySchema = z.object({
  // Temperature range across the window, °C (rounded to whole degrees).
  tempHigh: z.number(),
  tempLow: z.number(),
  // "Feels like" apparent temperature, averaged over the window, °C.
  apparentTemp: z.number(),
  // Relative humidity, averaged over the window, %.
  humidity: z.number(),
  // Cloud cover, averaged over the window, %.
  cloudCover: z.number(),
  // Precipitation (rain) probability, averaged over the window, %.
  precipitationChance: z.number(),
  // The MOST-SIGNIFICANT WMO weather code across the window, chosen by severity
  // rank (see `weatherSeverity`) — the icon mapper turns this into a pictogram
  // (issue #387). OPTIONAL and additive: older cached docs were written before
  // hourly `weather_code` was fetched and lack it, so this stays backward-
  // compatible on read. A day with no valid in-window weather_code sample omits
  // this entirely rather than writing a bogus default.
  weatherCode: z.number().optional(),
  // Day/night flag for the window, taken from the is_day value of the hour whose
  // weather_code was selected. OPTIONAL and additive — omitted alongside
  // `weatherCode` when no in-window sample is present. Open-Meteo's 0/1 integer is
  // mapped to false/true upstream; lets the icon mapper pick day vs night variants.
  isDay: z.boolean().optional(),
});

export type WeatherDaySummary = z.infer<typeof WeatherDaySummarySchema>;

export const WeatherForecastSchema = z.object({
  // Per-day summaries keyed by local `YYYY-MM-DD`. A record (not an array) so a
  // consumer can look up a given date directly. Only days that had hours in the
  // 16:00–19:00 window appear here.
  days: z.record(z.string(), WeatherDaySummarySchema),
  // When this cache was fetched (epoch ms). Used for the <3h staleness check.
  fetchedAt: z.number(),
  // Snapshot of the home location this forecast was fetched for. `isForecastStale`
  // compares this against the current home location so a moved home invalidates
  // a still-fresh cache.
  location: HomeLocationSchema,
  // The IANA timezone the forecast is anchored to (Open-Meteo `timezone=auto`
  // resolves it from the coordinates). Mirrors `location.timezone` but is stored
  // explicitly as the zone the day keys / window hours are expressed in.
  timezone: z.string().min(1),
});

export type WeatherForecast = z.infer<typeof WeatherForecastSchema>;

// ─── refreshWeatherForecast callable domain input ────────────────────────────
// The callable reads everything it needs server-side (the home location from
// `appSettings/singleton`), so the domain input is essentially empty. The only
// field is an optional `force` the admin "Refresh" button sets to bypass the
// server-side <3h staleness skip; absent/`false` lets the skip apply. The
// browser→CF `traceparent` rides on a sibling WIRE envelope
// (`RefreshWeatherForecastWireInputSchema`) and is stripped before this domain
// input reaches any flow logic (domain purity).
export const RefreshWeatherForecastInputSchema = z.object({
  force: z.boolean().optional(),
});

export type RefreshWeatherForecastInput = z.infer<typeof RefreshWeatherForecastInputSchema>;

// ─── Open-Meteo hourly forecast response (trust boundary) ────────────────────
// The shape the CF validates the raw Open-Meteo JSON against BEFORE handing it to
// the pure `aggregateForecastWindow`. With `timezone=auto` the hourly `time`
// strings are LOCAL time at the home coordinates (`YYYY-MM-DDTHH:mm`), so the
// 16:00–19:00 filter is a plain hour match — no timezone math. We validate only
// the subset we consume; `timezone` is the resolved IANA zone Open-Meteo echoes
// back. Each hourly array is parallel-indexed with `time`.
export const OpenMeteoForecastResponseSchema = z.object({
  timezone: z.string().min(1),
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: z.array(z.number().nullable()),
    apparent_temperature: z.array(z.number().nullable()),
    relative_humidity_2m: z.array(z.number().nullable()),
    cloud_cover: z.array(z.number().nullable()),
    precipitation_probability: z.array(z.number().nullable()),
    // WMO weather interpretation code per hour (issue #387). Parallel-indexed with
    // `time`. The aggregation reduces the in-window codes to the most-significant
    // one (by `weatherSeverity`) for each day.
    weather_code: z.array(z.number().nullable()),
    // Day/night flag per hour, Open-Meteo's 0/1 integer (NOT a boolean): 1 = day,
    // 0 = night. Parallel-indexed with `time`; the aggregation maps the selected
    // hour's value to the boolean `isDay`.
    is_day: z.array(z.number().nullable()),
  }),
});

export type OpenMeteoForecastResponse = z.infer<typeof OpenMeteoForecastResponseSchema>;
