import type { EquipmentIconDoc } from '../../schemas/equipmentIcon.js';

// Equipment pictogram queries (issue #877).
//
// The review gate's state is DERIVED from two names, never stored. See
// `schemas/equipmentIcon.ts` for why: a stored status would need bookkeeping on
// every path that could abandon a draw, and there is no such path when the state
// is a comparison.

/**
 * True when a description is waiting to be read and drawn.
 *
 * One comparison covers both cases the UI cares about:
 *   • NEVER DRAWN — `sourceName` is absent, so it can never equal
 *     `briefSourceName`;
 *   • RENAMED SINCE THE LAST DRAW — the trigger re-authored the brief under the
 *     new name, so `briefSourceName` moved and `sourceName` did not.
 *
 * It goes false the instant a draw succeeds, because the draw stamps
 * `sourceName = briefSourceName`.
 *
 * Note what this deliberately does NOT consider: `thumbnail`. A renamed item
 * keeps showing the picture it already had — you never lose a picture you liked
 * just because the words moved on — so "awaiting approval" and "has an icon" are
 * independent, and an item can truthfully be both.
 */
export function equipmentIconAwaitingApproval(icon: EquipmentIconDoc | null | undefined): boolean {
  if (!icon) return false;
  return icon.sourceName !== icon.briefSourceName;
}
