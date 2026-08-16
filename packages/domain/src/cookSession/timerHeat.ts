/**
 * How hot a running timer is — the four states a countdown passes through on its
 * way to shouting.
 *
 * `resting` → `soon` → `imminent` → `ringing`, and never backwards: urgency only
 * ever increases. (The screen this replaced painted a RUNNING timer amber and a
 * FIRED one primary, so the calmer colour arrived at the louder moment.)
 */
export type TimerHeat = 'resting' | 'soon' | 'imminent' | 'ringing';

/** Under ten minutes stops being "later"; under two it wants you standing there. */
const SOON_MS = 10 * 60_000;
const IMMINENT_MS = 2 * 60_000;

/**
 * The heat of a timer with `remainingMs` left to run.
 *
 * One decision in one place. The card's edge stripe, the dial's sweep, the state
 * word and (later) the nav badge all read this, so they cannot drift into
 * disagreeing about what "imminent" means — the same argument that keeps
 * `timerProgress` here rather than in the page.
 *
 * Pure arithmetic on an already-computed remainder, so there is no clock read
 * (CLAUDE.md Rule 1) and nothing to fake in a test.
 *
 * A fired timer is `ringing` and stays there: it sits in `activeTimers` until
 * somebody dismisses it, so however long ago it went off, it is still going off.
 * NaN — an unparseable `endsAt` — is treated as `ringing` rather than silently
 * reading as calm, because a timer nobody can time is the one you want to look at.
 */
export function timerHeat(remainingMs: number): TimerHeat {
  if (!(remainingMs > 0)) return 'ringing';
  if (remainingMs < IMMINENT_MS) return 'imminent';
  if (remainingMs < SOON_MS) return 'soon';
  return 'resting';
}

/** Whether this heat is one that wants a hand, for anything that counts badges. */
export function heatWantsAttention(heat: TimerHeat): boolean {
  return heat === 'ringing';
}
