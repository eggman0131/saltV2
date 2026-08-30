import type { AttendeeDoc, MealPlanDayDoc } from '../../schemas/mealPlanDay.js';

// The shared day shape used by both the template (weekday-keyed) and a concrete
// week (date-keyed). See docs/meal-planning.md. Schema-first (issue #417,
// carried here by issue #932): aliases of the inferred schema types, so the
// entities and the stored documents cannot drift.

// `homeTime` is "HH:mm" 24h local time, or null = attending but time unknown —
// a valid saved state, not a missing value. `note` is per-person free text.
export type Attendee = AttendeeDoc;

// `recipeIds` is a RESERVED seam for recipes (#17); always empty until that
// module lands. `chefs` are member refs and a chef need NOT be an attendee.
// `guests` counts extra, unnamed diners with no member record.
export type Day = MealPlanDayDoc;
