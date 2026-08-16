// What a timer starts out as, and which timers earn a push (issues #748, #842).
//
// SHARED because there are now two places a timer can be started from — cook
// mode and My Kitchen — and both must offer the same default and arm the same
// backstop. Two copies of these numbers would drift the moment one was tuned,
// and the drift would be invisible: a timer started from the wrong screen would
// simply, quietly, not push.

/**
 * The default name for a timer nobody has named — cook mode's ad-hoc timer and
 * My Kitchen's standalone one alike.
 *
 * It says where it came from, which matters because these show up on My Kitchen
 * beside timers from cooks that DO name themselves.
 */
export const AD_HOC_TIMER_LABEL = 'Salt Timer';

/** A round ten minutes, which is what "I need a timer" usually means before you tell it otherwise. */
export const AD_HOC_TIMER_MINUTES = 10;

/**
 * The floor below which a timer gets no server-side push backstop.
 *
 * This is a DELIVERY-PRECISION floor, not a "will the chef walk away"
 * heuristic: a queued Cloud Task fires on best-effort scheduling, then pays a
 * dispatch cold start and push-service delivery on top, so a notification can
 * land some seconds late. On a 20-minute braise that is invisible; on a
 * 45-second blanch a late "Timer finished" is actively wrong, and may arrive
 * after the chef has already seen the chip fire. Below the floor the chef is
 * standing at the hob and the chime has it covered.
 *
 * Keeping the floor low also matters the other way: every timer that fires with
 * the app focused is a push that push-sw.js receives and deliberately shows
 * nothing for, and `userVisibleOnly` subscriptions only tolerate so many of
 * those before Chrome starts showing its own "updated in the background"
 * notice. A floor at 90s keeps the swallowed ones to the genuinely-away
 * minority.
 */
export const NOTIFY_MIN_MINUTES = 1.5;

/**
 * Whether a timer of this length earns the push backstop.
 *
 * A function rather than a bare comparison at each call site so the two screens
 * cannot end up on opposite sides of the boundary — and so re-deriving it on
 * every start (which is what makes a stretched timer gain its backstop and a
 * shortened one lose it) is a single call.
 */
export function shouldNotifyFor(durationMinutes: number): boolean {
  return durationMinutes >= NOTIFY_MIN_MINUTES;
}
