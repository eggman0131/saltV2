import type { ShoppingDayDoc } from '../schemas/index.js';

/**
 * The one shop day for a week, given the docs a week range read returned.
 *
 * There is exactly ONE shop per week by policy (marking a day clears any other in
 * that week), but a range read can transiently see two — a concurrent mark from
 * another device, or a delete that has not landed yet. The earliest date wins:
 * whichever is real, shading up to the FIRST shop is the answer that never claims
 * a day is unprovisioned when it might not be.
 *
 * Pure — no I/O, no clock (CLAUDE.md Rule 1).
 */
export function shopDayForWeek(days: readonly ShoppingDayDoc[]): ShoppingDayDoc | null {
  return days.reduce<ShoppingDayDoc | null>(
    (earliest, d) => (earliest === null || d.date < earliest.date ? d : earliest),
    null,
  );
}
