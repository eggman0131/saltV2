import { untrack } from 'svelte';
import { prefersReducedMotion } from 'svelte/motion';

/**
 * The one spring in the app: a plain integrator over a single number, seeded with the
 * velocity a released gesture left behind.
 *
 * Lifted out of `deck.svelte.ts` so a surface that is NOT a paging deck can have the same
 * feel without a second copy of the physics (issue #696 — the chat drawer moves its own
 * height between two stops rather than paging a column, so it cannot use `createDeck`
 * itself, but it must spring and settle exactly as cook mode does).
 *
 * Svelte's `Spring` has `preserveMomentum` for precisely this, and still cannot be used:
 * it derives velocity from its own last two values, and the `{ instant: true }` sets that
 * 1:1 finger tracking requires assign `last_value` alongside `current` — zeroing that
 * velocity on every move. Tracking the finger with a plain `set` keeps the velocity but
 * gives up the 1:1 feel, and lags on 120Hz screens where its fixed `dt` covers only half a
 * frame. Hence this integrator, seeded with the velocity measured off the pointer itself.
 */

const STIFFNESS = 170; // with DAMPING → ζ ≈ 0.61, about 10% overshoot
const DAMPING = 16;
/**
 * Long jumps ("Resume · step 9") are where a spring turns violent, because its force
 * scales with displacement. Capping speed keeps the physics for the short travel that
 * dominates while stopping a big jump from being fired across the screen.
 */
const MAX_SPEED = 2600; // px/s

export function createDeckSpring(initial = 0) {
  let value = $state(initial);
  let frame: number | null = null;

  function stop(): void {
    if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    frame = null;
  }

  return {
    /** The live value. Drive a transform, a height or an offset off this. */
    get current(): number {
      return value;
    },
    /** Put it AT `next` with no travel — tracking a thumb, or where something starts. */
    place(next: number): void {
      value = next;
    },
    /**
     * Travel to `target`. `velocity0` is in px/s and is what makes a released fling read
     * as a continuation of the swipe rather than a new movement. Reduced motion jumps.
     */
    animateTo(target: number, velocity0 = 0): void {
      stop();
      if (prefersReducedMotion.current || typeof requestAnimationFrame !== 'function') {
        value = target;
        return;
      }
      // Untracked, and load-bearing: seeding the animation from where the value is now is
      // a READ, so a caller who starts a travel from inside an `$effect` would otherwise
      // make that effect depend on every frame the spring goes on to produce — and each
      // frame would re-run it, restarting the animation forever. Where a spring starts is
      // never a reason to re-run the code that launched it.
      let position = untrack(() => value);
      let velocity = velocity0;
      let last = -1;
      const tick = (now: number): void => {
        if (last < 0) last = now;
        const dt = Math.min(0.032, (now - last) / 1000); // clamp: a stalled tab must not explode
        last = now;
        const acceleration = -STIFFNESS * (position - target) - DAMPING * velocity;
        velocity = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, velocity + acceleration * dt));
        position += velocity * dt;
        if (Math.abs(position - target) < 0.5 && Math.abs(velocity) < 30) {
          value = target;
          frame = null;
          return;
        }
        value = position;
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    },
    stop,
  };
}

export type DeckSpring = ReturnType<typeof createDeckSpring>;
