# Meal Planning module

Plan a week's worth of **evening meals**. Each week is one document; a single
**standard template** (the typical week) can be loaded into any week and then
tweaked. The whole point is fast weekly turnaround: load the template, adjust
the exceptions, done.

All data is family-shared (no per-user scoping). Member references are by
`memberId` (= normalised email, the members-module key from #155).

## Documents

| Doc | Firestore path | Cardinality | Purpose |
| --- | --- | --- | --- |
| `MealPlanConfig` | `mealPlanConfig/{document}` (singleton) | 1 | `firstDayOfWeek` — the "big shop" day that starts each week |
| `MealPlanTemplate` | `mealPlanTemplate/{document}` (singleton) | 1 | The standard week, keyed by weekday (`mon`…`sun`) |
| `MealPlanWeek` | `mealPlans/{YYYY-MM-DD}` | many | One concrete week, keyed by the date of its start day |

Config and template are **separate singletons** so editing one never
last-write-wins-clobbers the other.

## Day shape (shared by template and week)

Both the template's seven weekday entries and a week's seven dated entries use
the same shape:

```
Day {
  note: string                       // free-text meal description (v1)
  recipeIds: string[]                // RESERVED seam for recipes (#17); empty until then
  chefs: memberId[]                  // zero or more; a chef need NOT be an attendee
  attendees: Attendee[]
}

Attendee {
  memberId: string
  homeTime: string | null            // "HH:mm" 24h local time; null = attending, time unknown (a valid saved state)
  note: string                       // per-person note, e.g. "make a portion for another day"
}
```

- **Template** keys its seven `Day`s by weekday name. It carries the *usual*
  attendees, chefs, home-times (which may be blank), per-person notes, and an
  optional recurring meal `note` (e.g. Friday = pizza).
- **Week** keys its seven `Day`s by concrete `YYYY-MM-DD` date.

## First-day-of-week & week identity

`firstDayOfWeek` (a global setting, the big-shop day) controls only **layout and
which date a week starts on** — it never reshapes the template. The template is
always keyed mon–sun, so changing the big-shop day re-maps the standard week
onto the new day order without data migration.

A week's document key is the ISO date (`YYYY-MM-DD`) of its start day. A pure
domain function `weekStartFor(date, config)` computes the start date of the week
containing any given date.

## The core mechanic: load template

`instantiateWeek(startDate, config, template)` is a pure function: for each of
the seven dates from `startDate`, it looks up that date's weekday in the
template and copies the weekday `Day` into the dated `Day`. This is the
"load template" action. Re-loading overwrites the week back to the standard,
ready for exception-tweaking. This is the heart of the quick-weekly-update goal.

## Conflict model

One Firestore document per week, **whole-document last-write-wins** (consistent
with Firestore-as-master, no tombstones). The only clobber window is two people
editing the *same* week simultaneously — acceptable for a single small
household. Per-day documents were rejected as over-engineering for the
concurrency profile.

## Member references

Store `memberId` only. Names, initials, and avatars are resolved at **display
time** from the live members store — never denormalised into the plan. A member
who has left the family renders as removable/unknown rather than corrupting the
document. Tolerate-and-render, never block on a missing member.

## Access & admin

Firestore rules keep **writes open to any authenticated user** (an
authenticated user is already an allowlisted member via `beforeMemberCreated`),
matching the shared-data / canon-write-path-open principle. The **template
editor and first-day setting live in the admin settings area**, but that
`AdminGuard` is **cosmetic** (accidental-damage protection) — it is never
enforced in rules. The weekly plan editor is open to all members.

## Architecture placement

New modules sit inside existing packages — **no new package, no new dependency,
no layer-map change, no Cloud Function, no AI** (recipes/AI arrive later via #17):

- `packages/domain/src/mealPlan/` — entities, pure commands/queries
- `packages/domain/src/schemas/mealPlan*.ts` — zod schemas (validated on read in firebase-sync)
- `packages/adapters/firebase-sync/src/mealPlan*.ts` — subscriptions + writes for the three docs
- `apps/web-pwa/src/lib/mealPlanService.ts` + routes — store, navigation, editors

## Future seam: recipes (#17)

`Day.recipeIds` ships now as an always-empty array. When the recipe module
lands, the weekly/template UI gains a recipe multi-select that populates it; the
free-text `note` remains for ad-hoc meals. No schema-shape break required
(pre-launch greenfield; adding use of an existing field is free).
