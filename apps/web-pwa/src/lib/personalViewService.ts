import { firstIncompleteStepId, needsReview, type Recipe } from '@salt/domain';
import type { CookActiveTimerDoc, CookSessionDoc } from '@salt/domain/schemas';
import { derived, readable } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { recipes } from './recipeService.js';
import { myCookSessions } from './cookSessionService.js';

// Personal view composition (issues #634, #682). "Mine" is not a dashboard and not
// an inbox — it answers exactly one question: what of mine is RUNNING right now,
// and what needs a look?
//
// #682 cut it back to that. Tonight, Your week and Needs you were all restating
// the planner and the shopping list, which say it better on their own pages, so
// they and their domain helpers are gone. What is left is three things nothing
// else in the app surfaces: my step timers, my open cooks, and the standing queue
// of entries nobody has saved yet.
//
// Every store read here is already subscribed app-wide from App.svelte, so all of
// this costs zero extra Firestore reads — which is also what makes the nav badge
// free from any page. This module issues no writes of its own; the two commands
// the page fires (dismiss a timer, cancel a cook) go through cookSessionService,
// which reports per the observability gate (docs/salt-architecture.md §7.6).

// ─── 1. Timers ───────────────────────────────────────────────────────────────

export interface MineTimer {
  /** Stable across ticks: one live timer per timer id, per session. */
  readonly id: string;
  readonly session: CookSessionDoc;
  readonly recipe: Recipe;
  readonly timer: CookActiveTimerDoc;
  /** The timer's own name, falling back to the step's, then "Step N", then "Timer". */
  readonly label: string;
  /**
   * The duration the timer was actually started for, for the progress fill.
   * Falls back to the step's own duration for legacy entries that stored none;
   * null once there is no duration to be had (the step is gone, or was never one).
   */
  readonly durationMs: number | null;
}

/**
 * Every timer I have running, soonest-ending first — including the ones that have
 * already fired and not been dismissed.
 *
 * A fired timer is not a separate state in the document: it stays in
 * `activeTimers` until someone dismisses it, and "fired" is simply
 * `endsAt <= now`, derived against `timerNowMs` at the point of display. That is
 * the whole reason no schema field was needed here.
 *
 * The sort is on `endsAt` alone, so it needs no clock and yet still floats the
 * fired ones to the top: whatever ended earliest ended first.
 *
 * A session whose recipe was deleted is skipped, exactly as `liveCooks` does —
 * there is nowhere for "Go to recipe" to go.
 */
export const myTimers: Readable<readonly MineTimer[]> = derived(
  [myCookSessions, recipes],
  ([$sessions, $recipes]) => {
    const out: MineTimer[] = [];
    for (const session of $sessions) {
      const recipe = $recipes.find((r) => r.id === session.recipeId);
      if (!recipe) continue;
      for (const timer of session.activeTimers) {
        // An ad-hoc timer belongs to no step, so there is nothing to look up; the
        // step lookup exists only to name and size LEGACY entries, written before
        // a timer carried its own label and duration.
        const stepIndex =
          timer.stepId === null ? -1 : recipe.steps.findIndex((s) => s.id === timer.stepId);
        const step = stepIndex >= 0 ? recipe.steps[stepIndex] : undefined;
        const minutes = timer.durationMinutes ?? step?.timer?.durationMinutes;
        out.push({
          id: `${session.id}::${timer.id}`,
          session,
          recipe,
          timer,
          label:
            timer.label ??
            step?.timer?.description ??
            (stepIndex >= 0 ? `Step ${stepIndex + 1}` : 'Timer'),
          durationMs: minutes ? minutes * 60_000 : null,
        });
      }
    }
    return out.sort((a, b) => Date.parse(a.timer.endsAt) - Date.parse(b.timer.endsAt));
  },
);

const anyTimerRunning: Readable<boolean> = derived(myCookSessions, ($sessions) =>
  $sessions.some((s) => s.activeTimers.length > 0),
);

/**
 * A one-second clock, live only while a timer of mine actually exists.
 *
 * A countdown needs second resolution — the minute ticker this module used to
 * carry would make "4:37" sit still and then jump — but the nav badge subscribes
 * this from every page in the app, and an interval that fires every second for
 * ever to serve a badge that reads zero is pure waste. So the interval is armed
 * and disarmed by `anyTimerRunning`: nothing ticks at rest, which is the same
 * bargain cook mode's own `$effect` strikes.
 *
 * A fired-but-undismissed timer deliberately keeps the clock running: it is still
 * in `activeTimers`, and the badge counting it has to stay honest.
 */
