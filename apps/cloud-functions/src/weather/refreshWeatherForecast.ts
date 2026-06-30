import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { aggregateForecastWindow, isForecastStale } from '@salt/domain';
import {
  AppSettingsSchema,
  OpenMeteoForecastResponseSchema,
  WeatherForecastSchema,
  type HomeLocation,
  type RefreshWeatherForecastInput,
  type WeatherForecast,
} from '@salt/domain/schemas';

// Forecast fetch + cache pipeline (issue #382, Phase 2). Server-side only — the
// CF reads the family home location, re-checks cache staleness, fetches ~14 days
// of HOURLY Open-Meteo data, reduces the 16:00–19:00 local window per day via the
// PURE-domain aggregateForecastWindow, and writes the weatherForecast/singleton
// cache doc. Firestore I/O uses the firebase-admin SDK exactly like the other CFs
// (cloud-functions does NOT depend on firebase-sync — CLAUDE.md layer map / Rule
// 2). The shared WeatherForecastSchema (domain) is the single source of truth for
// the doc shape, used by both this write and the firebase-sync client read.

const APP_SETTINGS_COLLECTION = 'appSettings';
const FORECAST_COLLECTION = 'weatherForecast';
const SINGLETON_DOC_ID = 'singleton';

// ~14-day hourly horizon. timezone=auto makes the hourly `time` strings LOCAL
// time at the home coordinates, so the 16:00–19:00 window is a plain hour filter
// (no timezone math). Keyless host — no secret, no SSRF hardening (the host is
// fixed and trusted), no withAiTimeout (this isn't an AI call).
const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';
const HOURLY_VARS =
  'temperature_2m,apparent_temperature,relative_humidity_2m,cloud_cover,precipitation_probability,weather_code,is_day';
const FORECAST_DAYS = 14;
// Wall-clock cap for the whole fetch, modelled on the CF external-fetch timeout
// pattern (AbortController + setTimeout) used by ssrfFetch.
const FETCH_TIMEOUT_MS = 12_000;

// Outcome of a refresh. `skipped` true means the cache was still fresh and the
// external fetch was skipped (the staleness re-check); `forecast` is the doc that
// is now current (the existing fresh one when skipped, or the freshly written one
// otherwise). `homeLocationSet` false means no home location is configured, so
// there is nothing to fetch.
export interface RefreshWeatherForecastResult {
  readonly homeLocationSet: boolean;
  readonly skipped: boolean;
  readonly forecast: WeatherForecast | null;
}

// Reads the family home location from appSettings/singleton. Returns null when no
// doc exists, the doc is invalid, or no homeLocation is set — the caller treats
// all three as "nothing to fetch".
async function readHomeLocation(): Promise<HomeLocation | null> {
  const snap = await getFirestore().collection(APP_SETTINGS_COLLECTION).doc(SINGLETON_DOC_ID).get();
  if (!snap.exists) return null;
  const parsed = AppSettingsSchema.safeParse(snap.data());
  if (!parsed.success) {
    logger.warn('refreshWeatherForecast: invalid appSettings doc; no home location');
    return null;
  }
  return parsed.data.homeLocation ?? null;
}

// Reads the existing forecast cache (weatherForecast/singleton), or null when
// absent/invalid. An invalid cached doc is treated as absent so a corrupt cache
// can never block a refetch.
async function readForecastCache(): Promise<WeatherForecast | null> {
  const snap = await getFirestore().collection(FORECAST_COLLECTION).doc(SINGLETON_DOC_ID).get();
  if (!snap.exists) return null;
  const parsed = WeatherForecastSchema.safeParse(snap.data());
  if (!parsed.success) {
    logger.warn('refreshWeatherForecast: invalid cached forecast doc; treating as absent');
    return null;
  }
  return parsed.data;
}

// Fetches the Open-Meteo hourly forecast for the home coordinates with a hard
// timeout, and validates the JSON at the trust boundary. Throws on network/HTTP
// failure or a malformed payload — the callable entrypoint reports + re-throws.
async function fetchForecast(location: HomeLocation): Promise<{
  response: ReturnType<typeof OpenMeteoForecastResponseSchema.parse>;
}> {
  const url =
    `${OPEN_METEO_BASE}?latitude=${location.latitude}&longitude=${location.longitude}` +
    `&hourly=${HOURLY_VARS}&timezone=auto&forecast_days=${FORECAST_DAYS}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Open-Meteo responded ${res.status}`);
    }
    const raw: unknown = await res.json();
    // Trust boundary: validate the external JSON before the pure aggregation.
    const response = OpenMeteoForecastResponseSchema.parse(raw);
    return { response };
  } finally {
    clearTimeout(timer);
  }
}

// Orchestrates a refresh. `force` (from the admin button) bypasses the staleness
// skip. Returns a structured result so the caller can report skip-vs-fetch
// without surfacing internals.
export async function runRefreshWeatherForecast(
  input: RefreshWeatherForecastInput,
): Promise<RefreshWeatherForecastResult> {
  const location = await readHomeLocation();
  if (!location) {
    logger.info('refreshWeatherForecast: no home location set; nothing to fetch');
    return { homeLocationSet: false, skipped: false, forecast: null };
  }

  // Server-side staleness re-check: skip the external fetch when an existing
  // cache is still fresh, same-location, and the caller did not force. This
  // prevents redundant fetches when several clients open the planner at once.
  const cache = await readForecastCache();
  const force = input.force === true;
  if (!force && !isForecastStale(cache, location, Date.now())) {
    return { homeLocationSet: true, skipped: true, forecast: cache };
  }

  const { response } = await fetchForecast(location);
  const days = aggregateForecastWindow(response);
  const forecast: WeatherForecast = {
    days,
    fetchedAt: Date.now(),
    location,
    timezone: response.timezone,
  };

  await getFirestore().collection(FORECAST_COLLECTION).doc(SINGLETON_DOC_ID).set(forecast);

  logger.info('refreshWeatherForecast: wrote forecast cache', {
    days: Object.keys(days).length,
    timezone: forecast.timezone,
  });
  return { homeLocationSet: true, skipped: false, forecast };
}
