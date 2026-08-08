// The duration arithmetic behind the cook timer sheet (issue #748).
//
// PAGE-LOCAL on purpose. This is presentation logic — how far one tap of a −/+
// chip moves a number a human is looking at — not a rule about what a timer IS,
// so it stays beside the sheet that renders the chips rather than going into
// `@salt/domain`. It lives in its own module only so it can be unit tested
// without mounting a component.

/**
 * One tap of `+`.
 *
 * Coarser above the half-hour: below 30 minutes the interesting corrections are
 * a minute at a time ("give it one more"), above it they are five ("another five
 * on the braise") and single-minute taps would be an unusable amount of tapping.
 *
 * The steps are RELATIVE, never snapped to a grid: a typed 32 goes 32 → 37 → 32,
 * because a number the cook typed on purpose is the one they meant, and silently
 * rewriting it to 35 would make the chip untrustworthy for the one case it exists
 * to serve.
 */
export function stepMinutesUp(minutes: number): number {
  return minutes < 30 ? minutes + 1 : minutes + 5;
}

/**
 * One tap of `−`, the exact reverse of {@link stepMinutesUp} — 40 → 35 → 30 → 29.
 * The boundary is `<= 30` rather than `< 30` so that 30 steps DOWN to 29 while 30
 * steps UP to 35, which is what makes the two sequences retrace each other.
 *
 * Floored at 1: a zero-minute timer would fire the instant it started, and a
 * negative one is not a timer at all.
 */
export function stepMinutesDown(minutes: number): number {
  return Math.max(1, minutes <= 30 ? minutes - 1 : minutes - 5);
}

/**
 * The typed duration, or null when it is not a duration yet.
 *
 * Whole minutes only. The field is the same one the −/+ chips write into, and
 * those move in whole minutes; accepting `2.5` here would produce a value no
 * chip could return to. Null is the "can't start that" state the sheet disables
 * its primary button on — including mid-typing, when the field is empty.
 */
export function parseMinutes(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const minutes = Number(trimmed);
  return minutes >= 1 ? minutes : null;
}
