// Batch module (issue #812, phase 1 of epic #778) — ONE RUN of a formula: what was
// weighed, when each stage lands, and how far it has got.
//
// The load-bearing decision of the whole epic is that this is first-class. Skip it
// and bread scaling degenerates into optional fields on a recipe with nowhere for
// the day-to-day UX to live; build it and the ferments and cures of phases 03/04
// are the same document with a longer clock.
//
// Flat lightweight variant of the domain module pattern (see
// docs/domain-implementation.md), matching `formula`, `process`, `shoppingDay` and
// `weather`: no entities/ports/commands/queries subfolders, because there is
// nothing to abstract — this module holds a resolver and three producers. This file
// is its only public surface.
//
// Pure, and every instant is INJECTED (CLAUDE.md Rule 1): `freezeBatch` takes the
// anchor and `now`, `withStageAdvanced` takes the instant the stage finished.
// Nothing here reads a clock, mints an id, or decides that time has passed.
//
// DELIBERATELY ABSENT:
//
//   • Rescaling and rescheduling. There is no producer that changes a quantity or
//     re-anchors a running batch, and that is the feature: freezing exists to stop
//     a run growing versions, and a batch you can rescale no longer records what
//     you did.
//   • Observations — weight, pH, a photo, a note (phase 04) — and the `finished`
//     state that a cure's weight-loss criterion would decide. Both are named in the
//     contract doc; neither has a producer or a consumer today, and the shapes here
//     preclude neither.
//   • Any fermentation model. What a longer retard does to a dough is an opinion,
//     and the contract doc's "what not to build" says so outright. The maths here
//     is addition and subtraction of minutes.
export { freezeBatch } from './freezeBatch.js';
export type { FreezeBatchInput, FreezeBatchResult, FreezeBatchFailure } from './freezeBatch.js';
export { currentStage, withStageAdvanced, withBatchAbandoned } from './transitions.js';
