import type { ProcessStage } from '../schemas/index.js';

// Which stages of a process are worth a notification (issue #812, phase 3 of epic
// #778).
//
// ─── THE RULE, AND THE WHOLE POINT OF IT ────────────────────────────────────────
//
//   Remind at the start of the FIRST stage, and at the start of any stage that
//   FOLLOWS A `wait` — because that is the moment the unattended period ends and
//   the cook is needed again.
//
// A `wait` is the process saying "you can leave the room" (see
// `ProcessStageKindSchema`, which owns that definition). So the instant AFTER one
// is the instant the room needs you back, and that — not the passage of time, not
// the stage itself — is the only thing a reminder can usefully name. The first
// stage is in for the other half of the same reason: it is the moment the run
// begins, and on a schedule back-solved from "out of the oven at 07:30" it is the
// single most valuable reminder in the whole batch, because nothing on screen has
// told you 13:20 is when you have to be in the kitchen.
//
// On the epic's loaf — mix(active), bulk(wait), shape(active), retard(wait),
// preheat(wait), bake(active) — that yields MIX, SHAPE, PREHEAT and BAKE, and
// NOTHING AT ALL across the eight overnight hours of the retard. That timeline is
// pinned as a test.
//
// Note that `preheat` earns a reminder despite being a `wait` itself: a wait that
// follows a wait is still a handover the cook has to perform (dough out of the
// fridge, oven on), and the rule is about what precedes a stage, never about what
// the stage is. Reading it the other way would drop the oven and lose the loaf.
//
// ─── NO NEW SCHEMA FIELD, AND NO ELAPSED TIME ───────────────────────────────────
//
// There is no `remind` flag on a stage and there must not be one: the answer is
// already in the shape of the process, and a stored flag is a second source of
// truth that an AI-restructured schedule would immediately contradict.
//
// Reminders attach to STAGE TRANSITIONS, never to elapsed time — which is exactly
// what docs/formulas-schedules-batches.md means by "a 90-day cure must not notify
// 90 times". A 90-day dry is one stage; it gets one reminder when it starts, and
// the next when it ends. Adding a per-day or per-stage-unconditional reminder
// would turn the same model into the thing the contract forbids.
//
// ─── PURE, AND NO CLOCK (CLAUDE.md Rule 1) ──────────────────────────────────────
//
// Stages in, stages out. This function does not know what time it is, whether a
// stage has actually happened, or that Cloud Tasks exists. It reads the PLANNED
// process only. Whether a given reminder is still worth sending when its moment
// arrives is a question about live state, answered at dispatch by re-reading the
// batch and no-opping — exactly as the cook timer does — and answering it here
// would need a clock this module is not allowed to have.

/**
 * The stages that earn a reminder, in process order.
 *
 * Generic over `T extends ProcessStage` for the same reason `resolveSchedule` is:
 * the caller is usually holding something richer. The batch reminder trigger passes
 * `BatchStageDoc`s and gets them back whole, `plannedStartAt` included, so the
 * enqueue reads a time it never had to look up.
 *
 * Total: an empty process yields an empty list, and a single-stage process yields
 * that stage (it is the first).
 */
export function remindableStages<T extends ProcessStage>(stages: readonly T[]): T[] {
  return stages.filter((_stage, index) => index === 0 || stages[index - 1]!.kind === 'wait');
}
