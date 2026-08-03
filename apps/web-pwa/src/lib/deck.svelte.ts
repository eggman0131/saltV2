import {
  RUBBER_BAND,
  chooseLandingStop,
  deriveStops,
  nearestStopIndex,
  rubberBand,
  type DeckThresholds,
} from './cookDeck.js';
import { createDeckSpring } from './deckSpring.svelte.js';

/**
 * A gesture-owned pager over a column of sections — the machinery cook mode's step deck
 * was built from, lifted out so a second surface can page the same way.
 *
 * The deck is NOT a native scroller: the viewport's `overflow` is hidden and the column
 * inside is moved by a transform, so this module owns the gesture end to end. The drag
 * tracks the thumb 1:1, and on release the FLING VELOCITY decides both which section you
 * land on and the animation that carries you there.
 *
 * That velocity is the thing native scrolling could never hand over. By the time a scroll
 * container has come to rest there is no velocity left, which is why every earlier attempt
 * had to start its animation from a dead stop and always read as a separate movement
 * bolted on after the scroll rather than a continuation of it.
 *
 * That is why the spring is a hand-written integrator seeded with the velocity measured
 * off the pointer itself rather than Svelte's `Spring` — see `./deckSpring.svelte.ts`,
 * which holds the physics and the reasoning, and which this deck now shares with the one
 * other surface that springs without paging.
 *
 * WHAT IS HERE AND WHAT IS NOT. Everything in this file is about pixels, pointers and
 * frames — it knows nothing about steps, recipes, days or plans. The arithmetic that
 * decides where a deck may rest and where a released swipe lands lives one layer down in
 * `./cookDeck.js` (pure, DOM-free, and tested there); the meaning of a section — what it
 * shows, which one the footer acts on, what a stop means to the user — stays in the
 * calling component, which hands this module a `sections()` callback and nothing else.
 *
 * Like `cookDeck`, this deliberately does NOT live behind `@salt/domain`: viewport pixels
 * and pointer events are not facts about a recipe or a meal plan.
 */

// ─── The animation ────────────────────────────────────────────────────────────────────
// The integrator itself lives in `./deckSpring.svelte.ts` — same physics, same
// reduced-motion short-circuit, now shared with the one surface that springs without
// paging (the recipe chat drawer, issue #696).

/** Slop before a touch counts as a drag rather than a tap. */
const DRAG_START_PX = 6;
/** How long the wheel must go quiet before the deck settles to a stop. */
const WHEEL_IDLE_MS = 110;
/** A wheel line, in px, when the browser reports `deltaMode: 1` (Firefox). */
const WHEEL_LINE_PX = 16;

export interface DeckOptions {
  /**
   * The sections to page between, in order, measured fresh on every gesture. Elements
   * only — the deck does the arithmetic itself, so a caller just hands over whichever of
   * its rows are currently mounted (skipping any it has no element for).
   */
  sections: () => readonly HTMLElement[];
  /**
   * Overrides for the feel thresholds in `./cookDeck.js`. Omit for cook mode's numbers,
   * which assume screen-sized sections; a deck of short cards wants its own.
   */
  thresholds?: DeckThresholds;
}

