// spec: ui-spec-v02.md §3.6, §8.1 v0.2.7

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

// NOTE: this module deliberately does NOT read `prefers-reduced-motion`. The
// floor is a timer, not an animation, and what it holds on is `data-pressed` —
// which under `reduce` still renders the pressed SHADE (salt.css keeps the fill
// rules outside the `no-preference` block; only the transform is gated). An
// earlier revision skipped the floor under the preference, back when the press
// was scale-only and a held-but-invisible press really was a pointless delay.
// With a shade in play that would mean a quick tap flashes colour for the true
// pointer-down time — often under a frame — which is the exact "reads as
// nothing happened" the floor exists to prevent. So the floor runs for
// everyone; suppressing the MOVEMENT is CSS's job alone.

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
