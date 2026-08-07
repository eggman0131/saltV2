// Press-and-hold on a single element (issue #714). A Svelte action: hold an
// ingredient in cook mode for ~450ms and it goes on the shopping list.
//
// House action shape: a plain `(node, params) => { update, destroy }`, mirroring
// `swipe` and `stepAnchor`. Page-local on purpose — a gesture is not a UI
// primitive, and ui-spec-v04 §13.4 only promotes to `@salt/ui-components` once a
// SECOND surface wants it (which would need its own spec entry).
//
// POINTER-AGNOSTIC, unlike `swipe`. §13.4's touch-only/reduced-motion gating is
// scoped to the shopping row swipe, where a mouse drag competes with the row's
// own buttons and the buttons are the fallback. A hold competes with nothing, has
// no animation to suppress, and has no button fallback on either cook surface —
// so mouse press-and-hold works too, and reduced motion changes nothing.
//
// COEXISTING WITH THE DECK is the whole design constraint. The step pills sit
// inside the deck's pointer region (`cook-steps-view` binds handlePointerDown/
// Move/Up on an ancestor), and pointer events bubble, so the deck sees the same
// stream this does. Therefore: no `preventDefault()` on pointerdown, and no
// `setPointerCapture` — either would take the pan/fling away from the deck. All
// this action does is listen and count time. A fling that starts on a pill
// travels past `slopPx` within a few frames, which cancels the hold, so the deck
// pages and nothing is added. `touch-action` is deliberately left alone for the
// same reason — the deck owns it.
//
// Firing happens on TIMER EXPIRY while still held (the native long-press feel),
// not on release. That makes the follow-on release something other than a tap, so
// exactly one subsequent `click` is swallowed — otherwise the mise row would also
// toggle and the chip would also expand. Same capture-phase one-shot eater as
// `swipe.swallowNextClick`, with the same timed cleanup so a later genuine tap is
// never eaten.
//
// Never throws (Rule 10 in spirit): a failed haptic is swallowed, and every
// listener is removed on destroy so no timer outlives the component.

import { tick as hapticTick } from './haptics.js';

export interface LongPressOptions {
  /** Master gate from the component. When false the action is inert. */
  enabled?: boolean;
  /** Fired once, on timer expiry, while the pointer is still down and still still. */
  onLongPress: () => void;
}

/** How long the pointer must stay down and (near) still. Native-feeling. */
const HOLD_MS = 450;

/**
 * How far the pointer may travel before the hold is abandoned, in px on either
 * axis. Small enough that a deliberate fling on a step pill always wins; large
 * enough to survive the wobble of a finger resting on glass.
 */
const SLOP_PX = 9;

/** Matches `swipe`'s eater window — long enough for the release's click, short
 *  enough that a later genuine tap is never swallowed. */
const SWALLOW_MS = 350;

export function longpress(node: HTMLElement, options: LongPressOptions) {
  let opts = options;
  let pointerId: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;
  // Whether THIS gesture already fired. Kept until the pointer sequence ends so
  // the context menu that Android raises just after our own hold can be refused.
  let fired = false;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** Abandon whatever is in flight. Safe to call at any point, any number of times. */
  function cancel(): void {
    clearTimer();
    pointerId = null;
  }

  function swallowNextClick(): void {
    const eat = (event: MouseEvent): void => {
      event.stopPropagation();
      event.preventDefault();
      node.removeEventListener('click', eat, true);
    };
    node.addEventListener('click', eat, true);
    setTimeout(() => node.removeEventListener('click', eat, true), SWALLOW_MS);
  }

  function fire(): void {
    timer = null;
    fired = true;
    swallowNextClick();
    hapticTick(); // self-guarding: a device that can't buzz returns quietly
    opts.onLongPress();
  }

  function onPointerDown(event: PointerEvent): void {
    // A second finger landing mid-hold is a pinch or a two-handed grab, not a
    // press — drop the pending hold rather than racing it.
    if (pointerId !== null) {
      cancel();
      return;
    }
    if (opts.enabled === false) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    fired = false;
    timer = setTimeout(fire, HOLD_MS);
  }

  function onPointerMove(event: PointerEvent): void {
    if (pointerId !== event.pointerId || timer === null) return;
    // Either axis: a vertical fling on a step pill is a deck page, a horizontal
    // drag is a scroll or a stray. Neither is a hold.
    if (Math.abs(event.clientX - startX) > SLOP_PX || Math.abs(event.clientY - startY) > SLOP_PX) {
      cancel();
    }
  }

  function onPointerEnd(event: PointerEvent): void {
    if (pointerId !== event.pointerId) return;
    // On a release AFTER firing this only tidies up — the click swallow is
    // already armed and is what stops the tap handler underneath.
    cancel();
  }

  function onContextMenu(event: MouseEvent): void {
    // Android raises this at ~500ms over a held element, just after our own
    // hold has landed. Refuse it so the platform menu never covers the toast;
    // otherwise it is simply a gesture we are not going to complete.
    if (fired) event.preventDefault();
    cancel();
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', onPointerEnd);
  node.addEventListener('pointercancel', onPointerEnd);
  node.addEventListener('pointerleave', onPointerEnd);
  node.addEventListener('contextmenu', onContextMenu);

  return {
    update(next: LongPressOptions): void {
      opts = next;
      if (opts.enabled === false) cancel();
    },
    destroy(): void {
      cancel();
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerEnd);
      node.removeEventListener('pointercancel', onPointerEnd);
      node.removeEventListener('pointerleave', onPointerEnd);
      node.removeEventListener('contextmenu', onContextMenu);
    },
  };
}
