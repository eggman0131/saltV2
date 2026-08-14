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
// DELIBERATELY ABSENT, and not by accident:
//
//   • Any scheduling, and any notion of "now". A stage says how LONG it takes; when
//     it starts is a property of a run, and a run is a batch — phase 02, a
//     different document, and the place the clock is injected.
//   • `diffProcess`. There is nothing yet to diff a process AGAINST: the proposal
//     flow that restructures one does not exist. It arrives with its consumer.
//
// Ordering and total duration only.
export { withStageAdded, withStageRemoved, withStageUpdated, withStageMoved } from './stages.js';
export { totalDurationMinutes } from './totalDuration.js';
export type { DurationRange } from './totalDuration.js';
