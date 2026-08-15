import type { MealPlanWeek } from '../entities/MealPlanWeek.js';

/**
 * The last person home on the night this dish is planned for (issue #752) — the
 * only honest default for a meal's serve time.
 *
 * The plan already knows when everyone gets in; a cook plan that opened at a
 * hard-coded 19:00 while the day said 20:15 would be asking the cook to re-enter
 * something the household has already agreed. So: the LATEST non-null `homeTime`
 * among that day's attendees, which is the earliest moment everybody can sit down.
 *
 * GATED ON THE DISH ACTUALLY BEING ON THAT DAY. `recipeId` must appear in the
 * day's `recipeIds` or the answer is null — the caller passes today's date key,
 * and a meal cooked on a night nobody planned it for has no attendees to speak
 * for it. Null then means "no opinion", and the caller falls back to its own
 * default; it never means "nobody is coming".
 *
 * `"HH:mm"` is zero-padded 24-hour, so the lexicographic maximum IS the
 * chronological one and no parsing is needed. An attendee with a null `homeTime`
 * is attending with the time unknown (a valid saved state, not missing data) and
 * simply does not vote.
 *
 * Weeks are taken as an ARRAY for the same reason `upcomingChefDays` takes one:
 * the caller hands over whichever documents it holds and the lookup spans them,
 * with no "which week owns this date" bookkeeping above. First week holding the
 * date wins.
 *
 * Pure, and no clock — `dateKey` is injected, exactly as `today` is elsewhere.
 */
export function latestHomeTimeFor(
  weeks: readonly MealPlanWeek[],
  recipeId: string,
  dateKey: string,
): string | null {
  for (const week of weeks) {
    const day = week.days[dateKey];
    if (!day) continue;
    if (!day.recipeIds.includes(recipeId)) return null;
    let latest: string | null = null;
    for (const attendee of day.attendees) {
      const at = attendee.homeTime;
      if (at === null) continue;
      if (latest === null || at > latest) latest = at;
    }
    return latest;
  }
  return null;
}
