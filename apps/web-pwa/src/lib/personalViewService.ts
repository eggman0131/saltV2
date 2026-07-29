import {
  addCalendarDays,
  chefDaysForMember,
  firstIncompleteStepId,
  isUnopenedImport,
  rankPersonalCards,
  unshoppedPlannedRecipes,
  weekDates,
  type Member,
  type Recipe,
} from '@salt/domain';
import type { CookSessionDoc, ShoppingDayDoc, WeatherDaySummary } from '@salt/domain/schemas';
import { derived, readable } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { currentMember, members } from './membersService.js';
import { currentWeek } from './mealPlanService.js';
import { itemsForActiveList } from './shoppingListService.svelte.js';
import { recipes } from './recipeService.js';
import { myCookSessions } from './cookSessionService.js';
import { upcomingShopDay, weekShopDay } from './shoppingDayService.js';
import { weatherForecast } from './weatherService.js';

// Personal view composition (issue #634). "Mine" is not a dashboard and not an
// inbox — it is a PROJECTION over family-shared data, filtered through who I am.
//
// Every store read here is already subscribed app-wide from App.svelte, so all of
// this costs zero extra Firestore reads — which is also what makes the nav badge
// free from any page. This module issues NO writes: there is no new failure
// surface and nothing new to report (docs/salt-architecture.md §7.6). All policy
// (who is cooking, what is unshopped, what ranks first) lives in `@salt/domain`;
// what is left here is composition and the clock.
//
// Note the week these read is the one the PLANNER has selected. MinePage resets it
// to the current week on mount, exactly as the planner does; the nav badge, which
// has no mount of its own, counts against whatever week is loaded. Giving the badge
// its own week subscription would duplicate a subscription to save a member who has
// browsed to another week from a slightly stale count — not worth it.

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA'); // en-CA renders local-tz YYYY-MM-DD
}

// A minute clock, live only while something is subscribed to it. Relative labels
// ("4 min ago") and the 24-hour import window need a `now` that moves; nothing
// else on the page does, so this deliberately does not drive the rest.
export const nowMs: Readable<number> = readable(Date.now(), (set) => {
  const id = setInterval(() => set(Date.now()), 60_000);
  return () => clearInterval(id);
});

// ─── 1. Live — resume a cook ─────────────────────────────────────────────────

export interface LiveCook {
  readonly session: CookSessionDoc;
  readonly recipe: Recipe;
  /** 1-based position of the step to resume on. */
  readonly stepNumber: number;
  readonly stepCount: number;
  readonly completedCount: number;
}

/**
 * The cook I am in the middle of, if any — the only thing on the page that is
 * happening *this minute*, so it comes first and there is at most one.
 *
 * Sessions arrive newest-first; the first one whose recipe still exists wins. A
 * session whose recipe was deleted is skipped rather than shown as a broken card
 * (the cook page cleans those up when it next opens one).
 */
export const liveCook: Readable<LiveCook | null> = derived(
  [myCookSessions, recipes],
  ([$sessions, $recipes]) => {
    for (const session of $sessions) {
      const recipe = $recipes.find((r) => r.id === session.recipeId);
      if (!recipe) continue;
      const completed = new Set(session.completedStepIds);
      const nextStepId = firstIncompleteStepId(recipe.steps, completed);
      const index = nextStepId ? recipe.steps.findIndex((s) => s.id === nextStepId) : -1;
      // Count over the RECIPE, not the session's id list: a step edited out of the
      // recipe must not inflate progress (same reasoning as miseProgress).
      const completedCount = recipe.steps.filter((s) => completed.has(s.id)).length;
      return {
        session,
        recipe,
        // Every step done (or a recipe with no steps) resumes at the last step.
        stepNumber: index >= 0 ? index + 1 : recipe.steps.length,
        stepCount: recipe.steps.length,
        completedCount,
      };
    }
    return null;
  },
);

// ─── 2. Tonight ──────────────────────────────────────────────────────────────

export interface TonightPlan {
  readonly date: string;
  readonly note: string;
  readonly recipes: readonly Recipe[];
  readonly chefs: readonly Member[];
  /** I am down to cook tonight. */
  readonly mine: boolean;
  readonly weather: WeatherDaySummary | undefined;
  /** Anything at all is planned — a note, a recipe, or a chef. */
  readonly planned: boolean;
}

/**
 * Tonight's meal — the one HOUSEHOLD card, and what keeps the screen from being
 * blank on a day when nothing is personally yours.
 *
 * Null only when today falls outside the loaded week (the planner is browsing
 * another week and this page hasn't reset it yet).
 */
export const tonight: Readable<TonightPlan | null> = derived(
  [currentWeek, recipes, members, currentMember, weatherForecast],
  ([$week, $recipes, $members, $me, $forecast]) => {
    const date = todayIso();
    const day = $week.days[date];
    if (!day) return null;
    const plannedRecipes = day.recipeIds
      .map((id) => $recipes.find((r) => r.id === id))
      .filter((r): r is Recipe => !!r);
    return {
      date,
      note: day.note,
      recipes: plannedRecipes,
      chefs: day.chefs
        .map((id) => $members.find((m) => m.id === id))
        .filter((m): m is Member => !!m),
      mine: !!$me && day.chefs.includes($me.id),
      weather: $forecast?.days[date],
      planned: day.note.trim() !== '' || day.recipeIds.length > 0 || day.chefs.length > 0,
    };
  },
);

