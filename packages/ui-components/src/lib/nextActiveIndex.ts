// spec: ui-spec-v03.md §3.6 v0.3.5; ui-spec-v04.md §4.2 v0.4
/**
 * Where the active item in a listbox goes when the user presses an arrow, Home
 * or End. Pure — no DOM, no state, no knowledge of what is being navigated.
 *
 * Select and Combobox arrived at the same ten lines of arithmetic by different
 * routes and kept two copies (#929). What is shared is only this: the clamping,
 * and the rule that a first move from "nothing active" lands on the near end in
 * the direction of travel. **Their keyboard handlers are not shared and are not
 * being unified** — they implement two different APG patterns over two different
 * identity models. Select navigates a registry of *values*, filtering disabled
 * items, with typeahead and Space-selects; Combobox navigates an *index* into a
 * filtered array plus a synthetic create row, with Tab-commits and
 * Escape-restores-the-input. One machine serving both would branch on which
 * primitive it was serving in every case.
 *
 * `current` is null when nothing is active — which is what Select's
 * `findIndex` returning -1 means, so it converts before calling.
 */
export function nextActiveIndex(
  current: number | null,
  total: number,
  delta: 1 | -1 | 'first' | 'last',
): number | null {
  if (total <= 0) return null;
  if (delta === 'first') return 0;
  if (delta === 'last') return total - 1;
  // From nothing, a Down goes to the top and an Up to the bottom. From
  // somewhere, movement clamps at the ends rather than wrapping — both callers
  // have always behaved this way, and Combobox's create row is the last index
  // so wrapping would step off it onto the first item.
  if (current === null) return delta > 0 ? 0 : total - 1;
  return Math.max(0, Math.min(total - 1, current + delta));
}
