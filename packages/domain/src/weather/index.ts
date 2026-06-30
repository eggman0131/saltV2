// Weather module (issue #382, Phase 2). Pure forecast aggregation + staleness
// logic over already-fetched, validated data. No I/O (CLAUDE.md Rule 1).
export {
  aggregateForecastWindow,
  isForecastStale,
  FORECAST_MAX_AGE_MS,
} from './aggregateForecastWindow.js';
