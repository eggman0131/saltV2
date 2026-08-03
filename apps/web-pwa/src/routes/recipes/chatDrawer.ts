// The chat drawer's geometry (issue #696) — where the two stops are, in pixels.
//
// PURE: it takes numbers the component measured and returns numbers, in the same spirit
// as `lib/cookDeck.ts`. No `document`, no `window`. Kept out of `@salt/domain` for the
// same reason cookDeck is: nothing about a drawer height is a fact about a recipe.
//
// The drawer moves its HEIGHT rather than a transform, because the composer has to sit at
// the bottom of the visible panel at both stops. A translated panel would push the message
// box off the bottom of the screen at the shorter one.

/** How much of the screen the resting drawer takes: the latest reply and the composer. */
export const PEEK_FRACTION = 0.45;

/**
 * Whitespace left above the drawer at its FULL stop. A non-modal drawer that covers
 * everything reproduces issue #641's defect — chrome left focusable underneath an overlay
 * that hides it — so the page always keeps a strip, which at the top of a recipe is its
 * `DetailPage` header.
 */
export const FULL_TOP_GAP_PX = 96;

/** The drawer never gets shorter than this, however small the screen claims to be. */
const MIN_PEEK_PX = 180;

export interface DrawerStops {
  /** Resting height: the chef's latest reply plus the message box. */
  peek: number;
  /** Tallest height: most of the screen, with the page header still showing. */
  full: number;
}

/**
 * The two heights the drawer may rest at.
 *
 * `bottomY` is the drawer's bottom edge in viewport coordinates — measured rather than
 * computed, because it sits above `BottomNav` through `env(safe-area-inset-bottom)`, which
 * no arithmetic here can know. Everything above that edge is the drawer's to grow into.
 *
 * Degenerate viewports (a very short screen, or a measurement taken before layout) collapse
 * the two stops onto one height rather than returning a full stop shorter than the peek —
 * a drawer with an inverted travel would drag the wrong way.
 */
export function deriveDrawerStops(bottomY: number, viewportHeight: number): DrawerStops {
  const full = Math.max(0, Math.round(bottomY - FULL_TOP_GAP_PX));
  const peek = Math.min(full, Math.max(MIN_PEEK_PX, Math.round(viewportHeight * PEEK_FRACTION)));
  return { peek, full };
}
