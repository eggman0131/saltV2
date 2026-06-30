// Static, app-versioned weather-icon assets. The fixed 17-icon set is generated
// once through the canon-icon AI pipeline (see
// apps/cloud-functions/scripts/generate-weather-icons.mjs) and committed as 128px
// WebP with alpha. Unlike canon icons there is no runtime generation, no Firestore
// doc, and no Firebase Storage for these — the set is global and app-versioned, so
// Vite bundles the assets and returns their URLs at build time.
import type { WeatherIconId } from '@salt/domain';

import clearDay from './clear-day.webp';
import clearNight from './clear-night.webp';
import mostlyClearDay from './mostly-clear-day.webp';
import mostlyClearNight from './mostly-clear-night.webp';
import partlyCloudyDay from './partly-cloudy-day.webp';
import partlyCloudyNight from './partly-cloudy-night.webp';
import overcast from './overcast.webp';
import fog from './fog.webp';
import drizzle from './drizzle.webp';
import rainLight from './rain-light.webp';
import rainHeavy from './rain-heavy.webp';
import showersDay from './showers-day.webp';
import showersNight from './showers-night.webp';
import sleet from './sleet.webp';
import snowLight from './snow-light.webp';
import snowHeavy from './snow-heavy.webp';
import thunder from './thunder.webp';

/**
 * Maps each {@link WeatherIconId} to its bundled asset URL. Typed as a total
 * `Record`, so adding or removing an icon id in `@salt/domain` without updating
 * this map is a compile error.
 */
export const WEATHER_ICON_URL: Record<WeatherIconId, string> = {
  'clear-day': clearDay,
  'clear-night': clearNight,
  'mostly-clear-day': mostlyClearDay,
  'mostly-clear-night': mostlyClearNight,
  'partly-cloudy-day': partlyCloudyDay,
  'partly-cloudy-night': partlyCloudyNight,
  overcast,
  fog,
  drizzle,
  'rain-light': rainLight,
  'rain-heavy': rainHeavy,
  'showers-day': showersDay,
  'showers-night': showersNight,
  sleet,
  'snow-light': snowLight,
  'snow-heavy': snowHeavy,
  thunder,
};

/** Resolves a weather-icon id to its asset URL, or `null` when there is no icon. */
export function weatherIconUrl(id: WeatherIconId | null | undefined): string | null {
  return id ? WEATHER_ICON_URL[id] : null;
}
