<script lang="ts">
  import { Button, CanonIcon, Icon, Spinner } from '@salt/ui-components';
  import { onDestroy, onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { goBack } from '../../lib/nav.js';
  import { trackUsageEvent } from '@salt/observability';
  import { recipes, isLoadingRecipes } from '../../lib/recipeService.js';
  import {
    cookSession,
    cookSessionEnded,
    isLoadingCookSession,
    initCookSessionSync,
    persistCookSession,
    removeCookSession,
    getCookSessionSnapshot,
  } from '../../lib/cookSessionService.js';
  import { guidedPlan, initGuidedPlanSync } from '../../lib/guidedPlanService.js';
  import { auth } from '../../lib/auth.svelte.js';
  import { canonItems } from '../../lib/canonService.js';
  import { addToast } from '../../lib/toastStore.js';
  import { isWakeLockSupported, createWakeLock } from '../../lib/wakeLock.js';
  import { primeChime } from '../../lib/chime.js';
  import { createCheckOffHold } from '../../lib/checkOffHold.svelte.js';
  import { longpress } from '../../lib/longpress.svelte.js';
  import {
    addItemToDefaultList,
    deleteItemFromList,
  } from '../../lib/shoppingListService.svelte.js';
  import { tick as hapticTick } from '../../lib/haptics.js';
  import { createDeck } from '../../lib/deck.svelte.js';
  import { sectionMinHeight, fadeHeightFor, PEEK_MAX_PX } from '../../lib/cookDeck.js';
  import IngredientText from './IngredientText.svelte';
  import CookTimerSheet from './CookTimerSheet.svelte';
  import {
    makeFreshSession as buildFreshSession,
    withStepDone,
    withPrepChecked,
    withTimerStarted,
    withTimerDismissed,
    firstIncompleteStepId,
    guidedMiseProgress,
    unpreppedIngredients,
    hasRecipeChanged,
    formatClock,
    timerProgress,
    checkInTimerId,
    isCheckInTimerId,
  } from '@salt/domain';
  import type {
    CookActiveTimerDoc,
    CookSessionDoc,
    IngredientDoc,
    StepDoc,
  } from '@salt/domain/schemas';

  // Guided cook (issue #751, Phase 2) — `/recipes/:id/cook/guided`.
  //
  // Cook mode with a lens on it. Same pager, same swipe, same timers, same
  // keep-awake, and — load-bearing — THE SAME SESSION DOCUMENT, so step progress
  // and timers are shared with plain cook mode and a device switch resumes either
  // one. Two things differ:
  //
  //  1. Mise en place is the plan's PREP LIST: jobs with a named container, not
  //     ingredients to fetch. It ticks into `checkedPrepIds`, a second list beside
  //     `checkedIngredientIds` — "I diced the soffritto" and "the carrots are on
  //     the bench" are different facts, and switching modes must not read one as
  //     the other.
  //  2. Each step carries the plan's notes UNDER the recipe's own words. The step
  //     text is never touched, never reworded, never reordered.
  //
  // A SIBLING PAGE rather than a mode flag on CookModePage, deliberately. What
  // differs is not a slot but the whole mise stage — its data model, its tick
  // field, its progress function, its sections (there are none) and an extra
  // section of its own — and the shared part (lifecycle, pager) is already
  // extracted as far as it usefully goes: `initCookSessionSync` /
  // `persistCookSession` / `getCookSessionSnapshot` in `$lib/cookSessionService`,
  // `createDeck` in `$lib/deck`, the pure geometry in `$lib/cookDeck`, and the
  // producers in `@salt/domain/cookSession`. A shell component would be extracting
  // the residue of three prior extractions. It also buys the thing the issue asks
  // for outright: normal cook mode is not edited, so it cannot regress.
  //
  // FULL-VIEWPORT, the second such route (ui-spec-v05 §2, amended by this issue).
  // Its obligations are met exactly as CookModePage meets them: the route is
  // declared in `routes/fullViewport.ts` so App.svelte does not RENDER the chrome
  // (never paints over it), focus is pulled into the page on mount, and there is
  // no `role="dialog"`, no `aria-modal` and no focus trap.
  //
  // CHECK-INS (Phase 3) are armed here and NOWHERE ELSE. Starting a step's timer
  // in this mode also arms the plan's partway reminders for that step, as ordinary
  // `activeTimers` entries on the same write — the existing Cloud Tasks → push path
  // carries them with no server change at all. Plain cook mode arms none, which is
  // what keeps "the same session, two modes" honest: the reminders belong to the
  // plan, and the plan is only in hand here.

  interface Props {
    params: { id: string };
  }
  let { params }: Props = $props();

  const recipe = $derived($recipes.find((r) => r.id === params.id) ?? null);
  const uid = $derived(auth.user?.uid ?? null);
  // Deterministic session id — the SAME one plain cook mode uses.
  const sessionId = $derived(uid ? `${params.id}_${uid}` : null);

  // ─── Subscription lifecycle ────────────────────────────────────────────────────
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

  // The plan itself. Its store has THREE states — `undefined` not loaded, `null`
  // loaded and there is no plan, a document — and all three matter here: the
  // "there is no plan" screen must never flash over a plan that is one frame away.
  $effect(() => {
    const id = params.id;
    if (!id) return;
    return initGuidedPlanSync(id);
  });
  const plan = $derived($guidedPlan);

  // ─── Session bootstrap ─────────────────────────────────────────────────────────
  // Identical to plain cook mode, including the guard: a null store means "no
  // session yet" ONLY when nothing has ended one (issue #559).
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
    // The same event plain cook mode fires. A guided cook IS a cook, and #684's
    // volumetrics count cooks — splitting the event would silently halve the
    // series the dashboard already plots.
    else trackUsageEvent('cook.started', { recipe_id: params.id });
  }

  $effect(() => {
    if (!uid || !recipe || !sessionId) return;
    if ($isLoadingCookSession || bootstrapping) return;
    if ($cookSession) return;
    if ($cookSessionEnded || completing || restarting) return;
    void createFreshSession();
  });

  // ─── Ended on another device ───────────────────────────────────────────────────
  let endedElsewhere = $state(false);
  $effect(() => {
    if (!$cookSessionEnded || endedElsewhere) return;
    endedElsewhere = true;
    addToast('This cook was finished on another device.');
    push(`/recipes/${params.id}`);
  });

  // ─── Deleted-recipe orphan handling ────────────────────────────────────────────
  let orphaned = $state(false);
  $effect(() => {
    if ($isLoadingRecipes) return;
    if (recipe !== null) return;
    if (orphaned) return;
    orphaned = true;
    void handleOrphan();
  });

  async function handleOrphan(): Promise<void> {
    if (sessionId) await removeCookSession(sessionId);
  }

  // ─── Guided mise en place ──────────────────────────────────────────────────────
  // The prep list REPLACES the ingredient checklist, so anything the plan names in
  // no job would be an ingredient the cook never sees. `unpreppedIngredients` is
  // that remainder, and rendering it as "Also get out" is what makes plan drift
  // able to hide GUIDANCE but never an INGREDIENT: for a plan in sync the section
  // is empty and nothing shows; for a stale one it degrades to exactly the rows
  // plain mise would have given.
  const checkedPrepIds = $derived(new Set($cookSession?.checkedPrepIds ?? []));
  const prepEntries = $derived(plan?.prep ?? []);
  const alsoGetOut = $derived.by(() => (recipe && plan ? unpreppedIngredients(recipe, plan) : []));
  // Counted over what is ON SCREEN, never over the session's id list — same
  // direction, and same reason, as `miseProgress`.
  const mise = $derived(guidedMiseProgress(prepEntries, alsoGetOut, checkedPrepIds));

  // ─── The tick ──────────────────────────────────────────────────────────────────
  // The same beat plain cook mode and the shopping list give a check-off: a haptic
  // tick on the way in and a sage wash on the whole row, held by a transient
  // "just ticked" set that expires on its own and no-ops under reduced motion. The
  // hold deliberately outlasts the animation, because the classes only land once
  // the tick is back through the session store.
  const TICK_BEAT_MS = 600;
  const justTicked = createCheckOffHold(TICK_BEAT_MS);
  onDestroy(() => justTicked.dispose());

  // Focus entry for the full-viewport mode (ui-spec-v05 §2.4). The chrome that had
  // focus is unmounted as this route activates, so without this the next Tab
  // restarts at the top of the document. No restore on the way out, for the same
  // reason as cook mode: this route is always entered from a page that unmounts.
  let pageEl = $state.raw<HTMLElement | null>(null);
  onMount(() => pageEl?.focus({ preventScroll: true }));

  function celebrateTick(id: string, checking: boolean): void {
    if (!checking) {
      justTicked.release([id]);
      return;
    }
    hapticTick();
    justTicked.begin([id]);
  }

  // One tick, through a domain producer on a FRESH snapshot — never a field patch.
  // `persistCookSession` rewrites the whole document (LWW), so the prep ticks and
  // the ingredient ticks travel together and neither may be written from a stale
  // copy. The write is never gated on the celebration: leave mid-pop and the tick
  // is still recorded.
  function togglePrep(id: string): void {
    const s = getCookSessionSnapshot();
    if (!s) return;
    celebrateTick(id, !checkedPrepIds.has(id));
    void persistCookSession(withPrepChecked(s, id));
  }

  // ─── Stages ────────────────────────────────────────────────────────────────────
  let stage = $state<'mise' | 'steps'>('mise');

  // One-shot resume, exactly as plain cook mode: a session that already carries
  // step progress opens straight into the steps.
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

  // ─── The plan's notes, by step ─────────────────────────────────────────────────
  // Looked up BY STEP ID against the RECIPE's step list, which is what makes a note
  // whose step no longer exists render as NOTHING: it is never found, never shown,
  // and never re-attached to a neighbouring step.
  //
  const noteByStep = $derived(new Map((plan?.stepNotes ?? []).map((n) => [n.stepId, n] as const)));

  // ─── Canon icons ───────────────────────────────────────────────────────────────
  // Only the "Also get out" rows use these — a prep JOB is an instruction, not an
  // ingredient, and has no canon item to picture. Lookup mirrors ShoppingListPage's
  // `thumbnailFor`/`iconVersionFor`, cache-bust included.
  const canonIconMap = $derived(
    new Map(
      $canonItems.map((ci) => [
        ci.id,
        { thumbnail: ci.thumbnail, version: ci.iconRequestedAt ?? ci.updatedAt },
      ]),
    ),
  );

  function thumbnailFor(canonId: string | null): string | null {
    if (!canonId) return null;
    return canonIconMap.get(canonId)?.thumbnail ?? null;
  }

  function iconVersionFor(canonId: string | null): string | number | undefined {
    if (!canonId) return undefined;
    return canonIconMap.get(canonId)?.version;
  }

  function ingredientLabel(ingredient: IngredientDoc): string {
    return ingredient.parsed?.item ?? ingredient.rawText;
  }

  // Ran out of something? Hold it (issue #714). Same gesture, same target (the
  // DEFAULT list), same undo — on the rows that actually name an ingredient.
  async function addIngredientToShoppingList(ingredient: IngredientDoc): Promise<void> {
    const name = ingredientLabel(ingredient);
    const result = await addItemToDefaultList(name);
    if (result.kind !== 'ok') {
      const message =
        result.error.kind === 'NotFound'
          ? "You haven't made a shopping list yet"
          : `Couldn't add ${name} to the shopping list`;
      addToast(message, result.error.kind === 'NotFound' ? 'default' : 'destructive');
      return;
    }
    const { itemId, listId, listName } = result.value;
    addToast(`Added ${name} to ${listName}`, 'success', {
      action: {
        label: 'Undo',
        onClick: () => void deleteItemFromList(listId, itemId),
      },
    });
  }

  // ─── Step completion ───────────────────────────────────────────────────────────
  // Whole-document LWW through the service. Completion is never a gate, and the
  // pager is never gated either: "don't move on until the sauce has thickened" is
  // a sentence the cook reads, not a lock the app enforces.
  function setStepDone(id: string, done: boolean): void {
    const s = getCookSessionSnapshot();
    if (!s) return;
    const next = withStepDone(s, id, done);
    if (next === s) return;
    void persistCookSession(next);
  }

  const stepEls = new Map<string, HTMLElement>();
  function stepAnchor(node: HTMLElement, id: string) {
    stepEls.set(id, node);
    return {
      destroy() {
        if (stepEls.get(id) === node) stepEls.delete(id);
      },
    };
  }

  // ─── The pager ─────────────────────────────────────────────────────────────────
  // No threshold overrides, for the reason cook mode gives: a guided step section
  // IS the screen, which is the case the defaults in `$lib/cookDeck` were tuned
  // for. The peek comes from there too.
  const deck = createDeck({
    sections: () =>
      (recipe?.steps ?? [])
        .map((step) => stepEls.get(step.id))
        .filter((el): el is HTMLElement => el !== undefined),
  });

  function stepStop(id: string): number | null {
    const el = stepEls.get(id);
    return el ? deck.offsetOf(el) : null;
  }

  // The step parked at the TOP of the scroller — the one the footer acts on. Not
  // "the step with the most visible pixels": a collapsed done row is ~56px, so a
  // full-height step below it would win on area and the footer would tick the
  // wrong one.
  let visibleStepId = $state<string | null>(null);
  let fadeHeight = $state(0);

  function probeVisibleStep(): void {
    const root = deck.viewportEl;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const probeY = rootRect.top + 8;
    for (const step of recipe?.steps ?? []) {
      const rect = stepEls.get(step.id)?.getBoundingClientRect();
      if (!rect) continue;
      if (rect.top <= probeY && rect.bottom > probeY) {
        visibleStepId = step.id;
        fadeHeight = fadeHeightFor(rootRect.bottom - rect.bottom);
        return;
      }
    }
  }

  $effect(() => {
    void deck.offset;
    void deck.viewportHeight;
    probeVisibleStep();
  });

  // Peeking must never change completion: tapping a collapsed row expands it in
  // place, and only the expanded view carries the control that unticks it.
  let peekedStepId = $state<string | null>(null);

  function peekStep(id: string): void {
    peekedStepId = id;
    visibleStepId = id;
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
  // The scroll is parked here and fired by the effect below the moment the
  // completion it waits on arrives — which is also the moment the layout it has to
  // measure becomes final. Only the travel animates; the collapse is instant.
  let pendingScroll = $state<{ afterDoneId: string | null; targetId: string } | null>(null);

  function alignToTop(id: string): void {
    const stop = stepStop(id);
    if (stop !== null) deck.animateTo(stop);
  }

  $effect(() => {
    const pending = pendingScroll;
    if (!pending) return;
    if (pending.afterDoneId && !completedStepIds.has(pending.afterDoneId)) return;
    pendingScroll = null;
    alignToTop(pending.targetId);
  });

  function handleStepDone(): void {
    const step = currentStep;
    if (!step) return;
    const next = nextIncompleteStep;
    setStepDone(step.id, true);
    if (!next) return;
    visibleStepId = next.id;
    pendingScroll = { afterDoneId: step.id, targetId: next.id };
  }

  function handleResume(): void {
    const next = nextIncompleteStep;
    if (!next) return;
    peekedStepId = null;
    visibleStepId = next.id;
    pendingScroll = { afterDoneId: null, targetId: next.id };
  }

  function jumpToStep(id: string): void {
    peekedStepId = null;
    visibleStepId = id;
    pendingScroll = { afterDoneId: null, targetId: id };
  }

  $effect(() => {
    if (stage !== 'steps') return;
    if (!deck.viewportEl || !deck.contentEl) return;
    const snap = getCookSessionSnapshot();
    const done = new Set(snap?.completedStepIds ?? []);
    const steps = recipe?.steps ?? [];
    const targetId = firstIncompleteStepId(steps, done);
    const target = steps.find((s) => s.id === targetId) ?? steps[steps.length - 1];
    if (!target) return;
    const landOn = (): void => {
      const stop = stepStop(target.id);
      if (stop !== null) deck.place(stop);
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

  // ─── Step timers ───────────────────────────────────────────────────────────────
  // Carried unchanged from plain cook mode, because they are the same timers on the
  // same session document: an `activeTimers` entry with an ABSOLUTE `endsAt`, so a
  // reload or a device switch reconstructs the remaining time with no extra client
  // state, and a timer started in one mode is live in the other.
  //
  // The audible alert is NOT here. It lives in the app-level watcher
  // (lib/cookTimerAlerts.ts), which keeps ticking once the chef navigates away.
  // Do not re-add a chime here; two owners means two honks.
  const activeTimers = $derived($cookSession?.activeTimers ?? []);
  // Keyed by STEP: "is there a live timer on the step I am cooking?". A check-in
  // carries its step so the push copy can name it, so this must ask for the step's
  // OWN timer rather than the last entry that mentions the step — otherwise the
  // inline control would count down a reminder and its Cancel would cancel one.
  const timerByStep = $derived(
    new Map(
      activeTimers.flatMap((t) =>
        t.stepId === null || isCheckInTimerId(t.id) ? [] : [[t.stepId, t] as const],
      ),
    ),
  );

  let now = $state(Date.now());
  $effect(() => {
    if (activeTimers.length === 0) return;
    if (typeof setInterval !== 'function') return;
    const handle = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(handle);
  });

  // What the bar shows. A check-in that has FIRED leaves on its own: it is a nudge,
  // not a checkpoint, so there is nothing to confirm and nothing to dismiss, and a
  // "Check the heat — Finished" chip sitting over the braise for the next two hours
  // would be exactly the acknowledgement the issue forbids. The entry stays in the
  // document (harmless — its key is already in the enqueue diff) and goes when the
  // timer it hangs off is dismissed. Derived off `now` rather than the effect above,
  // which must keep watching `activeTimers.length` or it would tear its own interval
  // down every second.
  const barTimers = $derived(
    activeTimers.filter((t) => !isCheckInTimerId(t.id) || Date.parse(t.endsAt) > now),
  );

  // A delivery-precision floor, not a "will the chef walk away" heuristic — see
  // CookModePage for the full reasoning. Kept identical so a timer behaves the same
  // whichever mode started it.
  const NOTIFY_MIN_MINUTES = 1.5;

  // A check-in with nothing typed in it. The editor lets the minutes stand alone,
  // and a reminder that arrives blank is still better than one that silently never
  // arrives, so it goes out under a name rather than being dropped.
  const UNNAMED_CHECK_IN = 'Check in';

  // The plan's reminders for this timer, as ordinary timer entries anchored to the
  // START INSTANT the caller passes in. Absolute, exactly like the main timer's
  // `endsAt`, which is what makes them survive a reload and — the point of the
  // whole design — makes extending the main timer leave them untouched.
  //
  // `durationMinutes` is the check-in's OWN run (`atMinutes` from the same start),
  // not the main timer's: it is what the entry was actually started for, so the
  // progress fill reads as "how far into the wait for this nudge".
  function checkInEntriesFor(
    timerId: string,
    stepId: string | null,
    startMs: number,
  ): CookActiveTimerDoc[] {
    if (stepId === null) return [];
    return (noteByStep.get(stepId)?.checkIns ?? []).map((c) => ({
      id: checkInTimerId(timerId, c.atMinutes),
      stepId,
      label: c.text.trim() === '' ? UNNAMED_CHECK_IN : c.text.trim(),
      durationMinutes: c.atMinutes,
      endsAt: new Date(startMs + c.atMinutes * 60_000).toISOString(),
      // The same delivery-precision floor the main timer uses — a check-in is the
      // same kind of thing, delivered the same way.
      notify: c.atMinutes >= NOTIFY_MIN_MINUTES,
    }));
  }

  function startTimerEntry(entry: {
    id: string;
    stepId: string | null;
    label: string | null;
    durationMinutes: number;
  }): void {
    const s = getCookSessionSnapshot();
    if (!s) return;
    primeChime();
    // One clock read for the main timer AND its check-ins, so every reminder is
    // anchored to the same instant the wait started from.
    const startMs = Date.now();
    const endsAt = new Date(startMs + entry.durationMinutes * 60_000).toISOString();
    void persistCookSession(
      withTimerStarted(
        s,
        { ...entry, endsAt, notify: entry.durationMinutes >= NOTIFY_MIN_MINUTES },
        // Always offered; the producer takes them only when this is a fresh start.
        // Re-timing a running timer keeps the check-ins already armed, because
        // their anchor is the original start — see withTimerStarted.
        checkInEntriesFor(entry.id, entry.stepId, startMs),
      ),
    );
  }

  function startTimer(step: StepDoc): void {
    const timer = step.timer;
    if (!timer) return;
    startTimerEntry({
      id: step.id,
      stepId: step.id,
      label: timer.description ?? null,
      durationMinutes: timer.durationMinutes,
    });
  }

  function dismissTimer(timerId: string): void {
    const s = getCookSessionSnapshot();
    if (!s) return;
    void persistCookSession(withTimerDismissed(s, timerId));
  }

  function timerProgressFor(timer: CookActiveTimerDoc): number | null {
    const durationMinutes =
      timer.durationMinutes ??
      (timer.stepId === null
        ? undefined
        : recipe?.steps.find((s) => s.id === timer.stepId)?.timer?.durationMinutes);
    return timerProgress(timer, durationMinutes ? durationMinutes * 60_000 : null, now);
  }

  // ─── The timer sheet ───────────────────────────────────────────────────────────
  const AD_HOC_TIMER_LABEL = 'Salt Timer';
  const AD_HOC_TIMER_MINUTES = 10;

  interface TimerSheetTarget {
    id: string;
    stepId: string | null;
    label: string;
    durationMinutes: number;
    running: boolean;
  }
  let timerSheetOpen = $state(false);
  let timerSheetTarget = $state<TimerSheetTarget | null>(null);
  const timerSheetPrefill = $derived({
    label: timerSheetTarget?.label ?? AD_HOC_TIMER_LABEL,
    durationMinutes: timerSheetTarget?.durationMinutes ?? AD_HOC_TIMER_MINUTES,
  });

  function openTimerSheet(target: TimerSheetTarget): void {
    timerSheetTarget = target;
    timerSheetOpen = true;
  }

  function openStepTimerSheet(step: StepDoc): void {
    if (!step.timer) return;
    openTimerSheet({
      id: step.id,
      stepId: step.id,
      label: step.timer.description ?? '',
      durationMinutes: step.timer.durationMinutes,
      running: false,
    });
  }

  function openRunningTimerSheet(timer: CookActiveTimerDoc): void {
    const stepDuration =
      timer.stepId === null
        ? undefined
        : recipe?.steps.find((s) => s.id === timer.stepId)?.timer?.durationMinutes;
    openTimerSheet({
      id: timer.id,
      stepId: timer.stepId,
      label: timer.label ?? '',
      durationMinutes: timer.durationMinutes ?? stepDuration ?? AD_HOC_TIMER_MINUTES,
      running: true,
    });
  }

  function openAdHocTimerSheet(): void {
    openTimerSheet({
      id: crypto.randomUUID(),
      stepId: null,
      label: AD_HOC_TIMER_LABEL,
      durationMinutes: AD_HOC_TIMER_MINUTES,
      running: false,
    });
  }

  function confirmTimerSheet(next: { label: string; durationMinutes: number }): void {
    const target = timerSheetTarget;
    if (!target) return;
    startTimerEntry({
      id: target.id,
      stepId: target.stepId,
      label: next.label === '' ? null : next.label,
      durationMinutes: next.durationMinutes,
    });
  }

  // ─── Recipe-changed banner ─────────────────────────────────────────────────────
  const recipeChanged = $derived(
    hasRecipeChanged($cookSession?.recipeUpdatedAtAtStart ?? null, recipe?.updatedAt ?? null),
  );

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
  let completing = $state(false);
  async function handleComplete(): Promise<void> {
    if (!sessionId || completing) return;
    completing = true;
    await removeCookSession(sessionId);
    trackUsageEvent('cook.completed', { recipe_id: params.id });
    push(`/recipes/${params.id}`);
  }

  function handleClose(): void {
    goBack(`/recipes/${params.id}`);
  }

  // ─── Wake lock ─────────────────────────────────────────────────────────────────
  const wakeLockSupported = isWakeLockSupported();
  const wake = wakeLockSupported ? createWakeLock() : null;
  let keepAwake = $state(false);

  // Plain `let`, not `$state` — a re-entrancy guard only read inside the handler.
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

  $effect(() => {
    return () => {
      void wake?.disable();
    };
  });
</script>

<!-- `z-dialog` (50), not a raw z-50: a full-viewport route shares the dialog rung of
   the ladder in ui-spec-v02 §4.1 — above the nav (z-10) and any chrome-replacing bar
   (z-30), below toasts, which must stay legible while cooking. tabindex="-1" exists
   only to make the container a programmatic focus target (see onMount above); it is
   not a tab stop. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={pageEl}
  tabindex="-1"
  class="z-dialog fixed inset-0 flex h-dvh flex-col bg-background focus:outline-none"
  data-testid="guided-cook-page"
>
  {#if recipe === null}
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
  {:else if plan === undefined}
    <!-- The plan's not-loaded state, kept distinct from "there is no plan" so the
       screen below never flashes over a plan one frame from arriving. -->
    <div class="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <Spinner size={20} />
      <p class="text-sm text-muted-foreground">Loading the plan…</p>
    </div>
  {:else if plan === null}
    <!-- Reachable only by typing the URL, or by the plan being deleted from another
       device mid-cook. Never an error: plain cook mode is right there, and it works
       on the very same session, so nothing already ticked or done is lost. -->
    <div
      class="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
      data-testid="guided-cook-no-plan"
    >
      <Icon name="ListChecks" size={28} class="text-muted-foreground" />
      <div class="flex flex-col gap-1">
        <p class="text-base font-semibold">There's no guided plan for this recipe</p>
        <p class="text-sm text-muted-foreground">
          Write one from the recipe page, or cook it the ordinary way.
        </p>
      </div>
      <div class="flex flex-wrap items-center justify-center gap-2">
        <Button
          onclick={() => push(`/recipes/${params.id}/cook`)}
          data-testid="guided-cook-fallback"
        >
          {#snippet leading()}<Icon name="CookingPot" size={16} />{/snippet}
          Cook it anyway
        </Button>
        <Button variant="outline" onclick={handleClose} data-testid="guided-cook-no-plan-back">
          {#snippet leading()}<Icon name="ArrowLeft" size={16} />{/snippet}
          Back
        </Button>
      </div>
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
          <span class="text-xs text-muted-foreground" data-testid="guided-prep-progress">
            Prep · {mise.checked}/{mise.total} done
          </span>
        {:else}
          <!-- The one place the steps stage says which mode you are in. The mise
             stage says it by being a prep list rather than an ingredient list. -->
          <span class="text-xs text-muted-foreground">Guided</span>
        {/if}
      </div>
      <Button
        variant="ghost"
        size="icon"
        onclick={openAdHocTimerSheet}
        ariaLabel="Start a timer"
        title="Start a timer"
        data-testid="cook-mode-timer"
      >
        {#snippet leading()}<Icon name="Timer" size={20} class="text-muted-foreground" />{/snippet}
      </Button>
      {#if wakeLockSupported}
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

    <!-- Timeline. One segment per step, each a jump to it. Same band, same colours
       and same meanings as plain cook mode — this is the same progress. -->
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

    <!-- Persistent timers bar -->
    {#if barTimers.length > 0}
      <div
        class="flex shrink-0 flex-col gap-2 border-b bg-muted/40 px-4 py-3"
        data-testid="cook-timers-bar"
      >
        <div class="mx-auto flex w-full max-w-2xl flex-col gap-2">
          {#each barTimers as t (t.id)}
            {@const remaining = new Date(t.endsAt).getTime() - now}
            {@const fired = remaining <= 0}
            {@const checkIn = isCheckInTimerId(t.id)}
            {@const stepIndex =
              t.stepId === null ? -1 : recipe.steps.findIndex((s) => s.id === t.stepId)}
            {@const stepLabel =
              t.label ??
              (stepIndex >= 0 ? (recipe.steps[stepIndex]?.timer?.description ?? null) : null)}
            {@const stepName = stepIndex >= 0 ? `Step ${stepIndex + 1}` : 'Timer'}
            {@const progress = timerProgressFor(t)}
            <div
              class="overflow-hidden rounded-lg border {fired
                ? 'border-primary bg-primary/10'
                : 'bg-card'}"
              data-testid="cook-timer-chip"
              data-timer-id={t.id}
              data-fired={fired}
              data-check-in={checkIn}
            >
              <div class="flex items-center gap-3 px-3 py-2">
                <!-- A check-in's chip is NOT a way into the sheet. Its `endsAt` is
                   anchored to the moment its timer started, and re-timing it from
                   now would detach it from the wait it belongs to — so it reads as a
                   row, and the only thing you can do to it is call it off. -->
                {#snippet chipBody()}
                  <Icon
                    name={checkIn ? 'Bell' : fired ? 'BellRing' : 'Timer'}
                    size={18}
                    class={fired ? 'shrink-0 text-primary' : 'shrink-0 text-muted-foreground'}
                  />
                  <span
                    class="min-w-0 flex-1 truncate text-sm font-medium {fired
                      ? 'text-primary'
                      : 'text-foreground'}"
                    title={stepLabel ? stepName : undefined}
                    data-testid="cook-timer-chip-label"
                  >
                    {stepLabel ?? stepName}
                  </span>
                  <span
                    class="shrink-0 font-mono text-base tabular-nums {fired
                      ? 'font-semibold text-primary'
                      : ''}"
                    data-testid="cook-timer-chip-time"
                  >
                    {fired ? 'Finished' : formatClock(remaining)}
                  </span>
                {/snippet}
                {#if checkIn}
                  <div class="flex min-w-0 flex-1 items-center gap-3 py-1">
                    {@render chipBody()}
                  </div>
                {:else}
                  <button
                    type="button"
                    class="-mx-1 flex min-w-0 flex-1 items-center gap-3 rounded px-1 py-1 text-left hover:bg-muted"
                    onclick={() => openRunningTimerSheet(t)}
                    data-testid="cook-timer-chip-edit"
                  >
                    {@render chipBody()}
                  </button>
                {/if}
                <Button
                  size="sm"
                  variant={fired ? 'solid' : 'ghost'}
                  onclick={() => dismissTimer(t.id)}
                  data-testid="cook-timer-chip-dismiss"
                >
                  {fired ? 'Dismiss' : 'Cancel'}
                </Button>
              </div>
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

    <!-- Stage 1: the prep list / Stage 2: the steps with their notes -->
    {#if stage === 'mise'}
      <main class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div class="mx-auto flex max-w-2xl flex-col gap-6">
          {#if prepEntries.length === 0 && alsoGetOut.length === 0}
            <p class="text-sm text-muted-foreground" data-testid="guided-prep-empty">
              This plan has no prep — everything happens in the steps.
            </p>
          {/if}

          {#if prepEntries.length > 0}
            <!-- A FLAT list, deliberately. A recipe's ingredients come in sections
               ("For the sauce") and cook mode folds them away as they are gathered;
               a prep list has no such structure — it is a sequence of jobs, each of
               which ends with something in a named bowl, and folding half of them
               away would hide work rather than tidy a list. -->
            <ul class="flex flex-col gap-2" data-testid="guided-prep-list">
              {#each prepEntries as entry (entry.id)}
                {@const checked = checkedPrepIds.has(entry.id)}
                {@const popping = checked && justTicked.isExiting(entry.id)}
                <li>
                  <button
                    type="button"
                    class="flex w-full items-start gap-3 rounded-lg border px-4 py-4 text-left transition-colors active:bg-muted {checked
                      ? 'border-primary/40 bg-primary/5'
                      : 'bg-card hover:bg-muted/50'} {popping
                      ? 'salt-tick-row motion-reduce:animate-none'
                      : ''}"
                    onclick={() => togglePrep(entry.id)}
                    aria-pressed={checked}
                    data-testid="guided-prep-row"
                    data-prep-id={entry.id}
                  >
                    <span
                      class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border {checked
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input'} {popping
                        ? 'salt-check-pop motion-reduce:animate-none'
                        : ''}"
                      data-testid="guided-prep-check"
                    >
                      {#if checked}<Icon name="Check" size={18} />{/if}
                    </span>
                    <span class="flex min-w-0 flex-1 flex-col gap-1">
                      <span class="text-base {checked ? 'text-muted-foreground line-through' : ''}">
                        {entry.text}
                      </span>
                      <!-- The destination. A job with somewhere to put the result is
                         the whole point of a prep list — when the last row is
                         ticked, everything the recipe needs is in a bowl with a
                         name, and the step notes below refer to those names. Null
                         when there is nothing to set aside ("open the tin"). -->
                      {#if entry.container}
                        <span
                          class="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
                          data-testid="guided-prep-container"
                        >
                          <Icon name="Soup" size={14} ariaLabel="Into" />
                          {entry.container}
                        </span>
                      {/if}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}

          {#if alsoGetOut.length > 0}
            <!-- The remainder: ingredients this plan names in no job. Almost always
               because the recipe gained them after the plan was written. Ticked into
               the SAME list as a prep job, by ingredient id — they are rows on this
               screen and the cook should not have to care which kind they are. -->
            <section class="flex flex-col gap-2" data-testid="guided-also-get-out">
              <div class="flex flex-col gap-1 border-b py-2">
                <h2 class="text-base font-semibold text-foreground">Also get out</h2>
                <p class="text-sm text-muted-foreground">
                  The plan doesn't mention these — it was probably written before they were part of
                  the recipe.
                </p>
              </div>
              <ul class="flex flex-col gap-2">
                {#each alsoGetOut as ingredient (ingredient.id)}
                  {@const checked = checkedPrepIds.has(ingredient.id)}
                  {@const popping = checked && justTicked.isExiting(ingredient.id)}
                  <li>
                    <button
                      type="button"
                      class="flex w-full items-center gap-3 rounded-lg border px-4 py-4 text-left transition-colors active:bg-muted {checked
                        ? 'border-primary/40 bg-primary/5'
                        : 'bg-card hover:bg-muted/50'} {popping
                        ? 'salt-tick-row motion-reduce:animate-none'
                        : ''}"
                      onclick={() => togglePrep(ingredient.id)}
                      use:longpress={{
                        onLongPress: () => void addIngredientToShoppingList(ingredient),
                      }}
                      aria-pressed={checked}
                      data-testid="guided-also-get-out-row"
                    >
                      <span
                        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border {checked
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input'} {popping
                          ? 'salt-check-pop motion-reduce:animate-none'
                          : ''}"
                      >
                        {#if checked}<Icon name="Check" size={18} />{/if}
                      </span>
                      <CanonIcon
                        thumbnail={thumbnailFor(ingredient.canonId)}
                        name={ingredientLabel(ingredient)}
                        version={iconVersionFor(ingredient.canonId)}
                        dimmed={checked}
                        size={40}
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
          {/if}
        </div>
      </main>
    {:else}
      <!-- The steps, one per screen, on the same gesture-owned deck plain cook mode
         uses. NOT a scroll container: `$lib/deck` owns the drag, the fling, the
         wheel, the arrow keys and the spring. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <main
        bind:this={deck.viewportEl}
        class="relative min-h-0 flex-1 touch-pinch-zoom overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid="cook-steps-view"
        tabindex="0"
        aria-label="Guided steps"
        onpointerdown={deck.handlePointerDown}
        onpointermove={deck.handlePointerMove}
        onpointerup={deck.handlePointerUp}
        onpointercancel={deck.handlePointerUp}
        onwheel={deck.handleWheel}
        onkeydown={deck.handleKeyDown}
      >
        {#if recipe.steps.length === 0}
          <div class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p class="text-base font-semibold">This recipe has no steps</p>
            <p class="text-sm text-muted-foreground">
              There's nothing to guide through — tap Finish cooking when you're done.
            </p>
          </div>
        {/if}
        <div
          bind:this={deck.contentEl}
          class="will-change-transform"
          style="transform: translate3d(0, {-deck.offset}px, 0); padding-bottom: {PEEK_MAX_PX}px"
          data-testid="cook-steps-deck"
        >
          {#each recipe.steps as step, i (step.id)}
            {@const done = completedStepIds.has(step.id)}
            {@const note = noteByStep.get(step.id) ?? null}
            {@const collapsed = done && peekedStepId !== step.id}
            <!-- Check-ins hang off the step's TIMER, so a step that has lost its
               timer has nothing to hang them on — they are neither shown nor armed
               rather than promised and never delivered. -->
            {@const checkIns = step.timer ? (note?.checkIns ?? []) : []}
            <section
              use:stepAnchor={step.id}
              data-step-id={step.id}
              data-complete={done}
              data-testid="cook-step"
              class="flex flex-col px-4 {collapsed ? 'py-2' : 'border-t py-6'}"
              style="min-height: {collapsed ? 0 : sectionMinHeight(deck.viewportHeight)}px"
            >
              {#if collapsed}
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
                    <!-- THE RECIPE'S OWN WORDS, verbatim and first. The plan adds
                       lines underneath; it never overrides, rewords or reorders
                       one. -->
                    <p class="text-xl leading-relaxed sm:text-2xl">{step.text}</p>
                  </div>

                  <!-- The recipe's own step note, still the recipe speaking, so it
                     keeps its amber-callout vocabulary and its place directly under
                     the instruction — above anything the plan added. -->
                  {#if step.note}
                    <div
                      class="flex items-start gap-3 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                      data-testid="cook-step-note"
                    >
                      <Icon name="TriangleAlert" size={20} class="mt-1 shrink-0 text-amber-500" />
                      <span class="whitespace-pre-wrap text-lg">{step.note}</span>
                    </div>
                  {/if}

                  <!-- What the plan added: which prepped container this step wants,
                     how the station is set, and the sensory test that says it is
                     going right. Quiet rows rather than callouts — none of them is a
                     warning, and three amber boxes on one step would shout down the
                     instruction they belong to. Each line is independently optional
                     (null means the plan had nothing honest to say), so a step with
                     no note renders exactly as it does in plain cook mode.
                     `whitespace-pre-wrap` keeps author-typed line breaks.
                     The check-ins are listed here too, as what they are: what this
                     step's timer will say, and when. Displayed, never enforced —
                     starting the timer is what arms them, and ignoring one changes
                     nothing about the cook. -->
                  {#if note && (note.container || note.setup || note.cue || checkIns.length > 0)}
                    <ul class="flex flex-col gap-3" data-testid="guided-step-notes">
                      {#if note.container}
                        <li class="flex items-start gap-3" data-testid="guided-step-note-container">
                          <Icon
                            name="Soup"
                            size={22}
                            class="mt-1 shrink-0 text-muted-foreground"
                            ariaLabel="Use"
                          />
                          <span class="whitespace-pre-wrap text-lg">{note.container}</span>
                        </li>
                      {/if}
                      {#if note.setup}
                        <li class="flex items-start gap-3" data-testid="guided-step-note-setup">
                          <Icon
                            name="Flame"
                            size={22}
                            class="mt-1 shrink-0 text-muted-foreground"
                            ariaLabel="Setup"
                          />
                          <span class="whitespace-pre-wrap text-lg">{note.setup}</span>
                        </li>
                      {/if}
                      {#if note.cue}
                        <li class="flex items-start gap-3" data-testid="guided-step-note-cue">
                          <Icon
                            name="Ear"
                            size={22}
                            class="mt-1 shrink-0 text-muted-foreground"
                            ariaLabel="Cue"
                          />
                          <span class="whitespace-pre-wrap text-lg">{note.cue}</span>
                        </li>
                      {/if}
                      {#each checkIns as checkIn, ci (ci)}
                        <li class="flex items-start gap-3" data-testid="guided-step-check-in">
                          <Icon
                            name="Bell"
                            size={22}
                            class="mt-1 shrink-0 text-muted-foreground"
                            ariaLabel="Check in"
                          />
                          <span class="whitespace-pre-wrap text-lg">
                            <span class="text-muted-foreground">{checkIn.atMinutes} min in</span> —
                            {checkIn.text}
                          </span>
                        </li>
                      {/each}
                    </ul>
                  {/if}

                  <!-- Per-step timer, unchanged from plain cook mode: state derives
                     purely from the persisted `endsAt`, so it survives reloads and
                     device switches, and the persistent bar above keeps it visible
                     once this step collapses. -->
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
                              {#if step.timer.description}
                                <span
                                  class="min-w-0 flex-1 truncate text-base"
                                  data-testid="cook-step-timer-label"
                                >
                                  {step.timer.description}
                                </span>
                              {/if}
                              <span
                                class="{step.timer.description
                                  ? 'shrink-0'
                                  : 'flex-1'} font-mono text-2xl tabular-nums"
                                data-testid="cook-step-timer-countdown"
                              >
                                {formatClock(remaining)}
                              </span>
                              <Button
                                variant="ghost"
                                onclick={() => dismissTimer(timerEntry.id)}
                                data-testid="cook-step-timer-dismiss"
                              >
                                Cancel
                              </Button>
                            </div>
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
                            {#if step.timer.description}
                              <span
                                class="min-w-0 flex-1 truncate text-base font-medium text-primary"
                                data-testid="cook-step-timer-label"
                              >
                                {step.timer.description}
                              </span>
                            {/if}
                            <span
                              class="{step.timer.description
                                ? 'shrink-0'
                                : 'flex-1'} text-lg font-semibold text-primary"
                              data-testid="cook-step-timer-countdown"
                            >
                              {step.timer.description ? 'Finished' : 'Timer finished'}
                            </span>
                            <Button
                              onclick={() => dismissTimer(timerEntry.id)}
                              data-testid="cook-step-timer-dismiss"
                            >
                              Dismiss
                            </Button>
                          </div>
                        {/if}
                      {:else}
                        <div class="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="lg"
                            class="min-w-0 flex-1"
                            onclick={() => startTimer(step)}
                            data-testid="cook-step-timer-start"
                          >
                            {#snippet leading()}<Icon name="Timer" size={18} />{/snippet}
                            <span class="min-w-0 truncate">
                              Start {step.timer.durationMinutes} minute timer{step.timer.description
                                ? ` (${step.timer.description})`
                                : ''}
                            </span>
                          </Button>
                          <Button
                            variant="outline"
                            size="lg"
                            class="shrink-0"
                            onclick={() => openStepTimerSheet(step)}
                            ariaLabel="Adjust this timer"
                            title="Adjust this timer"
                            data-testid="cook-step-timer-adjust"
                          >
                            {#snippet leading()}<Icon name="Pencil" size={18} />{/snippet}
                          </Button>
                        </div>
                      {/if}
                    </div>
                  {/if}

                  {#if done}
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
        <div
          class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background to-transparent"
          style="height: {fadeHeight}px"
          aria-hidden="true"
        ></div>
      </main>
    {/if}

    <!-- Footer. Exactly one primary action, always in the same place. The mise
       stage has nothing on the left: there is no bulk tick, because a prep list is
       work you actually did, not a shelf you can declare gathered in one tap. -->
    <footer
      class="flex shrink-0 items-center gap-3 border-t px-4 py-3 {stage === 'mise'
        ? 'justify-end'
        : 'justify-between'}"
    >
      {#if stage === 'mise'}
        <Button size="lg" onclick={goToSteps} data-testid="cook-stage-toggle">
          {completedStepCount > 0 ? 'Continue cooking' : 'Start cooking'}
          {#snippet trailing()}<Icon name="ArrowRight" size={16} />{/snippet}
        </Button>
      {:else}
        <Button variant="ghost" onclick={goToMise} data-testid="cook-stage-back">
          {#snippet leading()}<Icon name="ArrowLeft" size={16} />{/snippet}
          Prep
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

    <!-- Mounted for the life of the page, never wrapped in `{#if}` — the sheet owns
       its own open/close transition. It portals to <body>, so it lands above this
       full-viewport container rather than inside it. -->
    <CookTimerSheet
      bind:open={timerSheetOpen}
      prefill={timerSheetPrefill}
      running={timerSheetTarget?.running ?? false}
      onConfirm={confirmTimerSheet}
    />
  {/if}
</div>