// ─── 3. Your week ────────────────────────────────────────────────────────────

export interface WeekStripDay {
  readonly date: string;
  /** I am down to cook. */
  readonly mine: boolean;
  readonly isToday: boolean;
  readonly isPast: boolean;
  readonly isShopDay: boolean;
}

export interface YourWeek {
  readonly days: readonly WeekStripDay[];
  /** The dates I am cooking, in calendar order. */
  readonly chefDates: readonly string[];
}

export const yourWeek: Readable<YourWeek> = derived(
  [currentWeek, currentMember, weekShopDay],
  ([$week, $me, $shop]) => {
    const today = todayIso();
    const chefDates = chefDaysForMember($week, $me?.id ?? '');
    const mine = new Set(chefDates);
    return {
      chefDates,
      days: weekDates($week.startDate).map((date) => ({
        date,
        mine: mine.has(date),
        isToday: date === today,
        isPast: date < today,
        isShopDay: $shop?.date === date,
      })),
    };
  },
);

// ─── 4. Needs you ────────────────────────────────────────────────────────────

interface NeedsYouBase {
  readonly id: string;
  readonly date: string | null;
  /** The shop is today or tomorrow. */
  readonly urgent: boolean;
}

export interface UnshoppedCard extends NeedsYouBase {
  readonly kind: 'unshopped-mine' | 'unshopped-other';
  readonly date: string;
  readonly recipe: Recipe;
  readonly missingCount: number;
}

export interface NeedsCheckCard extends NeedsYouBase {
  readonly kind: 'needs-check';
  readonly date: null;
  readonly count: number;
}

export type NeedsYouCard = UnshoppedCard | NeedsCheckCard;

// The shop being today or tomorrow is what turns "worth knowing" into "do it now".
function shopIsImminent(shop: ShoppingDayDoc | null | undefined, today: string): boolean {
  if (!shop) return false;
  return shop.date === today || shop.date === addCalendarDays(today, 1);
}

/**
 * The queue: at most three, ranked, yours first (see `rankPersonalCards`).
 *
 * Somebody else's unshopped night gets exactly ONE card however many there are —
 * this page is what needs *you*, and a backlog of other people's nights is how a
 * personal view turns into a nag.
 */
export const needsYou: Readable<readonly NeedsYouCard[]> = derived(
  [currentWeek, itemsForActiveList, recipes, currentMember, upcomingShopDay],
  ([$week, $items, $recipes, $me, $shop]) => {
    const today = todayIso();
    const urgent = shopIsImminent($shop, today);
    const mineDates = new Set(chefDaysForMember($week, $me?.id ?? ''));

    const cards: NeedsYouCard[] = [];
    let othersCard = false;
    for (const unshopped of unshoppedPlannedRecipes($week, $items, $recipes, today)) {
      const recipe = $recipes.find((r) => r.id === unshopped.recipeId);
      if (!recipe) continue;
      const mine = mineDates.has(unshopped.date);
      if (!mine) {
        if (othersCard) continue;
        othersCard = true;
      }
      cards.push({
        kind: mine ? 'unshopped-mine' : 'unshopped-other',
        id: `unshopped:${unshopped.recipeId}`,
        date: unshopped.date,
        urgent,
        recipe,
        missingCount: unshopped.missingCount,
      });
    }

    const needsCheckCount = $items.filter((i) => i.needsCheck && !i.checked).length;
    if (needsCheckCount > 0) {
      cards.push({
        kind: 'needs-check',
        id: 'needs-check',
        date: null,
        urgent,
        count: needsCheckCount,
      });
    }

    return rankPersonalCards(cards);
  },
);

// ─── 5. Just happened (Phase 2) ──────────────────────────────────────────────

/**
 * Imports that landed in the last 24 hours and have not been touched since —
 * newest first.
 *
 * This is the recovery path for the module-memory hole: a share-sheet import is
 * persisted server-side, but the draft the client routes you to lives in module
 * memory, so an Android kill loses every pointer to a recipe that is sitting
 * safely in Firestore. Deliberately excluded from the nav badge — it is
 * time-windowed and needs no action, so it must not nag for a day.
 */
export const justHappened: Readable<readonly Recipe[]> = derived(
  [recipes, nowMs],
  ([$recipes, $now]) =>
    $recipes
      .filter((r) => isUnopenedImport(r, $now))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
);

// ─── Nav badge ───────────────────────────────────────────────────────────────

/**
 * What is open right now: the live cook plus the "Needs you" queue.
 *
 * A COUNT OF WHAT IS OPEN, not "what changed since you last looked" — the latter
 * needs a per-user `lastSeenAt`, which means either browser storage (Rule 3) or a
 * fourth per-user collection, and it lies across devices. This needs no memory at
 * all, self-clears when the thing is fixed, and survives a cold launch honestly.
 */
export const mineOpenCount: Readable<number> = derived(
  [liveCook, needsYou],
  ([$live, $cards]) => ($live ? 1 : 0) + $cards.length,
);
