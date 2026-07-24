// Pure geometry for the shopping-row swipe gesture (lively shopping list, Phase 4).
//
// Everything here is PURE: it takes the numbers the DOM handler measured (a
// horizontal drag offset, a pair of successive offsets) and returns the decision,
// with no `window`, no `document`, and no element types — so the rules can be stated
// and unit-tested without a DOM, exactly like `cookDeck.ts` does for cook mode.
//
// The DOM half — the coarse-pointer gate, the `setPointerCapture` plumbing, the
// spring-back transition — lives in the Svelte action `swipe.svelte.ts`, which is
// the only caller of these functions. These are viewport pixels, so (like the deck
// geometry) they deliberately do NOT live behind `@salt/domain`: nothing about a
// swipe threshold is a fact about a shopping list.

/** Swipe RIGHT past +78px → check the item off (runs Phase 1's celebration). */
export const CHECK_THRESHOLD_PX = 78;
/** Swipe LEFT past -78px → delete it (runs Phase 2's undo snackbar). */
export const DELETE_THRESHOLD_PX = 78;
/**
 * Horizontal slop before a move is claimed as a drag rather than a tap or a
 * vertical scroll — mirrors CookModePage's `DRAG_START_PX`. Below this the touch
 * is left alone so `touch-action: pan-y` still scrolls and a tap still reaches the
 * button underneath.
 */
export const DRAG_START_PX = 6;

/** What a released horizontal drag commits to. */
export type SwipeAction = 'check' | 'delete' | 'none';

/**
 * Which action a released drag lands on, from its final horizontal offset (px,
 * positive = right). Right past +78 checks; left past -78 deletes; anything
 * shorter is `'none'` — a short swipe that springs back where it came from.
 */
export function resolveSwipe(dx: number): SwipeAction {
  if (dx >= CHECK_THRESHOLD_PX) return 'check';
  if (dx <= -DELETE_THRESHOLD_PX) return 'delete';
  return 'none';
}

/**
 * True when the drag JUST crossed a commit threshold in either direction between
 * two successive samples — the one moment to fire a confirming haptic tick.
 * Compares the committed-ness of the two offsets, so it fires once on the way out
 * past the line and only again if the finger comes back under and crosses out anew.
 */
export function crossedThreshold(prevDx: number, dx: number): boolean {
  return resolveSwipe(prevDx) === 'none' && resolveSwipe(dx) !== 'none';
}

/**
 * Whether a moving gesture is a horizontal swipe rather than a vertical scroll or a
 * stationary tap. Claims the drag only once horizontal travel clears the slop AND
 * dominates vertical travel — so a vertical pan is left to `touch-action: pan-y` and
 * a tap falls through to the button beneath.
 */
export function isHorizontalDrag(dx: number, dy: number): boolean {
  return Math.abs(dx) > DRAG_START_PX && Math.abs(dx) > Math.abs(dy);
}

/**
 * How far the reveal-behind layer should show, as a signed fraction in [-1, 1]:
 * positive = the check (right) layer, negative = the delete (left) layer, magnitude
 * = progress toward that side's threshold (capped at fully revealed once past it).
 * The component reads this to fade the layer in under the sliding row.
 */
export function revealProgress(dx: number): number {
  const threshold = dx >= 0 ? CHECK_THRESHOLD_PX : DELETE_THRESHOLD_PX;
  return Math.max(-1, Math.min(1, dx / threshold));
}