export function createDeck(options: DeckOptions) {
  // Read at call time, never captured — a caller whose sections change size can hand in
  // a live object and have the next gesture use the new numbers.
  const tuning = (): DeckThresholds => options.thresholds ?? {};

  /** The clipping box. Bind it with `bind:this={deck.viewportEl}`. */
  let viewportEl = $state<HTMLElement | null>(null);
  /** The transformed column inside it. Bind it with `bind:this={deck.contentEl}`. */
  let contentEl = $state<HTMLElement | null>(null);
  const spring = createDeckSpring(0);

  /**
   * A section's height is MEASURED rather than set with `min-h-full`. Percentage heights
   * resolve against the parent, and since the sections sit inside the transformed column
   * their parent is auto-height — `min-height: 100%` against an indefinite height computes
   * to `auto`, which quietly turns one-section-per-screen back into a continuous list. The
   * viewport is the definite box, so it's the one to measure.
   */
  let viewportHeight = $state(0);

  $effect(() => {
    const vp = viewportEl;
    if (!vp) return;
    const sync = (): void => {
      viewportHeight = vp.clientHeight;
    };
    sync();
    if (typeof ResizeObserver !== 'function') return;
    // Re-measures when a bar or banner appears, and on rotation — each of which changes
    // how much room a section actually has.
    const observer = new ResizeObserver(sync);
    observer.observe(vp);
    return () => observer.disconnect();
  });

  function maxOffset(): number {
    const vp = viewportEl;
    if (!vp || !contentEl) return 0;
    return Math.max(0, contentEl.offsetHeight - vp.clientHeight);
  }

  // Measures each section into deck coordinates and hands the numbers to `deriveStops`,
  // which owns the rule about where the deck may come to rest.
  function computeStops(): number[] {
    const vp = viewportEl;
    if (!vp) return [0];
    const vpTop = vp.getBoundingClientRect().top;
    const sections = options.sections().map((el) => ({
      top: spring.current + (el.getBoundingClientRect().top - vpTop),
      height: el.offsetHeight,
    }));
    return deriveStops({
      sections,
      screen: vp.clientHeight,
      limit: maxOffset(),
      overhangSlackPx: tuning().overhangSlackPx,
      leadPx: tuning().leadPx,
    });
  }

  // Deliberately NOT reactive: `stops` is re-measured at the start of every gesture and
  // read only inside it, so making it state would buy nothing and re-run effects mid-drag.
  let stops: number[] = [0];

  /**
   * Where the deck must sit for `el` to be at the top. `null` if nothing is measurable.
   * Carries the same `leadPx` the stops do, so the place a deck STARTS is one of the
   * places it can rest — anchoring flush and then snapping to a lead would show the
   * list shifting by the lead on the first gesture.
   */
  function offsetOf(el: HTMLElement): number | null {
    const vp = viewportEl;
    if (!vp) return null;
    const top =
      spring.current +
      (el.getBoundingClientRect().top - vp.getBoundingClientRect().top) -
      (tuning().leadPx ?? 0);
    return Math.max(0, Math.min(Math.round(top), maxOffset()));
  }

  // The spring is what makes a release feel continuous: let go mid-fling and the deck keeps
  // travelling at the speed your thumb left it at, the spring only taking over as it nears
  // the stop — carrying slightly past it and pulling back, because it is under-damped.
  const stopAnimation = spring.stop;
  const animateTo = spring.animateTo;

  // ─── The gesture ────────────────────────────────────────────────────────────────────
  let dragging = false;
  let dragPointer: number | null = null;
  let dragStartY = 0;
  let dragStartOffset = 0;
  let dragStartIndex = 0;
  let lastMoveY = 0;
  let lastMoveTime = 0;
  let dragVelocity = 0; // px/ms, positive = content travelling up (offset increasing)

  function handlePointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    stopAnimation();
    stops = computeStops();
    dragPointer = event.pointerId;
    dragging = false; // not until it clears DRAG_START_PX — taps must still reach buttons
    dragStartY = event.clientY;
    dragStartOffset = spring.current;
    dragStartIndex = nearestStopIndex(spring.current, stops);
    lastMoveY = event.clientY;
    lastMoveTime = event.timeStamp;
    dragVelocity = 0;
  }

  function handlePointerMove(event: PointerEvent): void {
    if (dragPointer !== event.pointerId) return;
    const travelled = dragStartY - event.clientY;
    if (!dragging) {
      if (Math.abs(travelled) < DRAG_START_PX) return;
      dragging = true;
      viewportEl?.setPointerCapture?.(event.pointerId);
    }
    spring.place(rubberBand(dragStartOffset + travelled, maxOffset(), RUBBER_BAND));
    const elapsed = event.timeStamp - lastMoveTime;
    if (elapsed > 0) {
      // Smoothed, so one erratic sample at the moment of release can't fling the deck.
      dragVelocity = dragVelocity * 0.7 + ((lastMoveY - event.clientY) / elapsed) * 0.3;
      lastMoveY = event.clientY;
      lastMoveTime = event.timeStamp;
    }
  }

  function handlePointerUp(event: PointerEvent): void {
    if (dragPointer !== event.pointerId) return;
    dragPointer = null;
    if (!dragging) return; // it was a tap; leave it to the button underneath
    dragging = false;
    viewportEl?.releasePointerCapture?.(event.pointerId);
    settleAfterGesture();
  }

  // Carries the released gesture to wherever `chooseLandingStop` says it belongs. The
  // decision is pure arithmetic and lives in `./cookDeck.js`; what's left here is the
  // animation, seeded with the velocity the thumb left behind so the travel reads as a
  // continuation of the swipe rather than a new movement.
  function settleAfterGesture(): void {
    const vp = viewportEl;
    if (!vp) return;
    const { commitRatio, flingPxPerMs, projectionMs } = tuning();
    const index = chooseLandingStop({
      stops,
      startIndex: dragStartIndex,
      offset: spring.current,
      dragged: spring.current - dragStartOffset,
      velocity: dragVelocity,
      screen: vp.clientHeight,
      commitRatio,
      flingPxPerMs,
      projectionMs,
    });
    animateTo(stops[index] ?? 0, dragVelocity * 1000); // px/ms → px/s
  }

  // Trackpad and mouse wheel. No fling to inherit, so it moves the deck directly and
  // settles to the nearest stop once the wheel goes quiet.
  let wheelIdle: ReturnType<typeof setTimeout> | null = null;

  function handleWheel(event: WheelEvent): void {
    const vp = viewportEl;
    if (!vp) return;
    // Nothing here scrolls natively, so without this the page behind takes the wheel.
    event.preventDefault();
    stopAnimation();
    if (wheelIdle === null) stops = computeStops();
    else clearTimeout(wheelIdle);
    // deltaY is only in pixels when deltaMode is 0 — Firefox reports lines, and page mode
    // exists too. Untranslated, a Firefox wheel would barely move the deck.
    const delta =
      event.deltaMode === 1
        ? event.deltaY * WHEEL_LINE_PX
        : event.deltaMode === 2
          ? event.deltaY * vp.clientHeight
          : event.deltaY;
    spring.place(Math.max(0, Math.min(spring.current + delta, maxOffset())));
    wheelIdle = setTimeout(() => {
      wheelIdle = null;
      animateTo(stops[nearestStopIndex(spring.current, stops)] ?? 0);
    }, WHEEL_IDLE_MS);
  }

  // Keyboard. A native scroller gave us arrow keys for free; owning the gesture means
  // putting them back by hand.
  function handleKeyDown(event: KeyboardEvent): void {
    const keys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    stops = computeStops();
    const here = nearestStopIndex(spring.current, stops);
    const to =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? stops.length - 1
          : event.key === 'ArrowDown' || event.key === 'PageDown'
            ? Math.min(here + 1, stops.length - 1)
            : Math.max(here - 1, 0);
    animateTo(stops[to] ?? 0);
  }

  $effect(() => {
    return () => stopAnimation();
  });

  return {
    /** The clipping box. `bind:this={deck.viewportEl}`. */
    get viewportEl(): HTMLElement | null {
      return viewportEl;
    },
    set viewportEl(el: HTMLElement | null) {
      viewportEl = el;
    },
    /** The transformed column. `bind:this={deck.contentEl}`. */
    get contentEl(): HTMLElement | null {
      return contentEl;
    },
    set contentEl(el: HTMLElement | null) {
      contentEl = el;
    },
    /** How far the column is pushed up, in px. Drive the transform off this. */
    get offset(): number {
      return spring.current;
    },
    /** The viewport's measured height, kept in step by a `ResizeObserver`. */
    get viewportHeight(): number {
      return viewportHeight;
    },
    /**
     * Put the deck AT `next` with no travel — where it starts, not somewhere it goes.
     * Use `animateTo` for anything the user should see move.
     */
    place(next: number): void {
      spring.place(next);
    },
    offsetOf,
    animateTo,
    stopAnimation,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    handleKeyDown,
  };
}

export type Deck = ReturnType<typeof createDeck>;
