import type { MealPlanConfigDoc } from '../../schemas/mealPlanConfig.js';

// Singleton config. `firstDayOfWeek` is the "big shop" day that starts each
// week — a global layout setting kept separate from the template. Schema-first
// (issue #932).
export type MealPlanConfig = MealPlanConfigDoc;
