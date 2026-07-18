import { z } from 'zod';

// Cook session document schema (cooking mode, Phase 1). One document per user per
// recipe at `cookSessions/{recipeId}_{uid}` — a DETERMINISTIC id so a session is
// looked up (not queried) and reopening the same recipe on another device resumes
// the same session. Per-user scoped like chatSessions (issue #206): `ownerUid`
// gates every read/write in firestore.rules. Whole-document last-write-wins.
//
// Phase 1 writes only `checkedIngredientIds` (the mise-en-place tick state). The
// forward-looking fields — `completedStepIds` (Phase 2, guided steps) and
// `activeTimers` (Phase 3, step timers) — are part of the shape NOW so the doc is
// stable across phases, but Phase 1 UI never writes them. They default to empty
// arrays so a session written by an earlier phase (or the bootstrap) parses even
// when the field is absent (back-compat on read).

export const CookActiveTimerSchema = z.object({
  stepId: z.string(),
  // Absolute ISO end-time (not a remaining duration) so the countdown survives a
  // reload / device switch without drift.
  endsAt: z.string(),
  notify: z.boolean(),
});

export const CookSessionSchema = z.object({
  // Deterministic: `${recipeId}_${uid}`.
  id: z.string(),
  schemaVersion: z.literal(1),
  ownerUid: z.string(),
  recipeId: z.string(),
  // Snapshot of the recipe's `updatedAt` taken when the session was created. The
  // cook page compares it against the live recipe's `updatedAt` to detect that the
  // recipe changed under an in-progress cook and offer a Restart.
  recipeUpdatedAtAtStart: z.string(),
  // Mise-en-place tick state (Phase 1). Ingredient ids the cook has checked off.
  // `.default([])` so a session predating this field (or a fresh bootstrap doc)
  // reads as an empty array rather than failing validation.
  checkedIngredientIds: z.array(z.string()).default([]),
  // Guided-step completion (Phase 2). Present now; Phase 1 UI never writes it.
  completedStepIds: z.array(z.string()).default([]),
  // Running step timers (Phase 3). Present now; Phase 1 UI never writes it.
  activeTimers: z.array(CookActiveTimerSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CookActiveTimerDoc = z.infer<typeof CookActiveTimerSchema>;
export type CookSessionDoc = z.infer<typeof CookSessionSchema>;
