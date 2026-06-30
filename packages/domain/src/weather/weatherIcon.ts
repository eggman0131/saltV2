import type { WeatherDaySummary } from '../schemas/index.js';

// Pure WMO-code → icon-id mapping (issue #387). NO I/O, no side effects
// (CLAUDE.md Rule 1): ALL "which pictogram represents this weather" POLICY lives
// here — the icon-id union, the WMO→icon collapse, and the day/night variant
// choice. The view layer only maps the returned id → an asset path, never
// deciding the mapping itself. Modelled on `temperatureBand`/`classifyEatingMood`:
// a policy table + a pure total function with a graceful fallback.

// The fixed set of icon ids the planner can render — EXACTLY 17. Day/night pairs
// exist only where the sky condition reads differently at night (clear, mostly-
// clear, partly-cloudy, showers); overcast/fog/precip have no night variant. The
// view layer ships one asset per id.
export type WeatherIconId =
  | 'clear-day'
  | 'clear-night'
  | 'mostly-clear-day'
  | 'mostly-clear-night'
  | 'partly-cloudy-day'
  | 'partly-cloudy-night'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain-light'
  | 'rain-heavy'
  | 'showers-day'
  | 'showers-night'
  | 'sleet'
  | 'snow-light'
  | 'snow-heavy'
  | 'thunder';

// A day/night icon pair: the variant chosen by the window's `isDay` flag.
interface DayNightVariant {
  readonly day: WeatherIconId;
  readonly night: WeatherIconId;
}

// WMO code → icon id (or a day/night pair). The collapse mirrors
// `weatherSeverity`'s groups: each group of WMO codes maps to the one icon that
// represents the group. Codes absent from this table are unknown → no icon.
const ICON_BY_CODE: ReadonlyMap<number, WeatherIconId | DayNightVariant> = new Map<
  number,
  WeatherIconId | DayNightVariant
>([
  [0, { day: 'clear-day', night: 'clear-night' }], // clear sky
  [1, { day: 'mostly-clear-day', night: 'mostly-clear-night' }], // mainly clear
  [2, { day: 'partly-cloudy-day', night: 'partly-cloudy-night' }], // partly cloudy
  [3, 'overcast'], // overcast
  [45, 'fog'], // fog
  [48, 'fog'], // depositing rime fog
  [51, 'drizzle'], // drizzle light
  [53, 'drizzle'], // drizzle moderate
  [55, 'drizzle'], // drizzle dense
  [61, 'rain-light'], // rain slight
  [63, 'rain-light'], // rain moderate
  [65, 'rain-heavy'], // rain heavy
  [80, { day: 'showers-day', night: 'showers-night' }], // rain showers slight
  [81, { day: 'showers-day', night: 'showers-night' }], // rain showers moderate
  [82, { day: 'showers-day', night: 'showers-night' }], // rain showers violent
  [56, 'sleet'], // freezing drizzle light
  [57, 'sleet'], // freezing drizzle dense
  [66, 'sleet'], // freezing rain light
  [67, 'sleet'], // freezing rain heavy
  [71, 'snow-light'], // snow slight
  [73, 'snow-light'], // snow moderate
  [77, 'snow-light'], // snow grains
  [85, 'snow-light'], // snow showers slight
  [75, 'snow-heavy'], // snow heavy
  [86, 'snow-heavy'], // snow showers heavy
  [95, 'thunder'], // thunderstorm
  [96, 'thunder'], // thunderstorm with slight hail
  [99, 'thunder'], // thunderstorm with heavy hail
]);

function isVariant(entry: WeatherIconId | DayNightVariant): entry is DayNightVariant {
  return typeof entry !== 'string';
}

// Maps a day summary's `weatherCode` (+ `isDay`) to an icon id. Returns null when
// `weatherCode` is absent/undefined (an older cached doc, or a day with no
// in-window sample — the caller renders no icon) or when the code is unknown
// (graceful — never throws, never invents an icon). For day/night pairs the
// `-night` variant is chosen only when `isDay === false`; a missing/true `isDay`
// is treated as day, so a forecast that somehow lacks the flag still renders the
// (more common, daytime-evening-window) day variant. Pure and total.
export function weatherIcon(summary: WeatherDaySummary): WeatherIconId | null {
  const code = summary.weatherCode;
  if (typeof code !== 'number') return null;

  const entry = ICON_BY_CODE.get(code);
  if (entry === undefined) return null;

  if (isVariant(entry)) {
    return summary.isDay === false ? entry.night : entry.day;
  }
  return entry;
}
