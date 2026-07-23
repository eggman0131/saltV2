// Haptic feedback wrapper (lively shopping list, Phase 1). A thin, feature-detected
// wrapper around the Vibration API (`navigator.vibrate`) so a confirming tap — checking
// an item off, confirming a flagged one — can acknowledge itself with a single light
// tick. This is an OUTPUT API, not storage: no Rule 3 concern.
//
// Progressive enhancement, deliberately. iOS Safari exposes no `navigator.vibrate`
// at all, so on an iPhone every call here is a silent no-op — and that is the whole
// iOS story. Four of the five people using Salt are on Android, which is where the
// tick lands; a WebKit haptics bridge for the fifth is not worth building.
//
// Never throws (Rule 10 in spirit — a failure to buzz is not worth surfacing).
// An unsupported browser, a `vibrate` refused for want of user activation, a
// platform that advertises the API and then rejects the call, and a user who has
// asked for reduced motion all return quietly.

import { prefersReducedMotion } from './reducedMotion.js';

// One short pulse. Long enough to register as a tick against a fingertip, short
// enough not to read as a buzz or an error signal.
const TICK_MS = 10;

// Minimal structural type: the DOM lib types `vibrate` on Navigator, but only
// where the config includes it, and we touch exactly this one method.
interface VibrateCapable {
  vibrate(pattern: number | readonly number[]): boolean;
}

function vibrateApi(): VibrateCapable | null {
  if (typeof navigator === 'undefined') return null;
  if (!('vibrate' in navigator)) return null;
  return navigator as unknown as VibrateCapable;
}

// Feature-detect guard. Exported for callers that want to know (and for tests);
// `tick()` guards itself, so it is never required before calling.
export function isHapticsSupported(): boolean {
  return vibrateApi() !== null;
}

// A single light tick, for a tap that CONFIRMS something: checking an item off,
// confirming a flagged one. Not for corrections (unchecking) and not for
// navigation — a device that buzzes at everything stops meaning anything.
export function tick(): void {
  if (prefersReducedMotion()) return;
  const api = vibrateApi();
  if (api === null) return;
  try {
    api.vibrate(TICK_MS);
  } catch {
    // Refused (no user activation), or a platform that advertises the API and
    // then throws. Nothing to recover — the tap already did its real work.
  }
}
