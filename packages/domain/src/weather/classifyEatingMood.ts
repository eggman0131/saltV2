import type { WeatherDaySummary } from '../schemas/index.js';

// Pure eat-mood classification (issue #382, Phase 3). NO I/O, no side effects
// (CLAUDE.md Rule 1): ALL eat-mood POLICY lives here — the enum, the thresholds,
// and the heuristic that blends feels-like temperature with humidity, cloud cover
// and rain chance. The view layer only maps the returned mood → a glyph + label.
//
// The cue answers "what's the evening like to eat in": a cold, damp, grey, rainy
// evening calls for hot comfort food (a stew); a warm, dry, clear evening calls
// for something cold and fresh (a salad); everything between is neutral.

// The eat-mood the evening window suggests. `'hot-comfort'` ↔ cold/damp/grey
// (warming, hearty); `'cold-fresh'` ↔ warm/dry/clear (light, cooling);
// `'neutral'` is the unremarkable middle.
export type EatingMood = 'hot-comfort' | 'neutral' | 'cold-fresh';

// Feels-like (apparent) temperature is the PRIMARY driver — it's how the evening
// actually feels to a person deciding what to cook. These °C cutoffs bracket the
// clear poles; the band between is where the secondary signals tip the decision.
const COMFORT_FEELS_LIKE_MAX = 12; // at/below → leans hot-comfort outright
const FRESH_FEELS_LIKE_MIN = 22; // at/above → leans cold-fresh outright

// Secondary signals (all %). Damp/grey/wet pushes toward comfort; dry/clear pushes
// toward fresh. They only decide the ambiguous middle band; the temperature poles
// above already commit on their own.
const HUMID_THRESHOLD = 75; // ≥ → damp (comfort-leaning)
const DRY_THRESHOLD = 55; // ≤ → dry (fresh-leaning)
const CLOUDY_THRESHOLD = 70; // ≥ → grey (comfort-leaning)
const CLEAR_THRESHOLD = 40; // ≤ → clear (fresh-leaning)
const RAINY_THRESHOLD = 40; // ≥ → wet (comfort-leaning)

// Classifies the evening window's eat-mood from a day summary. Feels-like temp
// decides the poles outright; in the ambiguous middle band the damp/grey/wet vs
// dry/clear signals are tallied and the stronger side wins (ties → neutral). Pure
// and total: every finite input maps to exactly one mood, so the view never has to
// handle a missing case.
export function classifyEatingMood(summary: WeatherDaySummary): EatingMood {
  const feels = summary.apparentTemp;

  // Temperature poles commit on their own — a genuinely cold or genuinely warm
  // evening sets the mood regardless of the sky.
  if (feels <= COMFORT_FEELS_LIKE_MAX) return 'hot-comfort';
  if (feels >= FRESH_FEELS_LIKE_MIN) return 'cold-fresh';

  // Ambiguous middle: let damp/grey/wet vs dry/clear break the tie.
  let comfortPoints = 0;
  let freshPoints = 0;

  if (summary.humidity >= HUMID_THRESHOLD) comfortPoints++;
  else if (summary.humidity <= DRY_THRESHOLD) freshPoints++;

  if (summary.cloudCover >= CLOUDY_THRESHOLD) comfortPoints++;
  else if (summary.cloudCover <= CLEAR_THRESHOLD) freshPoints++;

  if (summary.precipitationChance >= RAINY_THRESHOLD) comfortPoints++;

  if (comfortPoints > freshPoints) return 'hot-comfort';
  if (freshPoints > comfortPoints) return 'cold-fresh';
  return 'neutral';
}
