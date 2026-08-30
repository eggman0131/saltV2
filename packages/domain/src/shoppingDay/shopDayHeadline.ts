// The one rendering of the shop-day headline (issue #1054).
//
// The same sentence is shown on the shopping list and pushed by the daily
// reminder, and until now each app spelled it out for itself under a comment
// asking a human to keep the two in agreement. `web-pwa` and `cloud-functions`
// cannot import each other (CLAUDE.md Rule 6), so the rule lives here — in the
// one package both runtimes already depend on — and each side calls it.
//
// `Intl.DateTimeFormat` is an ECMA-402 built-in available in both runtimes
// (never a Node or browser API); `calendarDates.ts:1-7` settles that question
// for this module, and `daysBetween`'s doc already named this very phrasing as
// its reason for existing.
//
// Pure and clockless (Rule 1): the caller supplies both the distance and the
// date, exactly as `dateInZone(now, timeZone)` requires it to supply the instant.

/** What the headline needs to render. No display policy, no clock, no I/O. */
export interface ShopDayHeadlineInput {
  /**
   * Whole calendar days from today to the shop day, as `daysBetween` computes
   * it. `0` and `1` are the two relative phrasings; ANY other value renders the
   * weekday — negatives included, because "a shop that already happened" is a
   * display policy about a stale page and belongs at the call site that knows
   * whether its window has been open across midnight, not here.
   */
  readonly days: number;
  /** The shop day's calendar date, `YYYY-MM-DD`. Read only by the weekday branch. */
  readonly date: string;
  /**
   * The shop's slot (`am` / `pm`), rendered uppercase after the day. Omitted or
   * null renders the day alone — the service-worker fallback's case, which
   * cannot know the slot because it never read the payload.
   */
  readonly slot?: string | null;
}

/**
 * The shop-day headline: `Shopping today AM`, `Shopping tomorrow PM`,
 * `Shopping Sat AM` — or the same three without the slot when none is given.
 *
 * It reads relative only where relative beats a weekday: "today" and "tomorrow"
 * are unambiguous, while "in 4 days" is arithmetic the reader has to undo to
 * know whether to plan around it.
 */
export function shopDayHeadline({ days, date, slot }: ShopDayHeadlineInput): string {
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : weekdayOf(date);
  return slot ? `Shopping ${when} ${slot.toUpperCase()}` : `Shopping ${when}`;
}

/**
 * The short weekday for a `YYYY-MM-DD` date — `Sat`, `Sun`.
 *
 * Formatted in UTC off a date-only value, so the weekday is the one the date
 * names rather than whatever the formatting machine's zone would shift it to.
 */
function weekdayOf(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00.000Z`),
  );
}
