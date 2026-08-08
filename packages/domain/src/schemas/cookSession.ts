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

// A running timer. `id` — NOT `stepId` — is its identity everywhere: the producer
// that replaces it, the enqueue trigger's diff key, the Cloud Task payload, the
// timerDeliveries ledger id, the in-app alert dedupe key and the timers-bar list
// key. A step timer's `id` IS its step id (so there is still exactly one live
// timer per step); an ad-hoc timer gets a minted id and a null `stepId`.
//
// `durationMinutes` records what was ACTUALLY started, which the recipe step can
// no longer be trusted to tell us — a timer may be started for longer or shorter
// than its step says, and an edited recipe would otherwise silently restate the
// run. `label` is the timer's own name for the same reason.
//
// BACK-COMPAT ON READ (mandatory): cookSessions have no TTL and a cook can span
// days, so a session written before these fields existed — `{ stepId, endsAt,
// notify }` — must still parse. The preprocess backfills `id` from `stepId`,
// which is exactly the identity those entries were using; `label` and
// `durationMinutes` default to null and the consumers fall back to the recipe
// step lookup for them.
export const CookActiveTimerSchema = z.preprocess(
  (raw) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const t = raw as Record<string, unknown>;
    if (t['id'] === undefined && typeof t['stepId'] === 'string') return { ...t, id: t['stepId'] };
    return raw;
  },
  z.object({
    id: z.string(),
    // Null for an ad-hoc timer, which belongs to no step. A null stepId must skip
    // every recipe-step lookup rather than search for it.
    stepId: z.string().nullable(),
    // The timer's own name, as typed. Null → fall back to the step's own label.
    label: z.string().nullable().default(null),
    // What was actually started, adjusted or not. Minutes (not seconds) to match
    // StepTimerSchema.durationMinutes. Null → fall back to the step's duration.
    durationMinutes: z.number().nullable().default(null),
    // Absolute ISO end-time (not a remaining duration) so the countdown survives a
    // reload / device switch without drift.
    endsAt: z.string(),
    notify: z.boolean(),
  }),
);

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
