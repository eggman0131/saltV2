import type { Recipe } from '../entities/Recipe.js';

// The shape of a cook, before you have read a single step (issue #878).
//
// The question a cook actually asks when they open a recipe at 6pm is never
// "what are the steps" — it is "can I start this now". That is answered by three
// numbers and nothing else: how long the dish takes end to end, how much of that
// is you standing at the counter, and where the waiting goes. A twenty-two-hour
// brisket and a twenty-two-minute omelette both read as "a recipe" until someone
// puts those numbers side by side.
//
// PURE (CLAUDE.md rule 1): a `Recipe` in, plain data out. It returns numbers and
// labels, never markup, percentages or CSS — the ribbon is one rendering of this
// and the chat could be another.

/** What a segment of the ribbon represents. The page tints the two differently. */
export type CookShapeSegmentKind = 'hands-on' | 'wait';

export interface CookShapeSegment {
  readonly kind: CookShapeSegmentKind;
  /**
   * What to call this stretch of time. For a wait it is the timer's own
   * `description` — the author already wrote "brine", "prove", "slow-cook", and
   * their word for it beats anything inferred from the number. See
   * {@link UNNAMED_WAIT_LABEL} for the fallback.
   */
  readonly label: string;
  readonly minutes: number;
}

export interface CookShape {
  /**
   * End-to-end elapsed time. Deliberately `handsOnMinutes + waitingMinutes` and
   * NOT `metadata.totalTimeMinutes`: the ribbon is a whole drawn from its parts,
   * and a total that disagreed with the segments beneath it would render as a
   * bar whose pieces do not fill it. `totalTimeMinutes` still gets a say — it is
   * how `handsOnMinutes` is derived (see {@link cookShape}) — it just is not
   * copied over the sum.
   */
  readonly totalMinutes: number;
  /** Time at the counter: the number that decides whether tonight is possible. */
  readonly handsOnMinutes: number;
  /** Time the dish spends looking after itself. */
  readonly waitingMinutes: number;
  /** Hands-on first (when there is any), then the waits. See {@link cookShape}. */
  readonly segments: readonly CookShapeSegment[];
}

/** A timer with no description of its own — the author timed it but did not name it. */
export const UNNAMED_WAIT_LABEL = 'Waiting';

/** Where the waits that did not make the cut go. */
export const OTHER_WAITS_LABEL = 'Other waiting';

/**
 * How many separately-named waits a ribbon may show.
 *
 * Three, because the ribbon is read at a glance and a fourth colour stops being
 * a glance. A dish with seven timers has seven timers whether or not we draw
 * them; what it does not have is seven things worth knowing before you start.
 * The ones that lose are the SHORT ones, and they are not discarded — they merge
 * into one `Other waiting` segment, so the bar still adds up to the whole.
 */
const MAX_NAMED_WAITS = 3;

// Built in method order and never re-sorted, so the array itself carries "where
// this wait first appeared" — see the ordering note in `cookShape`.
interface WaitGroup {
  label: string;
  minutes: number;
}

function normaliseLabel(description: string | null): string {
  const trimmed = (description ?? '').trim();
  return trimmed.length > 0 ? trimmed : UNNAMED_WAIT_LABEL;
}

/**
 * The dish's shape, or `null` when there is nothing to say about it.
 *
 * `null` — not an empty shape — when no step carries a timer. A recipe with no
 * timers has not told us where its time goes, and a ribbon drawn from a guess
 * would be worse than no ribbon: the caller renders nothing at all rather than
 * an empty bar (issue #878's Definition of Done says "absent, not empty").
 * Kinds with no method at all (an outing, a placeholder) have no steps and so
 * fall out here without a capability check — the timers ARE the gate.
 *
 * **Grouping.** One wait per timer would be a bar chart of the method rather
 * than a shape, so timers sharing a label are summed: three ten-minute rests are
 * "Rest, 30 min", which is what a cook would say. Labels are compared
 * case-insensitively — "Prove" and "prove" are one wait — but the first spelling
 * seen is the one displayed, because it is the author's.
 *
 * **Hands-on** is `totalTimeMinutes − waiting` when the author recorded a total
 * and that leaves something positive. That is preferred over `prepTimeMinutes`
 * because prep is chopping only, while the number being asked for is all the
 * time you are actually stood there — stirring, turning, basting. When the total
 * is missing or is smaller than the timers it contains (authors do write
 * inconsistent numbers), it falls back to `prepTimeMinutes`, and then to zero:
 * a shape with no hands-on segment is a legitimate answer for a dish that is
 * entirely waiting.
 */
export function cookShape(recipe: Recipe): CookShape | null {
  const groups: WaitGroup[] = [];
  const byKey = new Map<string, WaitGroup>();

  for (const step of recipe.steps) {
    const timer = step.timer;
    if (!timer) continue;
    const minutes = Math.max(0, Math.round(timer.durationMinutes));
    if (minutes <= 0) continue;
    const label = normaliseLabel(timer.description);
    const key = label.toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      existing.minutes += minutes;
      continue;
    }
    const group: WaitGroup = { label, minutes };
    byKey.set(key, group);
    groups.push(group);
  }

  if (groups.length === 0) return null;

  const waitingMinutes = groups.reduce((sum, group) => sum + group.minutes, 0);

  const metadata = recipe.metadata;
  const fromTotal =
    metadata.totalTimeMinutes === null
      ? null
      : Math.round(metadata.totalTimeMinutes) - waitingMinutes;
  const handsOnMinutes =
    fromTotal !== null && fromTotal > 0
      ? fromTotal
      : Math.max(0, Math.round(metadata.prepTimeMinutes ?? 0));

  // The three biggest waits keep their names; the rest become one segment. The
  // survivors are then put back into METHOD order, because "brine, then roast,
  // then rest" is the shape — sorting the bar by size would draw a chart of
  // magnitudes and lose the thing it exists to show.
  const named = [...groups].sort((a, b) => b.minutes - a.minutes).slice(0, MAX_NAMED_WAITS);
  const namedSet = new Set(named);
  const kept = groups.filter((group) => namedSet.has(group));
  const remainderMinutes = waitingMinutes - kept.reduce((sum, group) => sum + group.minutes, 0);

  const segments: CookShapeSegment[] = [];
  if (handsOnMinutes > 0) {
    segments.push({ kind: 'hands-on', label: 'Hands-on', minutes: handsOnMinutes });
  }
  for (const group of kept) {
    segments.push({ kind: 'wait', label: group.label, minutes: group.minutes });
  }
  if (remainderMinutes > 0) {
    segments.push({ kind: 'wait', label: OTHER_WAITS_LABEL, minutes: remainderMinutes });
  }

  return {
    totalMinutes: handsOnMinutes + waitingMinutes,
    handsOnMinutes,
    waitingMinutes,
    segments,
  };
}
