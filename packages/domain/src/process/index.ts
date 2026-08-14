// Process module (issue #806, phase 2 of epic #778) — the ordered stages a dough,
// a ferment or a cure goes through. The shape lives in `schemas/process.ts`; this
// module is the arithmetic and the edits over it.
//
// Flat lightweight variant of the domain module pattern (see
// docs/domain-implementation.md), matching `formula`, `shoppingDay` and `weather`:
// no entities/ports/commands/queries subfolders, because there is nothing to write
// and no infrastructure to abstract. This file is the module's only public
// surface.
//
// SCHEDULING HAS NOW ARRIVED (issue #812), and it is here rather than in `batch/`
// on purpose: placing an ordered process on a clock is a fact about the PROCESS,
// and the batch is only its first customer. There is still no notion of "now" — the
// anchor is passed in, from either end, exactly as the contract doc's placement
// table has it ("forward + backward schedule — pure; 'now' injected").
//
// STILL DELIBERATELY ABSENT: `diffProcess`. There is nothing yet to diff a process
// AGAINST — the proposal flow that restructures one does not exist. It arrives with
// its consumer, in phase 2 of #812.
export { withStageAdded, withStageRemoved, withStageUpdated, withStageMoved } from './stages.js';
export { totalDurationMinutes } from './totalDuration.js';
export type { DurationRange } from './totalDuration.js';
export { resolveSchedule } from './resolveSchedule.js';
export type {
  ScheduleAnchor,
  StageSchedule,
  ScheduleFailure,
  ResolveScheduleResult,
} from './resolveSchedule.js';
