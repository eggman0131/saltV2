import { z } from 'zod';
import { WeekdayEnum, MealPlanDaySchema } from './mealPlanDay.js';

// Singleton `mealPlanTemplate/{document}` — the standard week, keyed by weekday.
// Loaded into any concrete week via instantiateWeek and then tweaked.
export const MealPlanTemplateSchema = z.object({
  schemaVersion: z.literal(1),
  days: z.record(WeekdayEnum, MealPlanDaySchema),
});

export type MealPlanTemplateDoc = z.infer<typeof MealPlanTemplateSchema>;
