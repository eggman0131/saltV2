import type { StepDoc } from '../schemas/index.js';

// The earliest step in `steps` that has not been ticked off, or null when every
// step is done (or there are no steps at all).
//
// Recipe order is authoritative, NOT completion order: a cook who ticks step 3
// before step 2 is still sent back to step 2. Callers wanting "the next
// outstanding step AFTER this one" pass an already-sliced list.
//
// `completedIds` is a set of step ids rather than the session itself so the same
// query serves both the reactive read and the non-reactive snapshot read.
export function firstIncompleteStepId(
  steps: readonly StepDoc[],
  completedIds: ReadonlySet<string>,
): string | null {
  for (const step of steps) {
    if (!completedIds.has(step.id)) return step.id;
  }
  return null;
}
