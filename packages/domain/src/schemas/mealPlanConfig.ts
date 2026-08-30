import { z } from 'zod';
import { WeekdayEnum } from './mealPlanDay.js';

// Singleton `mealPlanConfig/{document}`. `firstDayOfWeek` is the "big shop" day
// that starts each week — a global layout setting, separate from the template
// so editing one never clobbers the other (docs/meal-planning.md).
export const MealPlanConfigSchema = z.object({
  firstDayOfWeek: WeekdayEnum,
  schemaVersion: z.literal(1),
});

export type MealPlanConfigDoc = z.infer<typeof MealPlanConfigSchema>;
