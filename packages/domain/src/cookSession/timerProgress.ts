import type { CookActiveTimerDoc } from '../schemas/index.js';

// Fraction (0..1) of a timer's run that has ELAPSED, for the progress fill. A
// countdown alone tells you what's left but not how far through you are — "4:00"
// reads very differently on a 5-minute rest than on a 40-minute braise.
//
// Derived from the recipe step's own duration rather than a stored start-time:
// a timer is started as `endsAt = now + duration`, so `total - remaining` is
// exact and no field has to be added to the session doc (nothing to migrate).
// The trade: if the recipe's duration is edited mid-run the ratio is CLAMPED
// rather than wrong — and the "recipe was updated" banner is already up in that
// case.
//
// Returns null when the step (or its timer) has since been deleted from the
// recipe, so the caller renders the chip with no fill instead of a bogus one. A
// zero duration is treated the same way — there is no meaningful fraction of a
// zero-length run.
export function timerProgress(
  timer: CookActiveTimerDoc,
  stepDurationMs: number | null | undefined,
  nowMs: number,
): number | null {
  if (!stepDurationMs) return null;
  const remainingMs = new Date(timer.endsAt).getTime() - nowMs;
  return Math.min(1, Math.max(0, (stepDurationMs - remainingMs) / stepDurationMs));
}
