// Pure heat-band classification (issue #382, Phase 3). NO I/O, no side effects
// (CLAUDE.md Rule 1): ALL temperature-colour POLICY lives here — the band enum
// and the cutoffs. The view layer only maps the returned band → a tailwind colour
// class (a small lookup), never deciding cutoffs itself.

// A coarse heat band spanning cool→warm. Six steps give the planner cell enough
// resolution to read "is it a hot evening or a cold one" at a glance without a
// rainbow of near-identical colours.
export type TemperatureBand = 'freezing' | 'cold' | 'cool' | 'mild' | 'warm' | 'hot';

// The whole-degree cutoffs, in ascending order. Each entry is the INCLUSIVE lower
// bound at which that band starts; the first matching band from the top down (or
// the implicit 'freezing' below the lowest cutoff) wins. Tuned for a temperate
// climate's late-afternoon window (the home-location default is London): a "warm"
// evening starts around 21°C, "hot" at 28°C, and sub-zero reads as "freezing".
const BAND_CUTOFFS: ReadonlyArray<readonly [TemperatureBand, number]> = [
  ['hot', 28],
  ['warm', 21],
  ['mild', 15],
  ['cool', 8],
  ['cold', 0],
] as const;

// Classifies a temperature (°C) into a heat band. The CALLER decides WHICH
// temperature to pass: the planner tints by the window HIGH (`tempHigh`) — the
// warmest, most salient part of the evening window and the clearest "is it hot"
// signal — but the function itself is metric-agnostic so it stays reusable and
// trivially testable. Non-finite input (NaN/Infinity) degrades to the coldest
// band rather than throwing, so a corrupt sample can never crash a render.
export function temperatureBand(tempC: number): TemperatureBand {
  if (!Number.isFinite(tempC)) return 'freezing';
  for (const [band, lowerInclusive] of BAND_CUTOFFS) {
    if (tempC >= lowerInclusive) return band;
  }
  return 'freezing';
}
