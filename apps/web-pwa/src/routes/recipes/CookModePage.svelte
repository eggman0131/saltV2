<script lang="ts">
  import { Button, CanonIcon, Icon, Spinner } from '@salt/ui-components';
  import { prefersReducedMotion } from 'svelte/motion';
  import { push } from 'svelte-spa-router';
  import { recipes, isLoadingRecipes } from '../../lib/recipeService.js';
  import {
    cookSession,
    isLoadingCookSession,
    initCookSessionSync,
    persistCookSession,
    removeCookSession,
    getCookSessionSnapshot,
  } from '../../lib/cookSessionService.js';
  import { auth } from '../../lib/auth.svelte.js';
  import { canonItems } from '../../lib/canonService.js';
  import { addToast } from '../../lib/toastStore.js';
  import { isWakeLockSupported, createWakeLock } from '../../lib/wakeLock.js';
  import IngredientText from './IngredientText.svelte';
  // Pure cook-session logic lives in `@salt/domain` (issue #556) — every producer
  // is immutable, none of them stamp `updatedAt` (the service owns that), and
  // every timestamp they need is passed in from here rather than read there.
  import {
    makeFreshSession as buildFreshSession,
    withStepDone,
    withIngredientChecked,
    withAllIngredientsChecked,
    withTimerStarted,
    withTimerDismissed,
    firstUseByStep as groupIngredientsByFirstUse,
    firstIncompleteStepId,
    miseProgress,
    hasRecipeChanged,
    formatClock,
    timerProgress,
  } from '@salt/domain';
  import type {
    CookActiveTimerDoc,
    CookSessionDoc,
    IngredientDoc,
    StepDoc,
  } from '@salt/domain/schemas';

  // Cook mode (cooking mode, Phase 1). The first FULL-VIEWPORT page in the app: it
  // owns its own `fixed inset-0` container rather than living inside the app shell,
  // because cooking is a heads-down, single-task mode. Stage 1 is mise en place —
  // tick every ingredient off before you start. Ticking is NOT a gate; it's a
  // memory aid that persists to Firestore so it survives a device switch.

  interface Props {
    params: { id: string };
  }
  let { params }: Props = $props();

  // Recipe + identity, derived exactly as RecipeViewPage does.
  const recipe = $derived($recipes.find((r) => r.id === params.id) ?? null);
  const uid = $derived(auth.user?.uid ?? null);
  // Deterministic session id — one session per user per recipe.
  const sessionId = $derived(uid ? `${params.id}_${uid}` : null);

  // ─── Subscription lifecycle ────────────────────────────────────────────────────
  // Re-subscribe whenever the session id changes (uid resolves, or the route param
  // changes). The effect's cleanup disposes the previous subscription.
  let unsub: (() => void) | null = null;
  $effect(() => {
    const sid = sessionId;
    if (!sid) return;
    unsub?.();
    unsub = initCookSessionSync(sid);
    return () => {
      unsub?.();
      unsub = null;
    };
  });

  // ─── Session bootstrap ─────────────────────────────────────────────────────────
  // Once the recipe and the session subscription have both resolved and there is no
  // session yet, create a fresh one stamping the live recipe's `updatedAt` as the
  // baseline. Guarded so it runs once per absent session.
  let bootstrapping = $state(false);

  function makeFreshSession(): CookSessionDoc {
    return buildFreshSession({
      id: sessionId!,
      ownerUid: uid!,
      recipeId: params.id,
      recipeUpdatedAtAtStart: recipe!.updatedAt,
      nowIso: new Date().toISOString(),
    });
  }

  async function createFreshSession(): Promise<void> {
    if (!sessionId || !uid || !recipe) return;
    bootstrapping = true;
    const result = await persistCookSession(makeFreshSession());
    bootstrapping = false;
    if (result.kind !== 'ok') addToast('Failed to start cooking.', 'destructive');
  }

  $effect(() => {
    if (!uid || !recipe || !sessionId) return;
    if ($isLoadingCookSession || bootstrapping) return;
    if ($cookSession) return; // already have one
    void createFreshSession();
  });

  // ─── Deleted-recipe orphan handling ────────────────────────────────────────────
  // If the recipe resolves to null AFTER the recipes store has loaded, it was
  // deleted elsewhere. Alert the cook, delete the orphaned session, and bounce to
  // the recipe list. Runs once.
  let orphaned = $state(false);
  $effect(() => {
    if ($isLoadingRecipes) return; // still loading — not an orphan yet
    if (recipe !== null) return;
    if (orphaned) return;
    orphaned = true;
    void handleOrphan();
  });

  async function handleOrphan(): Promise<void> {
    if (sessionId) await removeCookSession(sessionId);
  }

  // ─── Mise-en-place ticking ─────────────────────────────────────────────────────
  const checkedIds = $derived(new Set($cookSession?.checkedIngredientIds ?? []));
  // Counted over the RECIPE rather than over the session's id list, so ticks left
  // behind by an ingredient that has since been edited out can't inflate the
  // count — see `miseProgress`.
  const mise = $derived(miseProgress(recipe?.ingredients ?? [], checkedIds));
  const totalIngredients = $derived(mise.total);
  const checkedCount = $derived(mise.checked);
  const allIngredientsChecked = $derived(mise.allChecked);

  function toggleIngredient(id: string): void {
    const s = getCookSessionSnapshot();
    if (!s) return;
    void persistCookSession(withIngredientChecked(s, id));
  }

  // Bulk tick, for when everything is already out on the bench and ticking fourteen
  // rows is busywork. Symmetric — tapping again clears the lot.
  function toggleAllIngredients(): void {
    const s = getCookSessionSnapshot();
    if (!s || !recipe) return;
    const allIds = recipe.ingredients.flatMap((g) => g.items.map((i) => i.id));
    void persistCookSession(withAllIngredientsChecked(s, allIds, allIngredientsChecked));
  }

  // ─── Guided steps (Phase 2) ─────────────────────────────────────────────────────
  // Two stages share this page's header/banner/footer shell; only the scroll region
  // swaps. `mise` is Stage 1 (tick ingredients); `steps` is this phase — one
  // full-viewport guided step at a time on a vertical spring-settled scroll. Default
  // is mise.
  let stage = $state<'mise' | 'steps'>('mise');

  // One-shot resume: when the session first resolves already carrying step progress,
  // open straight into steps so reopening a half-cooked recipe drops you back where
  // you were (land-on-first-incomplete below finds the exact step). A plain-boolean
  // guard (not $state) keeps this from re-firing as the session updates.
  let stageInitialised = false;
  $effect(() => {
    if (stageInitialised) return;
    const s = $cookSession;
    if (!s) return;
    stageInitialised = true;
    if (s.completedStepIds.length > 0) stage = 'steps';
  });

  const completedStepIds = $derived(new Set($cookSession?.completedStepIds ?? []));
  const totalSteps = $derived(recipe?.steps.length ?? 0);
  const completedStepCount = $derived(
    recipe ? recipe.steps.filter((s) => completedStepIds.has(s.id)).length : 0,
  );
  const showTimeline = $derived(stage === 'steps' && totalSteps > 0);

  // First-use ingredients per step. The recipe stamps `firstUsedInStepId` on each
  // ingredient at the step it's first needed, so a step can surface exactly the
  // items it introduces (amount + prep) inline — no scrolling back to mise mid-cook.
  const firstUseByStep = $derived(groupIngredientsByFirstUse(recipe?.ingredients ?? []));

  // First-use chips are capped at half the step's width (gap included, so two capped
  // chips always pair up on one line), which stops one long line ("400g tinned plum
  // tomatoes, drained and roughly chopped") swallowing the row and pushing the rest of
  // the set out of sight behind a wrap — the point of the chip wrap is that the whole
  // set is scannable at a glance. Tapping a clipped chip lifts the cap for that one
  // chip; the list is a flex wrap, so the others reflow around it on their own. Any
  // click elsewhere puts it back.
  let expandedChipId = $state<string | null>(null);

  // Every path that ISN'T "expand this one" falls through to the window-level collapse
  // below, which is what makes tapping the open chip close it and keeps a tap on an
  // inert chip from stranding a different one open.
  function expandChip(event: MouseEvent & { currentTarget: HTMLElement }, id: string): void {
    if (expandedChipId === id) return;
    // Measured, not tracked: only the browser knows where a proportional font runs out
    // of room, and `truncate` makes scrollWidth exceed clientWidth exactly when it
    // clipped the line. A chip that already reads in full has nothing to reveal, so
    // tapping it does nothing at all.
    const text = event.currentTarget.querySelector('[data-chip-text]');
    if (!text || text.scrollWidth <= text.clientWidth) return;
    // Without this the collapse would undo the expand on the very click that asked for it.
    event.stopPropagation();
    expandedChipId = id;
  }

  // ─── Canon icons ────────────────────────────────────────────────────────────────
  // Ingredients already carry a `canonId` from canonicalisation, and canon items
  // already carry a generated icon — so cook mode can show the picture for free.
  // Worth it here more than anywhere: mise en place is scanned at a glance with your
  // hands full, and a picture is faster to find in a list than a word. Canon sync is
  // app-wide (App.svelte), so this is a read of an already-live store, not a new
  // subscription.
  //
  // Lookup mirrors ShoppingListPage's `thumbnailFor`/`iconVersionFor` exactly,
  // including the `iconRequestedAt ?? updatedAt` cache-bust — a regenerated icon
  // reuses its Storage URL, so without the nonce the browser serves the stale image.
  const canonIconMap = $derived(
    new Map(
      $canonItems.map((ci) => [
        ci.id,
        { thumbnail: ci.thumbnail, version: ci.iconRequestedAt ?? ci.updatedAt },
      ]),
    ),
  );

  // Tri-state thumbnail. null (→ bare tile) for ingredients that never matched a
  // canon item, which is also what an unmatched row shows on the shopping list.
  function thumbnailFor(canonId: string | null): string | null {
    if (!canonId) return null;
    return canonIconMap.get(canonId)?.thumbnail ?? null;
  }

  function iconVersionFor(canonId: string | null): string | number | undefined {
    if (!canonId) return undefined;
    return canonIconMap.get(canonId)?.version;
  }

  // Alt text for the icon. The parsed item name ("plum tomatoes") beats the raw line
  // ("400g tinned plum tomatoes, drained") for a screen reader announcing a picture.
  function ingredientLabel(ingredient: IngredientDoc): string {
    return ingredient.parsed?.item ?? ingredient.rawText;
  }

  // Set a step's completion — whole-document LWW via the service (there is no
  // field-level write). Completion is never a gate: the footer ticks the step you're
  // on, a done step can be unticked from its expanded view, and earlier steps are
  // never force re-ticked.
  function setStepDone(id: string, done: boolean): void {
    const s = getCookSessionSnapshot();
    if (!s) return;
    const next = withStepDone(s, id, done);
    // Identity means the step was already in that state — skip the write.
    if (next === s) return;
    void persistCookSession(next);
  }

  // Land-on-first-incomplete. Fires only when the stage flips to `steps`; it reads
  // completion from a NON-reactive snapshot so completion changes never move the
  // scroll on their own — the only thing that advances the view is the cook tapping
  // the footer (`handleStepDone` / `handleSkipToNext`), or their own swipe. Completed
  // steps stay above, collapsed but scrollable back and re-openable. Degrades to a
  // plain scroll (or top-of-list) if the anchor or scrollIntoView isn't available.
  let deckViewport = $state<HTMLElement | null>(null);
  const stepEls = new Map<string, HTMLElement>();
  function stepAnchor(node: HTMLElement, id: string) {
    stepEls.set(id, node);
    return {
      destroy() {
        if (stepEls.get(id) === node) stepEls.delete(id);
      },
    };
  }

  // ─── The step the footer acts on ───────────────────────────────────────────────
  // The single primary action lives in the footer, so it has to know which step the
  // cook is on. That's the step parked at the TOP of the scroller, found by probing
  // which step's box spans a point just below the top edge.
  //
  // Deliberately NOT "the step with the most visible pixels": scroll back to re-read
  // an earlier step and its collapsed row is only ~56px tall, so a full-height
  // incomplete step still showing below it wins on area — the footer would go on
  // offering "Done · next" for a step you aren't looking at, and tapping it would
  // tick the wrong one.
  let visibleStepId = $state<string | null>(null);
  // How far up the bottom fade reaches. Measured in the same probe below, because it
  // wants to cover the peek exactly and the peek is whatever the current step didn't
  // need — only layout knows that number.
  let fadeHeight = $state(0);

  function probeVisibleStep(): void {
    const root = deckViewport;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const probeY = rootRect.top + 8;
    for (const step of recipe?.steps ?? []) {
      const rect = stepEls.get(step.id)?.getBoundingClientRect();
      if (!rect) continue;
      if (rect.top <= probeY && rect.bottom > probeY) {
        visibleStepId = step.id;
        // Everything below this step's last line IS the next step, so that gap is the
        // fade. Floored so a step that fills the screen (bottom below the viewport, a
        // negative gap) keeps the bottom-edge fade that says "more below"; capped at
        // the most next-step the deck can ever show.
        fadeHeight = Math.min(
          PEEK_MAX_PX,
          Math.max(FADE_MIN_PX, Math.round(rootRect.bottom - rect.bottom)),
        );
        return;
      }
    }
  }

  // ─── Gesture-owned pagination ──────────────────────────────────────────────────
  // The deck is no longer a native scroller: `overflow` is hidden and the whole column
  // is moved by a transform, so this component owns the gesture end to end. The drag
  // tracks the thumb 1:1, and on release the FLING VELOCITY decides both which step you
  // land on and the animation that carries you there.
  //
  // That velocity is the thing native scrolling could never hand over. By the time a
  // scroll container has come to rest there is no velocity left, which is why every
  // earlier attempt had to start its animation from a dead stop and always read as a
  // separate movement bolted on after the scroll rather than a continuation of it.
  //
  // Svelte's `Spring` has `preserveMomentum` for exactly this case, but it can't be
  // used here: it derives velocity from the spring's own last two values, and the
  // `{ instant: true }` sets that 1:1 finger-tracking requires assign `last_value`
  // alongside `current` — zeroing that velocity on every move. Tracking the finger
  // with a plain `set` keeps the velocity but gives up the 1:1 feel, and lags on
  // 120Hz screens where its fixed `dt` covers only half a frame. Hence the integrator
  // below, seeded with the velocity measured off the pointer itself.
  const DECK_STIFFNESS = 170; // with DECK_DAMPING → ζ ≈ 0.61, about 10% overshoot
  const DECK_DAMPING = 16;
  // Long jumps ("Resume · step 9") are where a spring turns violent, because its force
  // scales with displacement. Capping speed keeps the physics for the short travel that
  // dominates while stopping a big jump from being fired across the screen.
  const DECK_MAX_SPEED = 2600; // px/s
  const DRAG_START_PX = 6; // slop before a touch counts as a drag rather than a tap
  const COMMIT_RATIO = 0.22; // of a screen — how far a slow drag must go to turn a page
  const FLING_PX_PER_MS = 0.45; // above this, direction alone turns the page
  const PROJECTION_MS = 220; // how far ahead a fling is projected when choosing a stop
  const RUBBER_BAND = 0.35; // resistance past the ends
  // How much of the next step stays on screen. It replaces both the old "Next" strip
  // and the scrollbar we gave up by owning the gesture — it is the ONLY thing telling
  // the cook there is more below. Sized to clear a step's label plus the first line or
  // two of its instruction, which is why the instruction leads the layout: peeking the
  // top of a step is only worth doing if the top of a step says something.
  const PEEK_PX = 112;
  // The peek has only ever been a CEILING, not a reservation: a section is floored at
  // `viewportHeight - <peek>` and then grows with its own content, so a long step eats
  // into the peek and a screen-filling one leaves none. Which means raising the floor's
  // slack is all it takes to spend leftover room on the peek — a step whose content
  // doesn't fill the screen shows up to DOUBLE, one that nearly fills it tapers back
  // toward 112 and then to nothing, and no step ever gives up a pixel it needs.
  const PEEK_MAX_PX = PEEK_PX * 2;
  // The floor for the bottom fade, and what every step used to get. It only applies to
  // a step with no peek to cover — the fade is the one remaining cue that there is
  // more below, so it can't go to nothing just because a step fills the screen.
  const FADE_MIN_PX = 64;

  let deckEl = $state<HTMLElement | null>(null);
  let deckOffset = $state(0);

  // A step's height is MEASURED rather than set with `min-h-full`. Percentage heights
  // resolve against the parent, and since the sections moved inside the transformed
  // deck their parent is auto-height — `min-height: 100%` against an indefinite height
  // computes to `auto`, which quietly turns one-step-per-screen back into a continuous
  // list. The viewport is the definite box, so it's the one to measure.
  let viewportHeight = $state(0);

  $effect(() => {
    const vp = deckViewport;
    if (!vp) return;
    const sync = (): void => {
      viewportHeight = vp.clientHeight;
    };
    sync();
    if (typeof ResizeObserver !== 'function') return;
    // Re-measures when the timers bar or the recipe-changed banner appears, and on
    // rotation — each of which changes how much room a step actually has.
    const observer = new ResizeObserver(sync);
    observer.observe(vp);
    return () => observer.disconnect();
  });

  function maxOffset(): number {
    const vp = deckViewport;
    if (!vp || !deckEl) return 0;
    return Math.max(0, deckEl.offsetHeight - vp.clientHeight);
  }

  // Every place the deck is allowed to come to rest. Each step contributes its own top,
  // and a step TALLER than the screen contributes extra stops a screen apart — so
  // paging through a long instruction works exactly like paging between short ones, and
  // no content is ever stranded where the deck can't stop to show it.
  function computeStops(): number[] {
    const vp = deckViewport;
    if (!vp) return [0];
    const vpTop = vp.getBoundingClientRect().top;
    const screen = vp.clientHeight;
    const limit = maxOffset();
    const stops: number[] = [];
    for (const step of recipe?.steps ?? []) {
      const el = stepEls.get(step.id);
      if (!el) continue;
      const top = deckOffset + (el.getBoundingClientRect().top - vpTop);
      stops.push(top);
      for (let extra = top + screen; extra < top + el.offsetHeight - 8; extra += screen) {
        stops.push(extra);
      }
    }
    const clamped = stops.map((s) => Math.round(Math.max(0, Math.min(s, limit))));
    return [...new Set(clamped)].sort((a, b) => a - b);
  }

  let stops: number[] = [0];

  function nearestStopIndex(offset: number): number {
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

  function stepStop(id: string): number | null {
    const vp = deckViewport;
    const el = stepEls.get(id);
    if (!vp || !el) return null;
    const top = deckOffset + (el.getBoundingClientRect().top - vp.getBoundingClientRect().top);
    return Math.max(0, Math.min(Math.round(top), maxOffset()));
  }

  // ─── The animation ─────────────────────────────────────────────────────────────
  // A plain spring integrator over the deck offset. `velocity0` is what makes it feel
  // continuous: released mid-fling the deck keeps travelling at the speed your thumb
  // left it at, and the spring only takes over as it approaches the stop — carrying
  // slightly past it and pulling back, because it is under-damped.
  let deckAnim: number | null = null;

  function stopDeckAnimation(): void {
    if (deckAnim !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(deckAnim);
    }
    deckAnim = null;
  }

  function animateDeckTo(target: number, velocity0 = 0): void {
    stopDeckAnimation();
    if (prefersReducedMotion.current || typeof requestAnimationFrame !== 'function') {
      deckOffset = target;
      return;
    }
    let position = deckOffset;
    let velocity = velocity0;
    let last = -1;
    const tick = (now: number): void => {
      if (last < 0) last = now;
      const dt = Math.min(0.032, (now - last) / 1000); // clamp: a stalled tab must not explode
      last = now;
      const acceleration = -DECK_STIFFNESS * (position - target) - DECK_DAMPING * velocity;
      velocity = Math.max(-DECK_MAX_SPEED, Math.min(DECK_MAX_SPEED, velocity + acceleration * dt));
      position += velocity * dt;
      if (Math.abs(position - target) < 0.5 && Math.abs(velocity) < 30) {
        deckOffset = target;
        deckAnim = null;
        return;
      }
      deckOffset = position;
      deckAnim = requestAnimationFrame(tick);
    };
    deckAnim = requestAnimationFrame(tick);
  }

  // ─── The gesture ───────────────────────────────────────────────────────────────
  let dragging = false;
  let dragPointer: number | null = null;
  let dragStartY = 0;
  let dragStartOffset = 0;
  let dragStartIndex = 0;
  let lastMoveY = 0;
  let lastMoveTime = 0;
  let dragVelocity = 0; // px/ms, positive = content travelling up (offset increasing)

  function rubberBand(raw: number): number {
    const limit = maxOffset();
    if (raw < 0) return raw * RUBBER_BAND;
    if (raw > limit) return limit + (raw - limit) * RUBBER_BAND;
    return raw;
  }

  function handlePointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    stopDeckAnimation();
    stops = computeStops();
    dragPointer = event.pointerId;
    dragging = false; // not until it clears DRAG_START_PX — taps must still reach buttons
    dragStartY = event.clientY;
    dragStartOffset = deckOffset;
    dragStartIndex = nearestStopIndex(deckOffset);
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
      deckViewport?.setPointerCapture?.(event.pointerId);
    }
    deckOffset = rubberBand(dragStartOffset + travelled);
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
    deckViewport?.releasePointerCapture?.(event.pointerId);
    settleAfterGesture();
  }

  // Where a released gesture lands. A flick past either threshold always turns at least
  // one page — landing back where you started would feel like the swipe was ignored —
  // and a harder fling is projected forward so it can cross several stops at once,
  // which is what stops a run of collapsed done-steps needing a swipe each.
  function settleAfterGesture(): void {
    const vp = deckViewport;
    if (!vp) return;
    const dragged = deckOffset - dragStartOffset;
    const committed =
      Math.abs(dragVelocity) > FLING_PX_PER_MS ||
      Math.abs(dragged) > vp.clientHeight * COMMIT_RATIO;
    const velocity = dragVelocity * 1000; // px/ms → px/s
    if (!committed) {
      animateDeckTo(stops[dragStartIndex] ?? 0, velocity);
      return;
    }
    const direction =
      Math.abs(dragVelocity) > FLING_PX_PER_MS ? Math.sign(dragVelocity) : Math.sign(dragged);
    let index = nearestStopIndex(deckOffset + dragVelocity * PROJECTION_MS);
    if (direction > 0 && index <= dragStartIndex) index = dragStartIndex + 1;
    if (direction < 0 && index >= dragStartIndex) index = dragStartIndex - 1;
    index = Math.max(0, Math.min(index, stops.length - 1));
    animateDeckTo(stops[index] ?? 0, velocity);
  }

  // Trackpad and mouse wheel. No fling to inherit, so it moves the deck directly and
  // settles to the nearest stop once the wheel goes quiet.
  let wheelIdle: ReturnType<typeof setTimeout> | null = null;

  function handleWheel(event: WheelEvent): void {
    const vp = deckViewport;
    if (!vp) return;
    // Nothing here scrolls natively, so without this the page behind takes the wheel.
    event.preventDefault();
    stopDeckAnimation();
    if (wheelIdle === null) stops = computeStops();
    else clearTimeout(wheelIdle);
    // deltaY is only in pixels when deltaMode is 0 — Firefox reports lines, and page
    // mode exists too. Untranslated, a Firefox wheel would barely move the deck.
    const delta =
      event.deltaMode === 1
        ? event.deltaY * 16
        : event.deltaMode === 2
          ? event.deltaY * vp.clientHeight
          : event.deltaY;
    deckOffset = Math.max(0, Math.min(deckOffset + delta, maxOffset()));
    wheelIdle = setTimeout(() => {
      wheelIdle = null;
      animateDeckTo(stops[nearestStopIndex(deckOffset)] ?? 0);
    }, 110);
  }

  // Keyboard. A native scroller gave us arrow keys for free; owning the gesture means
  // putting them back by hand.
  function handleDeckKey(event: KeyboardEvent): void {
    const keys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    stops = computeStops();
    const here = nearestStopIndex(deckOffset);
    const to =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? stops.length - 1
          : event.key === 'ArrowDown' || event.key === 'PageDown'
            ? Math.min(here + 1, stops.length - 1)
            : Math.max(here - 1, 0);
    animateDeckTo(stops[to] ?? 0);
  }

  // The footer follows the deck. Effects run after the DOM update, so the transform is
  // already applied and the probe measures where things actually are.
  $effect(() => {
    void deckOffset;
    // Re-probe on resize too, now that the fade height comes from here: the timers bar
    // or the recipe-changed banner appearing re-lays out every section, so the peek the
    // fade is covering changes without the deck having moved a pixel.
    void viewportHeight;
    probeVisibleStep();
  });

  $effect(() => {
    return () => stopDeckAnimation();
  });

  // ─── Re-reading a step you've already ticked ───────────────────────────────────
  // Peeking must never change completion. Tapping a collapsed row expands it in
  // place — still done — and the expanded view carries the only control that ticks
  // it back ("Mark not done").
  let peekedStepId = $state<string | null>(null);

  function peekStep(id: string): void {
    peekedStepId = id;
    visibleStepId = id; // you're plainly on it now; don't wait for a scroll event
  }

  function untickStep(id: string): void {
    peekedStepId = null;
    setStepDone(id, false);
  }

  const currentStep = $derived.by(() => {
    const steps = recipe?.steps ?? [];
    if (steps.length === 0) return null;
    const firstIncompleteId = firstIncompleteStepId(steps, completedStepIds);
    return (
      steps.find((s) => s.id === visibleStepId) ??
      steps.find((s) => s.id === firstIncompleteId) ??
      steps[steps.length - 1]
    );
  });
  const currentStepDone = $derived(!!currentStep && completedStepIds.has(currentStep.id));
  // "The next outstanding step AFTER this one" — the query has no notion of a
  // cursor, so the slice is what expresses "after".
  const nextIncompleteStep = $derived.by(() => {
    const steps = recipe?.steps ?? [];
    const idx = currentStep ? steps.findIndex((s) => s.id === currentStep.id) : -1;
    const rest = steps.slice(idx + 1);
    const nextId = firstIncompleteStepId(rest, completedStepIds);
    return rest.find((s) => s.id === nextId) ?? null;
  });
  const nextIncompleteNumber = $derived(
    nextIncompleteStep && recipe
      ? recipe.steps.findIndex((s) => s.id === nextIncompleteStep.id) + 1
      : 0,
  );

  // ─── Advancing ─────────────────────────────────────────────────────────────────
  // Finishing a step moves two things at once: the finished step collapses to a row,
  // and the next one has to come to the top. Animating BOTH is what felt jerky — the
  // collapse played, and a delayed smooth scroll then played on top of it. So only
  // one of them animates: the collapse is instant (no min-height transition) and the
  // travel is left to the spring above.
  //
  // It can't run on a timer, because completion round-trips through Firestore — the
  // collapse lands whenever the listener does. So the scroll is parked here and the
  // effect below fires it the moment the completion it's waiting on arrives, which is
  // also the moment the layout it has to measure becomes final.
  let pendingScroll = $state<{ afterDoneId: string | null; targetId: string } | null>(null);

  // Advancing runs the same spring a swipe does — just seeded with no velocity, since
  // a button press has none to inherit — so the two settle identically.
  function alignToTop(id: string): void {
    const stop = stepStop(id);
    if (stop !== null) animateDeckTo(stop);
  }

  $effect(() => {
    const pending = pendingScroll;
    if (!pending) return;
    if (pending.afterDoneId && !completedStepIds.has(pending.afterDoneId)) return;
    pendingScroll = null;
    alignToTop(pending.targetId);
  });

  // Footer primary while cooking: tick the step you're on and bring the next one that
  // still needs doing to the top. `visibleStepId` moves optimistically so the footer
  // label doesn't flicker through the intermediate state.
  function handleStepDone(): void {
    const step = currentStep;
    if (!step) return;
    const next = nextIncompleteStep;
    setStepDone(step.id, true);
    if (!next) return;
    visibleStepId = next.id;
    pendingScroll = { afterDoneId: step.id, targetId: next.id };
  }

  // Footer primary when you've scrolled back to an already-done step: return to the
  // earliest step still outstanding, rather than offering to finish (which would
  // quietly skip everything left) or to tick the step you're only re-reading. Closing
  // the peek is local state, so there's no completion to wait on — but the alignment
  // still goes through the effect so it measures AFTER the peek has collapsed.
  function handleResume(): void {
    const next = nextIncompleteStep;
    if (!next) return;
    peekedStepId = null;
    visibleStepId = next.id;
    pendingScroll = { afterDoneId: null, targetId: next.id };
  }

  // Timeline jump. Goes through `pendingScroll` rather than animating straight away
  // because closing an open peek collapses a step and moves everything below it —
  // measuring before that re-render would aim at where the target used to be.
  function jumpToStep(id: string): void {
    peekedStepId = null;
    visibleStepId = id;
    pendingScroll = { afterDoneId: null, targetId: id };
  }

  $effect(() => {
    if (stage !== 'steps') return;
    if (!deckViewport || !deckEl) return;
    const snap = getCookSessionSnapshot();
    const done = new Set(snap?.completedStepIds ?? []);
    const steps = recipe?.steps ?? [];
    const targetId = firstIncompleteStepId(steps, done);
    const target = steps.find((s) => s.id === targetId) ?? steps[steps.length - 1];
    if (!target) return;
    // Placed, not animated — this is where the deck STARTS, not somewhere it travels to.
    const landOn = (): void => {
      const stop = stepStop(target.id);
      if (stop !== null) deckOffset = stop;
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(landOn);
    else landOn();
  });

  function goToSteps(): void {
    stage = 'steps';
  }
  function goToMise(): void {
    stage = 'mise';
  }

  // ─── Step timers (Phase 3) ──────────────────────────────────────────────────────
  // Press-to-start countdowns backed entirely by the Firestore session doc. Starting
  // a timer writes an `activeTimers` entry with an ABSOLUTE `endsAt` (now +
  // durationMinutes); every countdown is `endsAt - now`, so a reload or a device
  // switch reconstructs the correct remaining time with no extra client state (the
  // resumability mechanism). One live timer per step. `notify` is captured here for a
  // future push follow-up but is consumed by NO code in this feature.
  //
  // A single in-memory 1s interval drives `now`. It only runs while at least one
  // timer is live (the $effect re-runs when `activeTimers` gains/loses entries) and
  // is torn down on cleanup — no per-timer intervals, and nothing ticks at rest.
  const activeTimers = $derived($cookSession?.activeTimers ?? []);
  const timerByStep = $derived(new Map(activeTimers.map((t) => [t.stepId, t] as const)));

  let now = $state(Date.now());
  $effect(() => {
    if (activeTimers.length === 0) return;
    if (typeof setInterval !== 'function') return; // SSR / no timers guard
    const handle = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(handle);
  });

  // Default `notify` ON for longer timers (>= 5 min) where a chef is likely to walk
  // away; short timers default off. Captured only — wired to nothing in this phase.
  const NOTIFY_MIN_MINUTES = 5;

  function startTimer(step: StepDoc): void {
    const timer = step.timer;
    if (!timer) return;
    const s = getCookSessionSnapshot();
    if (!s) return;
    // `endsAt` is computed HERE, not in the domain producer, which never reads a
    // clock. Replacing any existing entry for the step is the producer's job.
    const endsAt = new Date(Date.now() + timer.durationMinutes * 60_000).toISOString();
    const notify = timer.durationMinutes >= NOTIFY_MIN_MINUTES;
    void persistCookSession(withTimerStarted(s, step.id, endsAt, notify));
  }

  function dismissTimer(stepId: string): void {
    const s = getCookSessionSnapshot();
    if (!s) return;
    void persistCookSession(withTimerDismissed(s, stepId));
  }

  // Looks the timer's step up in the LIVE recipe and hands its duration to the
  // domain clamp, which turns it into the elapsed fraction the progress fill
  // draws. A step (or its timer) edited away since the countdown started has no
  // duration to scale against, so `timerProgress` returns null and the chip
  // renders with no fill rather than a bogus one.
  function timerProgressFor(timer: CookActiveTimerDoc): number | null {
    const durationMinutes = recipe?.steps.find((s) => s.id === timer.stepId)?.timer
      ?.durationMinutes;
    return timerProgress(timer, durationMinutes ? durationMinutes * 60_000 : null, now);
  }

  // ─── Recipe-changed banner ─────────────────────────────────────────────────────
  // The live recipe drifted from the snapshot taken when the session started.
  const recipeChanged = $derived(hasRecipeChanged($cookSession, recipe?.updatedAt ?? null));

  // Restart: discard the current session and start a fresh one against the CURRENT
  // recipe (new baseline, cleared ticks), staying on the cook page so the user
  // keeps cooking the updated recipe.
  let restarting = $state(false);
  async function handleRestart(): Promise<void> {
    if (!sessionId || !uid || !recipe || restarting) return;
    restarting = true;
    await removeCookSession(sessionId);
    const result = await persistCookSession(makeFreshSession());
    restarting = false;
    if (result.kind !== 'ok') {
      addToast('Failed to restart.', 'destructive');
      return;
    }
    addToast('Started fresh with the updated recipe.', 'success');
  }

  // ─── Complete / close ──────────────────────────────────────────────────────────
  // Complete clears the session (delete the doc) and returns to the recipe view.
  let completing = $state(false);
  async function handleComplete(): Promise<void> {
    if (!sessionId || completing) return;
    completing = true;
    await removeCookSession(sessionId);
    completing = false;
    push(`/recipes/${params.id}`);
  }

  // Close leaves the session intact so it can be resumed later / on another device.
  function handleClose(): void {
    push(`/recipes/${params.id}`);
  }

  // ─── Wake lock ──────────────────────────────────────────────────────────────────
  const wakeLockSupported = isWakeLockSupported();
  const wake = wakeLockSupported ? createWakeLock() : null;
  let keepAwake = $state(false);

  // The icon alone is a quiet affordance — a toast makes the state change explicit,
  // since nothing else on screen confirms it. The ON path reports what actually
  // happened rather than assuming: `enable()` resolves false when the browser or OS
  // refuses the lock, and the toggle must not claim a lock it never got.
  // Plain `let`, not `$state` — a re-entrancy guard only read inside the handler, so
  // it needs no reactivity.
  let togglingWakeLock = false;
  async function toggleWakeLock(): Promise<void> {
    if (togglingWakeLock) return;
    togglingWakeLock = true;
    try {
      if (keepAwake) {
        await wake?.disable();
        keepAwake = false;
        addToast('Screen can sleep again', 'success');
        return;
      }
      const acquired = (await wake?.enable()) ?? false;
      keepAwake = acquired;
      if (acquired) addToast('Screen will stay awake', 'success');
      else addToast("Your browser wouldn't let the screen stay awake.", 'destructive');
    } finally {
      togglingWakeLock = false;
    }
  }

  // Release the lock when leaving cook mode.
  $effect(() => {
    return () => {
      void wake?.disable();
    };
  });
</script>

<!-- "Click anywhere else" for the expanded first-use chip. On window rather than the
   page root so a tap on the header or footer dismisses it too; the chip's own handler
   stops propagation so its expand survives the same click. -->
<svelte:window onclick={() => (expandedChipId = null)} />

<div class="fixed inset-0 z-50 flex h-dvh flex-col bg-background" data-testid="cook-mode-page">
  {#if recipe === null}
    <!-- Loading, or the recipe was deleted (orphan handled by the effect above). -->
    <div class="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      {#if $isLoadingRecipes}
        <Spinner size={20} />
        <p class="text-sm text-muted-foreground">Loading…</p>
      {:else}
        <Icon name="TriangleAlert" size={28} class="text-destructive" />
        <div class="flex flex-col gap-1" data-testid="cook-mode-orphan">
          <p class="text-base font-semibold">This recipe was deleted</p>
          <p class="text-sm text-muted-foreground">
            The recipe you were cooking no longer exists, so this cook session has been closed.
          </p>
        </div>
        <Button
          variant="outline"
          onclick={() => push('/recipes')}
          data-testid="cook-mode-orphan-back"
        >
          {#snippet leading()}<Icon name="ArrowLeft" size={16} />{/snippet}
          Back to recipes
        </Button>
      {/if}
    </div>
  {:else}
    <!-- Top bar -->
    <header class="flex shrink-0 items-center gap-3 px-4 py-3 {showTimeline ? '' : 'border-b'}">
      <Button
        variant="ghost"
        size="icon"
        onclick={handleClose}
        ariaLabel="Close cook mode"
        title="Close"
        data-testid="cook-mode-close"
      >
        {#snippet leading()}<Icon name="ArrowLeft" size={20} />{/snippet}
      </Button>
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-base font-semibold" data-testid="cook-mode-title">
          {recipe.title}
        </span>
        {#if stage === 'mise'}
          <span class="text-xs text-muted-foreground">
            Mise en place · {checkedCount}/{totalIngredients} ready
          </span>
        {/if}
      </div>
      {#if wakeLockSupported}
        <!-- Keep-awake is an icon toggle, not a labelled switch: cook mode is a
           heads-down surface and the header has to stay legible next to a long recipe
           title. State is carried by colour (muted → amber, the same amber the timeline
           uses for "current") plus aria-pressed, and every tap fires a toast so the
           change is never silent. -->
        <Button
          variant="ghost"
          size="icon"
          onclick={toggleWakeLock}
          ariaLabel="Keep screen awake"
          title={keepAwake ? 'Screen stays awake' : 'Keep screen awake'}
          aria-pressed={keepAwake}
          data-testid="cook-mode-wakelock"
          data-active={keepAwake}
        >
          {#snippet leading()}
            <!-- Lucide has no phone-with-padlock glyph, so it's composed: a Lock badge on
               the corner of Smartphone, with a bg-background ring so it punches out of
               the phone outline instead of muddling into it. -->
            <span
              class="relative inline-flex transition-colors {keepAwake
                ? 'text-amber-500'
                : 'text-muted-foreground'}"
            >
              <Icon name="Smartphone" size={20} />
              <Icon
                name="Lock"
                size={14}
                class="absolute -right-1 -bottom-1 rounded-full bg-background"
              />
            </span>
          {/snippet}
        </Button>
      {/if}
    </header>

    <!-- Timeline. Its own full-width band directly under the header, which is why the
       header drops its bottom border — the two read as one block rather than as two
       stacked bars. Replaces both the "n/m done" line and the "Step x of y" label that
       used to sit on every step: one segment per step, so position and progress are
       read at a glance instead of counted. Colours are the app's existing meanings —
       emerald is its success green (feedback sent, "mild" weather), amber its
       active/selected marker in the meal planner — rather than the teal primary, which
       is on almost every other control here and so distinguishes nothing.

       Each segment also jumps to its step. Small on purpose: the footer and the swipe
       are the primary ways to move, this is the shortcut. The row is padded well beyond
       the bar itself so the hit area is bigger than it looks. -->
    {#if showTimeline}
      <div
        class="flex shrink-0 items-center gap-1 border-b px-4 py-2"
        role="group"
        aria-label="Steps: {completedStepCount} of {totalSteps} done"
        data-testid="cook-timeline"
      >
        {#each recipe.steps as timelineStep, index (timelineStep.id)}
          {@const stepDone = completedStepIds.has(timelineStep.id)}
          {@const stepCurrent = currentStep?.id === timelineStep.id}
          <button
            type="button"
            class="py-2 {stepCurrent
              ? 'flex-[1.6]'
              : 'flex-1'} transition-[flex] duration-200 motion-reduce:transition-none"
            onclick={() => jumpToStep(timelineStep.id)}
            aria-label="Step {index + 1} of {totalSteps}{stepDone ? ', done' : ''}"
            aria-current={stepCurrent ? 'step' : undefined}
            data-testid="cook-timeline-step"
            data-complete={stepDone}
            data-current={stepCurrent}
          >
            <span
              class="block h-1.5 rounded-full transition-colors {stepCurrent
                ? 'bg-amber-500'
                : stepDone
                  ? 'bg-emerald-600'
                  : 'bg-muted-foreground/25'}"
            ></span>
          </button>
        {/each}
      </div>
    {/if}

    <!-- Recipe-changed banner -->
    {#if recipeChanged}
      <div
        class="flex shrink-0 items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
        data-testid="cook-mode-recipe-changed"
      >
        <Icon name="TriangleAlert" size={16} class="shrink-0 text-amber-500" />
        <span class="flex-1">This recipe was updated since you started cooking.</span>
        <Button
          size="sm"
          variant="outline"
          onclick={handleRestart}
          loading={restarting}
          disabled={restarting}
          data-testid="cook-mode-restart"
        >
          {#snippet leading()}<Icon name="RefreshCw" size={14} />{/snippet}
          Restart
        </Button>
      </div>
    {/if}

    <!-- Persistent timers bar. Every live/fired timer stays here regardless of stage,
       scroll position, or which step is in focus — so a timer that fires while the
       chef is on another step (or on a now-collapsed done step) is always visible and
       dismissable, and can never be hidden into an un-dismissable state. The per-step
       control below is the start affordance; this bar is the durable surface. -->
    {#if activeTimers.length > 0}
      <div
        class="flex shrink-0 flex-col gap-2 border-b bg-muted/40 px-4 py-3"
        data-testid="cook-timers-bar"
      >
        <div class="mx-auto flex w-full max-w-2xl flex-col gap-2">
          {#each activeTimers as t (t.stepId)}
            {@const remaining = new Date(t.endsAt).getTime() - now}
            {@const fired = remaining <= 0}
            {@const stepIndex = recipe.steps.findIndex((s) => s.id === t.stepId)}
            {@const progress = timerProgressFor(t)}
            <div
              class="overflow-hidden rounded-lg border {fired
                ? 'border-primary bg-primary/10'
                : 'bg-card'}"
              data-testid="cook-timer-chip"
              data-step-id={t.stepId}
              data-fired={fired}
            >
              <div class="flex items-center gap-3 px-3 py-2">
                <Icon
                  name={fired ? 'BellRing' : 'Timer'}
                  size={18}
                  class={fired ? 'shrink-0 text-primary' : 'shrink-0 text-muted-foreground'}
                />
                <span
                  class="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {stepIndex >= 0 ? `Step ${stepIndex + 1}` : 'Timer'}
                </span>
                <span
                  class="flex-1 font-mono text-base tabular-nums {fired
                    ? 'font-semibold text-primary'
                    : ''}"
                  data-testid="cook-timer-chip-time"
                >
                  {fired ? 'Finished' : formatClock(remaining)}
                </span>
                <Button
                  size="sm"
                  variant={fired ? 'solid' : 'ghost'}
                  onclick={() => dismissTimer(t.stepId)}
                  data-testid="cook-timer-chip-dismiss"
                >
                  {fired ? 'Dismiss' : 'Cancel'}
                </Button>
              </div>
              <!-- Progress fill, flush to the chip's bottom edge (the wrapper clips it
                 to the rounded corners). Decorative: the mm:ss beside it already
                 carries the value, so a progressbar role would only double-announce.
                 The 1s linear transition matches the tick interval, so it glides
                 rather than stepping once a second. -->
              {#if progress !== null}
                <div class="h-1 w-full bg-muted-foreground/15" aria-hidden="true">
                  <div
                    class="h-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none {fired
                      ? 'bg-primary'
                      : 'bg-amber-500'}"
                    style="width: {progress * 100}%"
                    data-testid="cook-timer-chip-progress"
                  ></div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Stage 1: mise-en-place list / Stage 2: guided steps -->
    {#if stage === 'mise'}
      <main class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div class="mx-auto flex max-w-2xl flex-col gap-6">
          {#if recipe.ingredients.length === 0}
            <p class="text-sm text-muted-foreground">This recipe has no ingredients.</p>
          {/if}
          {#each recipe.ingredients as group (group.id)}
            <section class="flex flex-col gap-2" data-testid="cook-mise-group">
              {#if group.name}
                <h2
                  class="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  data-testid="cook-mise-group-name"
                >
                  {group.name}
                </h2>
              {/if}
              <ul class="flex flex-col gap-2">
                {#each group.items as ingredient (ingredient.id)}
                  {@const checked = checkedIds.has(ingredient.id)}
                  <li>
                    <button
                      type="button"
                      class="flex w-full items-center gap-3 rounded-lg border px-4 py-4 text-left transition-colors active:bg-muted {checked
                        ? 'border-primary/40 bg-primary/5'
                        : 'bg-card hover:bg-muted/50'}"
                      onclick={() => toggleIngredient(ingredient.id)}
                      aria-pressed={checked}
                      data-testid="cook-mise-row"
                    >
                      <span
                        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border {checked
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input'}"
                      >
                        {#if checked}<Icon name="Check" size={18} />{/if}
                      </span>
                      <!-- Rendered for every row, matched or not: an unmatched
                         ingredient shows the bare tile (same as an unmatched shopping
                         row), which keeps the text column aligned down the whole list
                         instead of ragging in and out. Dims with the tick, as on the
                         shopping list. -->
                      <CanonIcon
                        thumbnail={thumbnailFor(ingredient.canonId)}
                        name={ingredientLabel(ingredient)}
                        version={iconVersionFor(ingredient.canonId)}
                        dimmed={checked}
                        size={34}
                      />
                      <span
                        class="min-w-0 flex-1 text-base {checked
                          ? 'text-muted-foreground line-through'
                          : ''}"
                      >
                        <IngredientText {ingredient} />
                      </span>
                    </button>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </div>
      </main>
    {:else}
      <!-- Guided steps: one full-viewport step per screen. NOT a scroll container —
         the deck inside is moved by transform and the gesture is handled in script
         (see "Gesture-owned pagination"), which is what lets a release carry its fling
         velocity into the settle. `touch-pinch-zoom` hands us the vertical pan while
         leaving zoom alone; `tabindex` restores the arrow-key paging a native scroller
         would have given for free. Completed steps collapse to a compact row (tap to
         re-read); the first incomplete step fills the screen and shows its first-use
         ingredients inline. -->
      <!-- The two a11y rules below assume a non-interactive element has no business
         taking focus or keys. Here it does: a native scroll container is focusable and
         arrow-key operable for free, and this element replaces one, so silencing the
         rules is how that behaviour is KEPT rather than dropped. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <main
        bind:this={deckViewport}
        class="relative min-h-0 flex-1 touch-pinch-zoom overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid="cook-steps-view"
        tabindex="0"
        aria-label="Guided steps"
        onpointerdown={handlePointerDown}
        onpointermove={handlePointerMove}
        onpointerup={handlePointerUp}
        onpointercancel={handlePointerUp}
        onwheel={handleWheel}
        onkeydown={handleDeckKey}
      >
        {#if recipe.steps.length === 0}
          <div class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p class="text-base font-semibold">This recipe has no steps</p>
            <p class="text-sm text-muted-foreground">
              There's nothing to guide through — tap Finish cooking when you're done.
            </p>
          </div>
        {/if}
        <!-- The deck's trailing padding is what lets the LAST step still align to the
           top: without it the final stop clamps short by exactly the peek. It tracks
           PEEK_MAX_PX, not PEEK_PX — the shortest a section can now be is
           `viewport - PEEK_MAX_PX`, and the padding has to cover that whole shortfall
           or the last step can't reach the top of the screen. -->
        <div
          bind:this={deckEl}
          class="will-change-transform"
          style="transform: translate3d(0, {-deckOffset}px, 0); padding-bottom: {PEEK_MAX_PX}px"
          data-testid="cook-steps-deck"
        >
          {#each recipe.steps as step, i (step.id)}
            {@const done = completedStepIds.has(step.id)}
            {@const firstUse = firstUseByStep.get(step.id) ?? []}
            {@const collapsed = done && peekedStepId !== step.id}
            <section
              use:stepAnchor={step.id}
              data-step-id={step.id}
              data-complete={done}
              data-testid="cook-step"
              class="flex flex-col px-4 {collapsed ? 'py-2' : 'border-t py-6'}"
              style="min-height: {collapsed ? 0 : Math.max(0, viewportHeight - PEEK_MAX_PX)}px"
            >
              {#if collapsed}
                <!-- Collapsed / done: compact row, tap to re-read it. Peeking is
                 NON-destructive — it expands the step, it does not untick it. -->
                <button
                  type="button"
                  class="mx-auto flex w-full max-w-2xl items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 text-left"
                  onclick={() => peekStep(step.id)}
                  aria-expanded="false"
                  data-testid="cook-step-collapsed"
                >
                  <span
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary bg-primary text-primary-foreground"
                  >
                    <Icon name="Check" size={18} />
                  </span>
                  <span
                    class="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Step {i + 1}
                  </span>
                  <span class="min-w-0 flex-1 truncate text-sm text-muted-foreground line-through">
                    {step.text}
                  </span>
                </button>
              {:else}
                <!-- Expanded: the step being cooked, or a done step being re-read.
                 Fills the screen, arm's-length type. -->
                <!-- Top-aligned, NOT centred, and the instruction leads. Both are for
                   the peek: the next step's first ~112px is all the cook sees of it,
                   so whatever sits at the top of a step has to be the part worth
                   reading. Centring would put blank space there; leading with the
                   ingredients would peek a box of quantities out of context. -->
                <div class="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6">
                  <div class="flex flex-col gap-3">
                    {#if done}
                      <div>
                        <span
                          class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
                          data-testid="cook-step-done-badge"
                        >
                          <Icon name="Check" size={12} />
                          Done
                        </span>
                      </div>
                    {/if}
                    <p class="text-xl leading-relaxed sm:text-2xl">{step.text}</p>
                  </div>

                  {#if step.note}
                    <p class="text-lg text-muted-foreground">{step.note}</p>
                  {/if}

                  <!-- First-use ingredients as chips rather than a bordered list. Each
                     one is a self-contained "fetch this" object, so a wrap of pills
                     reads as a set of things to grab; a bordered block read as prose to
                     be worked through in order. The icon rides inside the pill, which
                     is what makes a chip worth the change over a list — the picture is
                     the fastest part to recognise mid-step. -->
                  {#if firstUse.length > 0}
                    <ul class="flex flex-wrap items-start gap-2" data-testid="cook-step-firstuse">
                      {#each firstUse as ing (ing.id)}
                        {@const expandedChip = expandedChipId === ing.id}
                        <!-- Half the row MINUS half the gap: a flat 50% would put two
                           full-width chips 8px over the line and wrap the second one,
                           which is the opposite of what the cap is for — two capped
                           chips must always sit side by side. Keep in step with the
                           `gap-2` above.
                           `shrink-0` so a chip is only ever ellipsised by the cap,
                           never by flex squeezing it to make a line fit. Nothing can
                           exceed the line on its own, so there is nothing to shrink. -->
                        <li
                          class="shrink-0 {expandedChip
                            ? 'max-w-full'
                            : 'max-w-[calc(50%-0.25rem)]'}"
                        >
                          <!-- No `aria-expanded`: clipped text is still in the
                             accessibility tree, so a screen reader already reads the
                             chip in full. The expand is a purely visual disclosure and
                             announcing it as collapsed content would be a lie. -->
                          <button
                            type="button"
                            class="flex w-full items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-4 text-left text-base"
                            data-testid="cook-step-firstuse-chip"
                            data-expanded={expandedChip}
                            onclick={(e) => expandChip(e, ing.id)}
                          >
                            <CanonIcon
                              thumbnail={thumbnailFor(ing.canonId)}
                              name={ingredientLabel(ing)}
                              version={iconVersionFor(ing.canonId)}
                              size={30}
                              class="rounded-full"
                            />
                            <!-- `min-w-0` is what lets the span shrink below its text
                               inside the flex row — without it the chip would simply
                               overflow the cap instead of clipping. -->
                            <span
                              class="min-w-0 {expandedChip ? 'break-words' : 'truncate'}"
                              data-chip-text
                            >
                              <IngredientText ingredient={ing} />
                            </span>
                          </button>
                        </li>
                      {/each}
                    </ul>
                  {/if}

                  <!-- Phase 3: per-step timer. Press-to-start when idle; live countdown
                   or a fired/dismiss state once running. State is derived purely from
                   the persisted `endsAt`, so it survives reloads/device switches. The
                   persistent bar above keeps this visible even when the step scrolls
                   off or collapses. -->
                  {#if step.timer}
                    {@const timerEntry = timerByStep.get(step.id)}
                    <div class="flex flex-col gap-2" data-testid="cook-step-timer">
                      {#if timerEntry}
                        {@const remaining = new Date(timerEntry.endsAt).getTime() - now}
                        {@const progress = timerProgressFor(timerEntry)}
                        {#if remaining > 0}
                          <div class="overflow-hidden rounded-lg border bg-card">
                            <div class="flex items-center gap-3 px-4 py-3">
                              <Icon name="Timer" size={22} class="shrink-0 text-muted-foreground" />
                              <span
                                class="flex-1 font-mono text-2xl tabular-nums"
                                data-testid="cook-step-timer-countdown"
                              >
                                {formatClock(remaining)}
                              </span>
                              <Button
                                variant="ghost"
                                onclick={() => dismissTimer(step.id)}
                                data-testid="cook-step-timer-dismiss"
                              >
                                Cancel
                              </Button>
                            </div>
                            <!-- See the timers-bar chip above: same fill, thicker here
                             because this card is the step's primary timer surface. -->
                            {#if progress !== null}
                              <div class="h-1.5 w-full bg-muted-foreground/15" aria-hidden="true">
                                <div
                                  class="h-full bg-amber-500 transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
                                  style="width: {progress * 100}%"
                                  data-testid="cook-step-timer-progress"
                                ></div>
                              </div>
                            {/if}
                          </div>
                        {:else}
                          <div
                            class="flex items-center gap-3 rounded-lg border border-primary bg-primary/10 px-4 py-3"
                          >
                            <Icon name="BellRing" size={22} class="shrink-0 text-primary" />
                            <span
                              class="flex-1 text-lg font-semibold text-primary"
                              data-testid="cook-step-timer-countdown"
                            >
                              Timer finished
                            </span>
                            <Button
                              onclick={() => dismissTimer(step.id)}
                              data-testid="cook-step-timer-dismiss"
                            >
                              Dismiss
                            </Button>
                          </div>
                        {/if}
                      {:else}
                        <Button
                          variant="outline"
                          size="lg"
                          onclick={() => startTimer(step)}
                          data-testid="cook-step-timer-start"
                        >
                          {#snippet leading()}<Icon name="Timer" size={18} />{/snippet}
                          Start timer · {step.timer.durationMinutes} min
                        </Button>
                      {/if}
                      {#if step.timer.description}
                        <span class="text-sm text-muted-foreground">{step.timer.description}</span>
                      {/if}
                    </div>
                  {/if}

                  {#if done}
                    <!-- The ONLY control that unticks a step. Reachable solely from a
                     deliberate peek, so re-reading can't undo your progress. -->
                    <div class="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onclick={() => untickStep(step.id)}
                        data-testid="cook-step-untick"
                      >
                        {#snippet leading()}<Icon name="Undo2" size={16} />{/snippet}
                        Mark not done
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onclick={() => (peekedStepId = null)}
                        data-testid="cook-step-collapse"
                      >
                        {#snippet leading()}<Icon name="ChevronUp" size={16} />{/snippet}
                        Collapse
                      </Button>
                    </div>
                  {/if}
                </div>
              {/if}
            </section>
          {/each}
        </div>
        <!-- Fades the bottom edge so the peeked step reads as NEXT rather than as more
           of the current one. Sits above the deck and takes no pointer events, so it
           never intercepts a drag. Its height is the measured peek rather than a fixed
           band: the whole preview should read as faded, but stretching a fixed 224px
           over a step that fills the screen would wash out instruction text the cook is
           still reading. -->
        <div
          class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background to-transparent"
          style="height: {fadeHeight}px"
          aria-hidden="true"
        ></div>
      </main>
    {/if}

    <!-- Footer. Exactly one primary action, always in the same place — it's the only
       thing a cook with messy hands should have to aim at. Leaving cook mode is the
       header's back arrow (which keeps the session); ending it for good is the
       "Finish cooking" state below, reachable once every step is ticked. -->
    <footer class="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3">
      {#if stage === 'mise'}
        <Button
          variant="ghost"
          onclick={toggleAllIngredients}
          disabled={totalIngredients === 0}
          data-testid="cook-mise-check-all"
        >
          {#snippet leading()}<Icon name="CheckCheck" size={16} />{/snippet}
          {allIngredientsChecked ? 'Uncheck all' : 'Check all'}
        </Button>
        <!-- "Continue" once any step is ticked: mise is reachable mid-cook via the
           footer's back button, so this is just as often a return to a cook already
           under way as it is a fresh start, and the label should say which.
           `completedStepCount` counts only steps still present in the recipe, so a
           cook whose completed steps were edited away correctly reads "Start" again. -->
        <Button size="lg" onclick={goToSteps} data-testid="cook-stage-toggle">
          {completedStepCount > 0 ? 'Continue cooking' : 'Start cooking'}
          {#snippet trailing()}<Icon name="ArrowRight" size={16} />{/snippet}
        </Button>
      {:else}
        <Button variant="ghost" onclick={goToMise} data-testid="cook-stage-back">
          {#snippet leading()}<Icon name="ArrowLeft" size={16} />{/snippet}
          Mise en place
        </Button>
        {#if currentStep && !currentStepDone}
          <Button size="lg" onclick={handleStepDone} data-testid="cook-step-done">
            {#snippet leading()}<Icon name="Check" size={18} />{/snippet}
            {nextIncompleteStep ? 'Done · next' : 'Done'}
          </Button>
        {:else if nextIncompleteStep}
          <Button size="lg" onclick={handleResume} data-testid="cook-step-resume">
            Resume · step {nextIncompleteNumber}
            {#snippet trailing()}<Icon name="ArrowRight" size={18} />{/snippet}
          </Button>
        {:else}
          <Button
            size="lg"
            onclick={handleComplete}
            loading={completing}
            disabled={completing}
            data-testid="cook-mode-complete"
          >
            {#snippet leading()}<Icon name="Check" size={18} />{/snippet}
            Finish cooking
          </Button>
        {/if}
      {/if}
    </footer>
  {/if}
</div>
