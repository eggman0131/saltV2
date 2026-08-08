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
export { withPrepChecked } from './withPrepChecked.js';
export { withAllIngredientsChecked } from './withAllIngredientsChecked.js';
export { withGroupChecked } from './withGroupChecked.js';
export { withTimerStarted } from './withTimerStarted.js';
export { withTimerDismissed } from './withTimerDismissed.js';
// A guided plan's check-ins ride `activeTimers` as ordinary entries, so their
// identity has to be derived — see checkInTimerId.ts for why, and for the three
// places that derivation is the only handle anything has on them.
export { checkInTimerId, isCheckInTimerId, isCheckInOf } from './checkInTimerId.js';
export { firstUseByStep } from './firstUseByStep.js';
export { firstIncompleteStepId } from './firstIncompleteStepId.js';
export { miseProgress } from './miseProgress.js';
export type { MiseProgress } from './miseProgress.js';
// Guided cook (issue #751, Phase 2) — the same two questions asked of a guided
// prep list rather than of the recipe's ingredient checklist.
export { guidedMiseProgress } from './guidedMiseProgress.js';
export { unpreppedIngredients } from './unpreppedIngredients.js';
// Guided cook amounts (issue #761, Phase 1) — guided mode never shows less than
// plain cook mode, so a prep job says how much it prepares, a named bowl says
// what is in it, and an ingredient that came out of no bowl is still printed at
// the step that first uses it. All three hang off the container-name join, whose
// one normaliser is exported so later phases group by the same answer.
export { normaliseContainerName } from './normaliseContainerName.js';
export { prepEntryForContainer } from './prepEntryForContainer.js';
export { prepEntryIngredients } from './prepEntryIngredients.js';
export { looseIngredientsForStep } from './looseIngredientsForStep.js';
// `hasRecipeChanged` used to live here. It now takes two timestamps rather than a
// session (issue #751 needed the same comparison for a guided plan's own stamp),
// so it belongs to the recipe module — see recipe/queries/hasRecipeChanged.ts.
export { formatClock } from './formatClock.js';
export { timerProgress } from './timerProgress.js';
