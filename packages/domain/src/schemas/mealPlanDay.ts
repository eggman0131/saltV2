import { z } from 'zod';

// Weekday key used by the template (and weekday-indexing of dates). Monday-first
// ordering is the canonical internal order; `firstDayOfWeek` only changes how a
// week is laid out, never this enum (see docs/meal-planning.md).
export const WeekdayEnum = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

// One attendee of a meal. `homeTime` is a "HH:mm" 24h local time, or null when
// the person is attending but their time is unknown — null is a valid saved
// state, not "missing". `note` is a per-person free-text note.
export const AttendeeSchema = z.object({
  memberId: z.string(),
  homeTime: z.string().nullable(),
  note: z.string().default(''),
});

// The shared day shape used by both the template (weekday-keyed) and a concrete
// week (date-keyed). `recipeIds` is a reserved seam for recipes (#17); it ships
// as an always-empty array until that module lands.
export const MealPlanDaySchema = z.object({
  note: z.string().default(''),
  recipeIds: z.array(z.string()).default([]),
  chefs: z.array(z.string()).default([]),
  attendees: z.array(AttendeeSchema).default([]),
});

export type WeekdayDoc = z.infer<typeof WeekdayEnum>;
export type AttendeeDoc = z.infer<typeof AttendeeSchema>;
export type MealPlanDayDoc = z.infer<typeof MealPlanDaySchema>;