export const timerNowMs: Readable<number> = readable(Date.now(), (set) => {
  let handle: ReturnType<typeof setInterval> | undefined;
  function stop(): void {
    if (handle !== undefined) clearInterval(handle);
    handle = undefined;
  }
  const unsub = anyTimerRunning.subscribe((running) => {
    stop();
    if (!running) return;
    set(Date.now());
    if (typeof setInterval !== 'function') return; // SSR guard
    handle = setInterval(() => set(Date.now()), 1000);
  });
  return () => {
    stop();
    unsub();
  };
});

/** Timers past their `endsAt` that nobody has dismissed — the things shouting. */
export const firedTimers: Readable<readonly MineTimer[]> = derived(
  [myTimers, timerNowMs],
  ([$timers, $now]) => $timers.filter((t) => Date.parse(t.timer.endsAt) <= $now),
);

// ─── 2. In-progress cooks ────────────────────────────────────────────────────

export interface LiveCook {
  readonly session: CookSessionDoc;
  readonly recipe: Recipe;
  /** 1-based position of the step to resume on. */
  readonly stepNumber: number;
  readonly stepCount: number;
  readonly completedCount: number;
}

/**
 * Every cook I have on the go, newest first.
 *
 * ALL of them, not just the newest: a two-pan dinner is two open sessions, and a
 * view that showed one and silently hid the other would be lying about the state
 * of the kitchen. Bounded by the adapter's query limit, not by policy here.
 *
 * A session whose recipe was deleted is skipped rather than shown as a broken
 * card (the cook page cleans those up when it next opens one).
 */
export const liveCooks: Readable<readonly LiveCook[]> = derived(
  [myCookSessions, recipes],
  ([$sessions, $recipes]) => {
    const out: LiveCook[] = [];
    for (const session of $sessions) {
      const recipe = $recipes.find((r) => r.id === session.recipeId);
      if (!recipe) continue;
      const completed = new Set(session.completedStepIds);
      const nextStepId = firstIncompleteStepId(recipe.steps, completed);
      const index = nextStepId ? recipe.steps.findIndex((s) => s.id === nextStepId) : -1;
      // Count over the RECIPE, not the session's id list: a step edited out of the
      // recipe must not inflate progress (same reasoning as miseProgress).
      const completedCount = recipe.steps.filter((s) => completed.has(s.id)).length;
      out.push({
        session,
        recipe,
        // Every step done (or a recipe with no steps) resumes at the last step.
        stepNumber: index >= 0 ? index + 1 : recipe.steps.length,
        stepCount: recipe.steps.length,
        completedCount,
      });
    }
    return out;
  },
);

// ─── 3. Needs review ─────────────────────────────────────────────────────────

/**
 * Everything nobody has saved yet, newest first — a standing queue, not a
 * notification.
 *
 * No window and no member filter: an import you forgot about three weeks ago is
 * the case most worth catching, and a recipe is family-shared, so "nobody has
 * checked this" is everybody's business. The `isCookable` gate that keeps it sane
 * lives in the domain predicate (see `needsReview`), so nothing out here branches
 * on `kind`.
 *
 * Deliberately OUT of the nav badge: a standing queue would pin a permanent
 * number to the tab.
 */
export const needsReviewRecipes: Readable<readonly Recipe[]> = derived(recipes, ($recipes) =>
  $recipes.filter(needsReview).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
);

// ─── Nav badge ───────────────────────────────────────────────────────────────

/**
 * What is waiting on me right now: every open cook, plus every timer that has
 * fired and not been dismissed.
 *
 * A COUNT OF WHAT IS OPEN, not "what changed since you last looked" — the latter
 * needs a per-user `lastSeenAt`, which means either browser storage (Rule 3) or a
 * fourth per-user collection, and it lies across devices. This needs no memory at
 * all, self-clears when the thing is resolved, and survives a cold launch
 * honestly.
 *
 * A timer still counting down is NOT in here. It is running to plan; the badge is
 * for things that want a hand.
 */
export const mineOpenCount: Readable<number> = derived(
  [liveCooks, firedTimers],
  ([$live, $fired]) => $live.length + $fired.length,
);
