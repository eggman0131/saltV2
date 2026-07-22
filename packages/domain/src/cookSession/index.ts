// Cook-session module (cooking mode, issue #556). The pure session-state logic
// behind cook mode: mise-en-place ticking, guided-step completion, step timers,
// and the recipe-drift comparison — extracted out of `CookModePage.svelte` so it
// is testable without a browser.
//
// Every producer is IMMUTABLE (returns a new session; never mutates the input)
// and NONE of them stamp `updatedAt` — the persistence seam owns that, and
// duplicating it here would fight whole-document LWW.
//
// No clock reads anywhere (CLAUDE.md Rule 1): every timestamp — `nowIso`,
// `endsAt`, `nowMs` — is an injected parameter, which is also what makes the
// timer logic testable without faking time.
export { makeFreshSession } from './makeFreshSession.js';
export type { MakeFreshSessionArgs } from './makeFreshSession.js';
export { withStepDone } from './withStepDone.js';
export { withIngredientChecked } from './withIngredientChecked.js';
export { withAllIngredientsChecked } from './withAllIngredientsChecked.js';
export { withTimerStarted } from './withTimerStarted.js';
export { withTimerDismissed } from './withTimerDismissed.js';
export { firstUseByStep } from './firstUseByStep.js';
export { firstIncompleteStepId } from './firstIncompleteStepId.js';
export { miseProgress } from './miseProgress.js';
export type { MiseProgress } from './miseProgress.js';
export { hasRecipeChanged } from './hasRecipeChanged.js';
export { formatClock } from './formatClock.js';
export { timerProgress } from './timerProgress.js';
