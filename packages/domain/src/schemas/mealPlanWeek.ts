import { z } from 'zod';
import { MealPlanDaySchema } from './mealPlanDay.js';

// `mealPlans/{YYYY-MM-DD}` — one concrete week, keyed (and `id`/`startDate`-
// stamped) by the date of its start day. Whole-document last-write-wins; the
// seven days are keyed by their concrete YYYY-MM-DD dates.
export const MealPlanWeekSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  startDate: z.string(),
  days: z.record(z.string(), MealPlanDaySchema),
  updatedAt: z.string(),
});

export type MealPlanWeekDoc = z.infer<typeof MealPlanWeekSchema>;
