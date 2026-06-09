// The shared day shape used by both the template (weekday-keyed) and a concrete
// week (date-keyed). See docs/meal-planning.md.

export interface Attendee {
  readonly memberId: string;
  // "HH:mm" 24h local time, or null = attending but time unknown (a valid saved
  // state, not "missing").
  readonly homeTime: string | null;
  // Per-person free-text note, e.g. "make a portion for another day".
  readonly note: string;
}

export interface Day {
  // Free-text meal description (v1). Recipe refs arrive via recipeIds (#17).
  readonly note: string;
  // RESERVED seam for recipes (#17); always empty until that module lands.
  readonly recipeIds: readonly string[];
  // Zero or more chefs; a chef need NOT be an attendee. Member refs only.
  readonly chefs: readonly string[];
  readonly attendees: readonly Attendee[];
}
