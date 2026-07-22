// Deck geometry for cook mode — the viewport arithmetic behind the one-step-per-screen
// pager in `CookModePage.svelte`, kept here so the rules can be stated and tested without
// a DOM (issue #556).
//
// Everything in this file is PURE: it takes numbers the component measured and returns
// numbers. No `document`, no `window`, no element types. The component keeps the parts
// only it can do — measuring elements, running the spring, and requesting frames — and
// asks this module every question that is really just arithmetic.
//
// These are viewport pixels, so they deliberately do NOT live behind `@salt/domain`:
// nothing about a stop offset is a fact about a recipe.

/** How much of the next step stays on screen. */
export const PEEK_PX = 112;
/**
 * The peek has only ever been a CEILING, not a reservation: a section is floored at
 * `viewportHeight - <peek>` and then grows with its own content, so a long step eats into
 * the peek and a screen-filling one leaves none. Which means raising the floor's slack is
 * all it takes to spend leftover room on the peek — a step whose content doesn't fill the
 * screen shows up to DOUBLE, one that nearly fills it tapers back toward 112 and then to
 * nothing, and no step ever gives up a pixel it needs.
 */
export const PEEK_MAX_PX = PEEK_PX * 2;
/**
 * The floor for the bottom fade, and what every step used to get. It only applies to a
 * step with no peek to cover — the fade is the one remaining cue that there is more below,
 * so it can't go to nothing just because a step fills the screen.
 */
export const FADE_MIN_PX = 64;

/** Resistance past the ends of the deck. */
export const RUBBER_BAND = 0.35;

/** Of a screen — how far a slow drag must go to turn a page. */
const COMMIT_RATIO = 0.22;
/** Above this (px/ms), direction alone turns the page. */
const FLING_PX_PER_MS = 0.45;
/** How far ahead a fling is projected when choosing a stop. */
const PROJECTION_MS = 220;
/**
 * Slack before a section that merely brushes past the bottom of the screen earns an
 * intermediate stop — without it, sub-pixel layout noise mints a stop a hair below the
 * one already there.
 */
const OVERHANG_SLACK_PX = 8;

/** One measured step section, in deck coordinates. */
export interface DeckSection {
  /** Distance from the top of the deck to the top of this section, in px. */
  top: number;
  /** The section's laid-out height in px (its `offsetHeight`). */
  height: number;
}

/**
 * Every place the deck is allowed to come to rest. Each step contributes its own top, and
 * a step TALLER than the screen contributes extra stops a screen apart — so paging through
 * a long instruction works exactly like paging between short ones, and no content is ever
 * stranded where the deck can't stop to show it.
 *
 * Stops are clamped into `[0, limit]`, rounded, de-duplicated and sorted ascending, so a
 * run of collapsed done-steps that share a resting place counts as one stop rather than
 * several. With no viewport measured yet there is only one honest answer: the top.
 */
export function deriveStops({
  sections,
  screen,
  limit,
}: {
  sections: readonly DeckSection[];
  screen: number;
  limit: number;
}): number[] {
  if (screen <= 0) return [0];
  const stops: number[] = [];
  for (const section of sections) {
    stops.push(section.top);
    for (
      let extra = section.top + screen;
      extra < section.top + section.height - OVERHANG_SLACK_PX;
      extra += screen
    ) {
      stops.push(extra);
    }
  }
  const clamped = stops.map((s) => Math.round(Math.max(0, Math.min(s, limit))));
  return [...new Set(clamped)].sort((a, b) => a - b);
}

/**
 * Which stop the deck is closest to right now. Exactly between two stops it keeps the
 * earlier one, so a drag that goes nowhere never drifts forward on its own.
 */
export function nearestStopIndex(offset: number, stops: readonly number[]): number {
  let best = 0;
  let bestDistance = Math.abs((stops[0] ?? 0) - offset);
  for (let i = 1; i < stops.length; i += 1) {
    const distance = Math.abs((stops[i] ?? 0) - offset);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Drag resistance past the ends. Inside the deck the offset tracks the thumb 1:1; beyond
 * either end only `resistance` of the extra travel lands, which is what makes the end of
 * the recipe feel like an end rather than a wall.
 */
export function rubberBand(raw: number, limit: number, resistance: number): number {
  if (raw < 0) return raw * resistance;
  if (raw > limit) return limit + (raw - limit) * resistance;
  return raw;
}

/**
 * Where a released gesture lands — the index into `stops` the deck should animate to.
 *
 * A flick past either threshold always turns at least one page — landing back where you
 * started would feel like the swipe was ignored — and a harder fling is projected forward
 * so it can cross several stops at once, which is what stops a run of collapsed done-steps
 * needing a swipe each. A drag that never committed goes back where it came from.
 *
 * `velocity` is in px/ms (positive = content travelling up, offset increasing), matching
 * what the pointer handler measures.
 */
export function chooseLandingStop({
  stops,
  startIndex,
  offset,
  dragged,
  velocity,
  screen,
}: {
  stops: readonly number[];
  startIndex: number;
  offset: number;
  dragged: number;
  velocity: number;
  screen: number;
}): number {
  const flung = Math.abs(velocity) > FLING_PX_PER_MS;
  const committed = flung || Math.abs(dragged) > screen * COMMIT_RATIO;
  if (!committed) return startIndex;

  const direction = flung ? Math.sign(velocity) : Math.sign(dragged);
  let index = nearestStopIndex(offset + velocity * PROJECTION_MS, stops);
  if (direction > 0 && index <= startIndex) index = startIndex + 1;
  if (direction < 0 && index >= startIndex) index = startIndex - 1;
  return Math.max(0, Math.min(index, stops.length - 1));
}

/**
 * The floor under an expanded step's section: a screen less the most next-step the deck is
 * ever willing to show. A step with less content than that still owns the screen; a step
 * with more grows past it and eats into the peek.
 */
export function sectionMinHeight(viewportHeight: number): number {
  return Math.max(0, viewportHeight - PEEK_MAX_PX);
}

/**
 * How far up the bottom fade reaches, given the gap between the current step's last line
 * and the bottom of the viewport. Everything in that gap IS the next step, so the fade
 * wants to cover it exactly — floored so a step that fills the screen (a negative gap)
 * keeps the bottom-edge fade that says "more below", and capped at the most next-step the
 * deck can ever show.
 */
export function fadeHeightFor(gapBelowStep: number): number {
  return Math.min(PEEK_MAX_PX, Math.max(FADE_MIN_PX, Math.round(gapBelowStep)));
}
