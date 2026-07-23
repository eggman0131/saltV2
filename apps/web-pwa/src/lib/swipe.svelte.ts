// Touch-only horizontal swipe on a single shopping row (lively shopping list,
// Phase 4). A Svelte action, coarse-pointer gated: swipe a row right past +78px to
// check it off (Phase 1's celebration), left past -78px to delete it (Phase 2's
// undo snackbar). A short swipe springs back.
//
// House action shape: a plain `(node, params) => { update, destroy }`, mirroring
// `stepAnchor` in CookModePage. The gesture itself mirrors CookModePage's pointer
// swipe — Pointer Events filtered to `pointerType === 'touch'`, a `DRAG_START_PX`
// tap/scroll guard, `setPointerCapture` for the life of the drag — but the release
// DECISION (which threshold, spring back) is pure arithmetic in `./swipe.js`, kept
// DOM-free so it can be unit-tested.
//
// TOUCH-ONLY, by decision (see ui-spec-v04 §13.4): the action no-ops on fine/mouse
// pointers and under reduced motion, so on a desktop rows are not draggable at all
// and the buttons remain the primary action. `touch-action: pan-y` (set on the node
// in the template) keeps vertical scrolling alive through a drag attempt. Never
// throws (Rule 10 in spirit — a failed capture just degrades to a working drag).

import { prefersReducedMotion } from './reducedMotion.js';
import { tick as hapticTick } from './haptics.js';
import { resolveSwipe, crossedThreshold, isHorizontalDrag } from './swipe.js';

export interface SwipeOptions {
  /**
   * Master gate from the component (excluded row types, selection mode, mid-
   * celebration). When false the action is inert — no drag, no transform. The
   * touch-only / reduced-motion gates below are additional, checked at pointer-down.
   */
  enabled: boolean;
  /** Released past +78px (swipe right) — runs the same check path as the button. */
  onCheck: () => void;
  /** Released past -78px (swipe left) — runs the shared deferred-delete + undo. */
  onDelete: () => void;
  /** Live horizontal offset in px (0 at rest), for the reveal-behind layers. */
  onProgress?: (dx: number) => void;
}

// Spring-back / settle ease when the finger lifts. Non-overshooting so a released
// short swipe never flashes the opposite reveal layer on its way home.
const SETTLE_MS = 200;
const SETTLE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

// The device gate: a coarse primary pointer (a finger). Read live and SSR/throw-safe,
// the same honest default the rest of the repo uses for a missing `matchMedia`.
function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export function swipe(node: HTMLElement, options: SwipeOptions) {
  let opts = options;
  let pointerId: number | null = null;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let lastDx = 0;

  function report(next: number): void {
    dx = next;
    node.style.transform = next === 0 ? '' : `translateX(${next}px)`;
    opts.onProgress?.(next);
  }

  // Ease the row home (or off the mark a committed swipe left it at). Leaves the
  // inline transition in place; the next pointer-down clears it so a fresh drag
  // tracks the finger 1:1 rather than through the ease.
  function settle(target: number): void {
    node.style.transition = `transform ${SETTLE_MS}ms ${SETTLE_EASE}`;
    node.style.transform = target === 0 ? 'translateX(0px)' : `translateX(${target}px)`;
    dx = target;
    opts.onProgress?.(target);
  }

  function capture(id: number): void {
    try {
      node.setPointerCapture(id);
    } catch {
      // Synthetic or already-released pointer id: capture is best-effort, the drag
      // still works through the node-level listeners.
    }
  }

  function releaseCapture(id: number): void {
    try {
      node.releasePointerCapture(id);
    } catch {
      // Never held / already gone — nothing to release.
    }
  }

  // A committed drag that ends over the row's edit button would otherwise fire a
  // click and open the sheet. Eat exactly one click (capture phase), then clean up
  // if none arrives so a later genuine tap is never swallowed.
  function swallowNextClick(): void {
    const eat = (event: MouseEvent): void => {
      event.stopPropagation();
      event.preventDefault();
      node.removeEventListener('click', eat, true);
    };
    node.addEventListener('click', eat, true);
    setTimeout(() => node.removeEventListener('click', eat, true), 350);
  }

  function abandon(): void {
    if (pointerId !== null) releaseCapture(pointerId);
    pointerId = null;
    dragging = false;
  }

  function onPointerDown(event: PointerEvent): void {
    if (!opts.enabled) return;
    if (pointerId !== null) return; // already tracking a pointer
    if (event.pointerType !== 'touch') return; // mouse / pen never drag a row
    if (!isCoarsePointer()) return; // desktop / fine pointer: buttons stay primary
    if (prefersReducedMotion()) return; // reduced motion → not draggable (buttons remain)
    pointerId = event.pointerId;
    dragging = false; // not until DRAG_START_PX — a tap must still reach the buttons
    startX = event.clientX;
    startY = event.clientY;
    lastDx = 0;
    node.style.transition = ''; // interrupt any in-flight settle so this drag is 1:1
  }

  function onPointerMove(event: PointerEvent): void {
    if (pointerId !== event.pointerId) return;
    const moveX = event.clientX - startX;
    const moveY = event.clientY - startY;
    if (!dragging) {
      // Claim the drag only once travel is clearly horizontal. A vertical pan is
      // left to `touch-action: pan-y`; a stationary tap falls through to the button.
      if (!isHorizontalDrag(moveX, moveY)) return;
      dragging = true;
      capture(event.pointerId);
    }
    if (crossedThreshold(lastDx, moveX)) hapticTick();
    lastDx = moveX;
    report(moveX);
  }

  function onPointerUp(event: PointerEvent): void {
    if (pointerId !== event.pointerId) return;
    const wasDragging = dragging;
    const finalDx = event.clientX - startX;
    abandon();
    if (!wasDragging) return; // it was a tap — leave it to the button underneath
    const outcome = resolveSwipe(finalDx);
    settle(0); // spring the row home; the celebration / delete takes over visually
    if (outcome !== 'none') {
      swallowNextClick();
      if (outcome === 'check') opts.onCheck();
      else opts.onDelete();
    }
  }

  function onPointerCancel(event: PointerEvent): void {
    if (pointerId !== event.pointerId) return;
    const wasDragging = dragging;
    abandon();
    if (wasDragging) settle(0); // browser took the gesture for a scroll — spring back
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', onPointerUp);
  node.addEventListener('pointercancel', onPointerCancel);

  return {
    update(next: SwipeOptions): void {
      opts = next;
      // Disabled mid-drag (e.g. the row started celebrating, or selection mode
      // opened): abandon the gesture and spring home.
      if (!opts.enabled && (pointerId !== null || dx !== 0)) {
        abandon();
        settle(0);
      }
    },
    destroy(): void {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerUp);
      node.removeEventListener('pointercancel', onPointerCancel);
    },
  };
}
