import type { CookActiveTimerDoc } from '../schemas/index.js';

// Fraction (0..1) of a timer's run that has ELAPSED, for the progress fill. A
// countdown alone tells you what's left but not how far through you are — "4:00"
// reads very differently on a 5-minute rest than on a 40-minute braise.
//
// Derived from the timer's total run rather than a stored start-time: a timer is
// started as `endsAt = now + duration`, so `total - remaining` is exact.
//
// That total is `timer.durationMinutes` — what the timer was ACTUALLY started
// for. It used to be looked up from the live recipe step instead, on the argument
// that an edited duration only CLAMPS the ratio (and the "recipe was updated"
// banner is up in that case anyway). That trade no longer holds: a timer may be
// started for a duration its step never mentioned, and the step lookup would then
// not clamp but simply lie. Callers pass the stored duration and fall back to the
// step only for legacy entries written before the field existed.
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
