// Pure WMO weather-code severity ranking (issue #387). NO I/O, no side effects
// (CLAUDE.md Rule 1): ALL "which code matters most" POLICY lives here — the rank
// table and the picker. `aggregateForecastWindow` uses this to collapse a window
// of hourly weather codes into the single MOST-SIGNIFICANT one (the condition a
// glance at the planner cell should convey). Modelled on `temperatureBand`: a
// policy table + a pure total function with a graceful fallback (never throws).

// WMO codes grouped least→most significant, ascending. The INDEX of a group is
// its rank, so a later group out-ranks an earlier one. A code's rank is the rank
// of the group it appears in; an unknown code gets `UNKNOWN_RANK` (below every
// real condition) so a stray code can never out-rank a genuine one. Ordering
// mirrors the icon-mapper's collapsed set: clear < cloud < fog < drizzle < light
// rain < showers < sleet/freezing < heavy rain < light snow < heavy snow <
// thunder. Showers rank above steady light rain (a heavier, more salient burst);
// freezing/sleet and snow rank above plain rain (more disruptive); thunder is the
// most significant.
const SEVERITY_GROUPS: ReadonlyArray<readonly number[]> = [
  [0], // clear sky
  [1], // mainly clear
  [2], // partly cloudy
  [3], // overcast
  [45, 48], // fog / depositing rime fog
  [51, 53, 55], // drizzle (light/moderate/dense)
  [61, 63], // rain (slight/moderate)
  [80, 81, 82], // rain showers (slight/moderate/violent)
  [56, 57, 66, 67], // freezing drizzle / freezing rain (sleet)
  [65], // rain (heavy)
  [71, 73, 77, 85], // snow (slight/moderate) + snow grains + snow showers slight
  [75, 86], // snow (heavy) + snow showers heavy
  [95, 96, 99], // thunderstorm (+ with hail)
] as const;

// Rank for any code not in the table. Below every real condition (which start at
// rank 0) so an unrecognised code is never chosen over a known one when both are
// present in a window.
const UNKNOWN_RANK = -1;

// Precomputed code → rank lookup, built once from the policy table so the hot
// path is a plain map read rather than a nested scan per sample.
const RANK_BY_CODE: ReadonlyMap<number, number> = new Map(
  SEVERITY_GROUPS.flatMap((group, rank) => group.map((code) => [code, rank] as const)),
);

// Severity rank of a single WMO weather code. Higher = more significant/severe.
// Unknown or non-finite input degrades to `UNKNOWN_RANK` rather than throwing, so
// a corrupt sample can never crash the aggregation. Pure and total.
export function weatherSeverity(code: number): number {
  if (!Number.isFinite(code)) return UNKNOWN_RANK;
  return RANK_BY_CODE.get(code) ?? UNKNOWN_RANK;
}

// Picks the most-significant code from a window of samples: the one with the
// highest `weatherSeverity` rank. Returns the FIRST sample at the max rank, so a
// run of equal-severity codes resolves to the earliest in-window hour (stable,
// order-deterministic) — the caller relies on this to pick a matching is_day. An
// empty array returns null (no code to choose). Pure and total.
export function mostSignificantWeatherCode(codes: readonly number[]): number | null {
  let bestCode: number | null = null;
  let bestRank = -Infinity;
  for (const code of codes) {
    const rank = weatherSeverity(code);
    if (rank > bestRank) {
      bestRank = rank;
      bestCode = code;
    }
  }
  return bestCode;
}
