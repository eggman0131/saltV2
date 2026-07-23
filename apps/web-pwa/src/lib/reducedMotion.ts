// Reduced-motion preference, for the JS half of a motion treatment.
//
// CSS motion is disabled the way the rest of this repo disables it: a
// `motion-reduce:` variant paired inline in the class string. That only reaches
// CSS. A timer that holds a row in the DOM while an animation plays, or a call to
// `navigator.vibrate`, has no class to opt out of — left ungated they would turn
// "reduce motion" into "the same delay, invisibly", which is worse than the
// animation it replaced. Those read the preference here instead, so the fallback
// is genuinely today's instant behaviour.
//
// Read live on every call rather than cached: the preference can change mid-session
// (an OS accessibility toggle), and there is nothing to subscribe to at these call
// sites — they are one-shot, at the moment of a tap.
//
// SSR/test-safe and never throws: no `window`, no `matchMedia`, or a `matchMedia`
// that rejects the query all read as "no preference" — the same honest default
// `tests/setup.ts` stubs for jsdom.
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
