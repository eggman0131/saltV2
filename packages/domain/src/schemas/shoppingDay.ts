import { z } from 'zod';

// `shoppingDays/{YYYY-MM-DD}` — one tiny doc per shop trip (issue #629).
//
// A STANDALONE, family-shared top-level collection, deliberately not a field on a
// shopping list nor on `mealPlans/{startDate}`:
//
//  - It is a fact about the household's WEEK, consumed by two surfaces that
//    neither owns — the planner (which shades pre-shop days) and the reminder
//    (which decides whether to nudge tonight).
//  - A meal-plan week doc only exists once someone plans that week, but the shop
//    happens regardless; anchoring to it would also drag shop-day writes into
//    full-document LWW contention with whoever is editing the week.
//  - The date-keyed id does real work: the daily reminder is a single `get` by
//    deterministic id, the planner reads a week with one range query over ids,
//    and "no shop this week" is simply the absence of a doc — no cleared state to
//    represent, nothing stale to filter out.
//
// Greenfield collection → no back-compat constraint. Docs accumulate at ~52/year
// and are kept as a record of when shops actually happened; no sweep needed.
export const ShoppingSlotSchema = z.enum(['am', 'pm']);

export const ShoppingDaySchema = z.object({
  // Local CALENDAR date, equal to the doc id. Deliberately a date string and not
  // a timestamp: "Saturday morning" is a wall-clock concept, and storing an
  // instant would force a timezone decision at write time on a client that may
  // not be in the home timezone.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Drives COPY AND DISPLAY ONLY — never timing. Both slots nudge at the same
  // hour the evening before (see remindShoppingDay).
  slot: ShoppingSlotSchema,
  schemaVersion: z.literal(1).default(1),
  setBy: z.string(), // uid, audit only
  setAt: z.string(), // ISO
});

export type ShoppingSlot = z.infer<typeof ShoppingSlotSchema>;
export type ShoppingDayDoc = z.infer<typeof ShoppingDaySchema>;
