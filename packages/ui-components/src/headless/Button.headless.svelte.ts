// spec: SPEC.md §3.6, §8.1 v0.2.7

/** Minimum time a press stays visible once it has started.
 *
 * A real tap is often shorter than a frame or two — pointerdown and pointerup
 * can land in the same ~30ms, and a press that is only styled by CSS `:active`
 * would flash for exactly that long, which reads as "nothing happened". The
 * floor holds the pressed state on for a beat so a quick click still visibly
 * presses in and springs back. In step with `--duration-fast` (120ms) in
 * salt.css — the same beat, expressed in the half of the treatment that CSS
 * cannot express. */
export const PRESS_FLOOR_MS = 120;

export type ButtonState = {
  readonly loading: boolean;
  readonly disabled: boolean;
  readonly interactive: boolean; // !disabled && !loading
  /** True while the button should render its pressed treatment. Drives
   * `data-pressed`; salt.css owns what that looks like. */
  readonly pressed: boolean;
  /** Pointer went down / an activation key went down. No-op when the button is
   * not interactive, and idempotent so key auto-repeat cannot restart the floor. */
  press: () => void;
  /** Pointer/key came up, left, or was cancelled. Honours the floor: if the
   * press has not been held long enough yet, the release waits for it. */
  release: () => void;
  /** Drop the press immediately, floor and all — for unmount, and for a button
   * that stops being interactive mid-press. */
  cancel: () => void;
};

// Reduced motion, read live at the moment of a press: the preference can change
// mid-session and there is nothing to subscribe to here. SSR/test-safe and never
// throws — no `window`, no `matchMedia`, or a `matchMedia` that rejects the query
// all read as "no preference". (Inlined rather than imported: ui-components is a
// leaf package and must not reach into the app's `reducedMotion.ts`.)
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function createButtonState(opts: {
  disabled: () => boolean;
  loading: () => boolean;
}): ButtonState {
  let pressed = $state(false);
  let floorTimer: ReturnType<typeof setTimeout> | undefined;
  // A release that arrived before the floor expired, waiting for it.
  let releasePending = false;

  return {
    get loading() {
      return opts.loading();
    },
    get disabled() {
      return opts.disabled();
    },
    get interactive() {
      return !opts.disabled() && !opts.loading();
    },
    get pressed() {
      return pressed;
    },
    press() {
      // Already pressed: a second pointer, or key auto-repeat firing keydown
      // over and over. Neither may restart the floor.
      if (pressed) return;
      // Disabled and loading buttons have nothing to acknowledge (§4.3).
      if (opts.disabled() || opts.loading()) return;
      pressed = true;
      // Reduced motion: the press tracks the pointer exactly and nothing is
      // held artificially. Nothing MOVES either way — that reset lives in CSS,
      // which also covers plain `:active` — but a timed hold is motion the CSS
      // cannot opt out of, so it is skipped rather than played invisibly.
      if (prefersReducedMotion()) return;
      releasePending = false;
      floorTimer = setTimeout(() => {
        floorTimer = undefined;
        if (releasePending) {
          releasePending = false;
          pressed = false;
        }
      }, PRESS_FLOOR_MS);
    },
    release() {
      if (!pressed) return;
      if (floorTimer !== undefined) {
        releasePending = true;
        return;
      }
      pressed = false;
    },
    cancel() {
      // Deliberately writes without reading `pressed`, so it is safe to call
      // from an $effect without the effect depending on its own write.
      if (floorTimer !== undefined) {
        clearTimeout(floorTimer);
        floorTimer = undefined;
      }
      releasePending = false;
      pressed = false;
    },
  };
}
