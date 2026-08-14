import type { ProcessStage } from '../schemas/index.js';

// Pure producers over an ordered stage list — the four edits the review surface
// makes. Written in the `cookSession` producer style (`withStepDone`,
// `withTimerStarted`): take the list, return a new list, never mutate.
//
// EVERY ONE IS TOTAL. An unknown id is a no-op, not an error, and a move at either
// end of the list is a no-op too. A review screen is a place where the list under
// your finger and the list in your head disagree by one frame; a producer that
// threw on the disagreement would turn a mis-tap into a crash.
//
// GENERIC over `T extends ProcessStage`, which is one type parameter buying one
// real thing: the review surface holds a HALF-TYPED DRAFT — a temperature and a
// duration as the raw strings being typed, for the same reason the formula screen
// keeps `gramsText` (re-rendering a box from a parsed number means clearing it
// snaps back to the old figure). Those drafts are still stages, they still need
// reordering and deleting, and without the parameter the surface would either lose
// its draft fields through every producer or grow a private copy of all four.
//
// No clock, no scheduling, no diff (CLAUDE.md Rule 1). A stage says how long it
// takes; nothing here knows when it starts.

/**
 * Insert a stage. `index` clamps into range, and defaults to the end.
 *
 * Order is the only thing that says a bulk ferment comes before a shape, so an
 * insert is positional rather than appended-and-sorted: there is no key to sort by.
 */
export function withStageAdded<T extends ProcessStage>(
  stages: readonly T[],
  stage: T,
  index: number = stages.length,
): T[] {
  const at = Math.max(0, Math.min(Math.trunc(index), stages.length));
  return [...stages.slice(0, at), stage, ...stages.slice(at)];
}

/** Remove the stage with this id. Unknown id → the list, unchanged. */
export function withStageRemoved<T extends ProcessStage>(stages: readonly T[], id: string): T[] {
  return stages.filter((stage) => stage.id !== id);
}

/**
 * Patch one stage's CONTENT. The id is not patchable — it is the handle being used
 * to find the stage, and letting a patch change it would let a correction to a
 * temperature quietly re-key the row it is being typed into.
 */
export function withStageUpdated<T extends ProcessStage>(
  stages: readonly T[],
  id: string,
  patch: Partial<Omit<T, 'id'>>,
): T[] {
  // The cast is the price of the type parameter: TypeScript cannot prove a spread
  // of `Partial<Omit<T, 'id'>>` over a `T` is still a `T`, though it is — every key
  // in the patch is a key of T holding a value of T's type for it.
  return stages.map((stage) =>
    stage.id === id ? ({ ...stage, ...patch, id: stage.id } as T) : stage,
  );
}

/**
 * Move a stage one place up or down. At either end this is a no-op — pressing Up
 * on the first stage does nothing, which is what the button being there already
 * implies, and is kinder than the alternatives (wrapping, or an error).
 */
export function withStageMoved<T extends ProcessStage>(
  stages: readonly T[],
  id: string,
  direction: 'up' | 'down',
): T[] {
  const from = stages.findIndex((stage) => stage.id === id);
  if (from === -1) return [...stages];
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= stages.length) return [...stages];
  const next = [...stages];
  const moved = next[from]!;
  next[from] = next[to]!;
  next[to] = moved;
  return next;
}
