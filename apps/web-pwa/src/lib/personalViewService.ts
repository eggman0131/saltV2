import { daysBetween, firstIncompleteStepId, upcomingChefDays, type Recipe } from '@salt/domain';
import type { Day } from '@salt/domain';
import type { ChatSessionDoc, CookActiveTimerDoc, CookSessionDoc } from '@salt/domain/schemas';
import { derived, readable } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { recipes } from './recipeService.js';
import { myCookSessions } from './cookSessionService.js';
import { sessions } from './chatService.js';
import { kitchenAnchorDate, kitchenWeeks } from './mealPlanService.js';
import { currentMember } from './membersService.js';

// Personal view composition (issues #634, #682, #755). "Kitchen" is not a
// dashboard and not an inbox — it answers what of mine is RUNNING right now, what
// is coming at me, and what needs a look.
//
// #682 cut it back to the first and last of those. Tonight, Your week and Needs
// you were all restating the planner and the shopping list, which say it better
// on their own pages, so they and their domain helpers went. What #755 adds back
// is deliberately not a restatement: WHICH NIGHTS ARE MINE, across however many
// weeks that run of days spans, is a projection the planner cannot render,
// because the planner renders weeks and a personal run of nights does not stop at
// the end of one. The rest is my step timers, my open cooks, the standing queue
// of entries flagged `needs_approval`, and — last, and out of the badge — a short
// list of recent chats, which is a shortcut rather than something waiting on you.
//
// COST. Most of this is free: timers, cooks, the review queue and the chats all
// read stores already subscribed app-wide from App.svelte, which is what makes
// the nav badge free from any page. `upcomingChefNights` is NOT free, and it is
// the only thing here that is not: it projects over one or two meal-plan week
// documents that `subscribeKitchenWeeks()` opens while the page is mounted (the
// planner is usually holding at least one of them already, in which case the
// subscription is shared and the extra read is nil). Nothing in the badge depends
// on it, so a page that is not open costs nothing.
//
// This module issues no writes of its own; the commands the page fires (dismiss a
// timer, cancel a cook, mark a recipe reviewed) go through cookSessionService and
// recipeService, which report per the observability gate
// (docs/salt-architecture.md §7.6).

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

// ─── 3. Cooking soon ─────────────────────────────────────────────────────────

export interface UpcomingChefNight {
  /** The night's `YYYY-MM-DD` date key — also its planner deep link. */
  readonly date: string;
  readonly day: Day;
  /** Whole days from today: 0 is tonight, 1 tomorrow. Never negative. */
  readonly daysAway: number;
  /**
   * What is attached to the night, resolved live from the recipes store — never
   * denormalised, and a deleted entry simply drops out rather than rendering as
   * a dead title.
   */
  readonly recipes: readonly Recipe[];
}

/**
 * The nights from today onward that I am down to cook, soonest first.
 *
 * The window and the span are the decision, and they live in the pure domain
 * helper (`upcomingChefDays`); everything added here is resolution — the member
 * id to match on, the entries to name the meal, and the distance from today the
 * row phrases itself with.
 *
 * `today` comes from the meal-plan service rather than from a clock of its own,
 * so the day this filters on is exactly the day whose weeks are subscribed. Two
 * independently-read clocks could disagree across midnight and show a night from
 * a week we are no longer holding.
 *
 * No member resolved yet — the roster still loading, or a sign-in that matches
 * nobody on it — passes an empty id, and the helper answers with nothing. The
 * section is then absent, which is the honest rendering of "we do not know who
 * you are"; a list of everybody's nights would be worse.
 */
export const upcomingChefNights: Readable<readonly UpcomingChefNight[]> = derived(
  [kitchenWeeks, kitchenAnchorDate, currentMember, recipes],
  ([$weeks, $today, $member, $recipes]) =>
    upcomingChefDays($weeks, $member?.id ?? '', $today).map((night) => ({
      date: night.date,
      day: night.day,
      daysAway: daysBetween($today, night.date),
      recipes: night.day.recipeIds
        .map((id) => $recipes.find((r) => r.id === id))
        .filter((r): r is Recipe => r !== undefined),
    })),
);

// ─── 4. Needs review ─────────────────────────────────────────────────────────

/**
 * Everything carrying the stored `needs_approval` flag, newest first — a standing
 * queue, not a notification.
 *
 * One concept, one signal (issue #755). The flag is set by the import flows on
 * raw AI output nobody has read, and it is the SAME flag the recipe page's amber
 * banner and the list's pill read, so all three surfaces agree by construction
 * and clear together. It replaced a derived `updatedAt === createdAt` predicate,
 * which said "nobody has saved this" — true of hand-written entries too, and
 * unclearable without an editor round-trip.
 *
 * No window and no member filter: an import you forgot about three weeks ago is
 * the case most worth catching, and a recipe is family-shared, so "nobody has
 * checked this" is everybody's business. No `kind` gate either, and none is
 * wanted: only the import flows set the flag, and what they produce is a recipe.
 *
 * Deliberately OUT of the nav badge: a standing queue would pin a permanent
 * number to the tab.
 */
export const needsReviewRecipes: Readable<readonly Recipe[]> = derived(recipes, ($recipes) =>
  $recipes
    .filter((r) => r.needs_approval === true)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
);

// ─── 5. Recent chats ─────────────────────────────────────────────────────────

/** How many conversations the page is willing to be a shortcut to. */
const RECENT_CHAT_LIMIT = 5;

/**
 * My last few chef conversations, most recently touched first.
 *
 * Free: `initChatSync` runs from App.svelte at auth time, so this is a projection
 * over a store that is already subscribed and costs no extra Firestore reads.
 * (`upcomingChefNights` is the one store here that is not — see the module
 * header.)
 *
 * Capped rather than paged: this is a shortcut back into a conversation you were
 * just having, and /chat is one tap away for the rest. Recipe-attached sessions
 * are included — a chat is a chat, and the recipe page listing it too (#707) is
 * accepted duplication rather than a rule about which chats are "personal".
 *
 * Sorted on `updatedAt`, matching the chat list itself, so the two surfaces can
 * never disagree about which conversation is the newest.
 *
 * Deliberately OUT of the nav badge: a chat that happened is not something
 * waiting on you, and a permanent five would say otherwise.
 */
export const recentChats: Readable<readonly ChatSessionDoc[]> = derived(sessions, ($sessions) =>
  [...$sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, RECENT_CHAT_LIMIT),
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
 *
 * Both inputs are app-wide subscriptions, so the badge stays free from every
 * page. `upcomingChefNights` is deliberately not one of them — beyond it being a
 * plan rather than a summons, counting it would drag the kitchen's week
 * documents into every screen in the app.
 */
export const mineOpenCount: Readable<number> = derived(
  [liveCooks, firedTimers],
  ([$live, $fired]) => $live.length + $fired.length,
);
