// Check-in identity (issue #751, Phase 3).
//
// A guided plan's check-in — "twenty minutes into the braise, check the heat" —
// is an ORDINARY `activeTimers` entry. It rides the existing Cloud Tasks → push
// path with no server code of its own: `onCookTimerWrite` loops over the array
// and enqueues one task per newly-keyed entry, so N check-ins in the same write
// simply produce N more tasks.
//
// But a check-in has NO IDENTITY in the guided-plan document — `GuidedCheckInDoc`
// is `{ atMinutes, text }`, a list of reminders, not a list of things. An
// `activeTimers` entry needs one (it is the enqueue diff key, the Cloud Task
// payload, the delivery-ledger id, the alert dedupe key and the list key), so the
// id is DERIVED from the two things that do identify it: the timer it hangs off,
// and how far into that timer it sits.
//
// That derivation is the only handle anything else has on a check-in:
//   - `withTimerStarted` uses it to tell a carried-over check-in from a fresh one;
//   - `withTimerDismissed` uses it to take a timer's check-ins down with it;
//   - the pages use it to keep check-ins out of the per-step timer lookup and out
//     of "My" (a check-in is a nudge, never a thing that wants a hand).
//
// COLLISION SAFETY. The separator cannot occur inside the ids it joins: a step id
// and an ad-hoc timer id are both `crypto.randomUUID()`, which is hex and dashes.
// Two check-ins authored at the SAME minute on the same step would derive the same
// id — `withTimerStarted` drops the duplicate rather than let two entries share a
// key (the timers bar keys its list by id, and duplicate keys are a render error).
const CHECK_IN_SEPARATOR = '::chk:';

/** The `activeTimers` id for the check-in `atMinutes` into the timer `timerId`. */
export function checkInTimerId(timerId: string, atMinutes: number): string {
  return `${timerId}${CHECK_IN_SEPARATOR}${atMinutes}`;
}

/** Whether this entry is a check-in rather than a timer the cook started. */
export function isCheckInTimerId(id: string): boolean {
  return id.includes(CHECK_IN_SEPARATOR);
}

/** Whether this entry is one of `timerId`'s own check-ins. */
export function isCheckInOf(id: string, timerId: string): boolean {
  return id.startsWith(`${timerId}${CHECK_IN_SEPARATOR}`);
}
