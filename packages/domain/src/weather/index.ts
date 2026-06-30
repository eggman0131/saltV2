// Weather module (issue #382). Pure forecast aggregation + staleness logic
// (Phase 2) and pure render-policy classifiers (Phase 3) over already-fetched,
// validated data. No I/O (CLAUDE.md Rule 1).
export {
  aggregateForecastWindow,
  isForecastStale,
  FORECAST_MAX_AGE_MS,
} from './aggregateForecastWindow.js';
export { temperatureBand } from './temperatureBand.js';
export type { TemperatureBand } from './temperatureBand.js';
export { classifyEatingMood } from './classifyEatingMood.js';
export type { EatingMood } from './classifyEatingMood.js';
