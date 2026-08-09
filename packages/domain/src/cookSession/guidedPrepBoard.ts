import { normaliseContainerName } from './normaliseContainerName.js';
import { prepEntryIngredients } from './prepEntryIngredients.js';
import type { Ingredient, Recipe } from '../recipe/index.js';
import type { GuidedPrepEntryDoc } from '../schemas/index.js';

// THE BENCH, as the cook actually works it (issue #767).
//
// A guided plan stores a flat list of jobs, each ending with something set aside
// in a named container. Rendered flat, the container reads as a footnote on the
// job — but at the bench the container comes FIRST: you fetch the bowl, then you
// chop into it. This groups the plan the way the work happens, so a card reads
// top-to-bottom as get this bowl / do these things / this much goes in it.
//
// Grouping it here rather than in the page is what lets progress, completion and
// the rendering all be asked of one answer. Two of those questions used to be
// asked of `containerGetOutList` (issue #761, Phase 3), which this replaces
// outright: the vessel count that stage existed to give is now legible from the
// cards themselves, one per bowl.
//
// GROUPED BY `normaliseContainerName`, the one normaliser — the same answer
// `prepEntryForContainer` gives when a step later asks for that bowl by name, so
// a card and the step note that reaches for it can never disagree about which
// bowl they mean.
//
// A job whose container is null or blank sets nothing aside ("open the tin"). All
// of them fall into ONE group under the empty key, with a null `name`, which the
// caller renders without a lead — there is no vessel to head it with, and
// inventing one ("No bowl") would be words the plan never said.

/** One job inside a card: the plan's instruction, and what it prepares. */
export interface GuidedPrepJob {
  readonly entry: GuidedPrepEntryDoc;
  /** The recipe ingredients this job prepares, in recipe order, with amounts. */
  readonly ingredients: readonly Ingredient[];
  /**
   * What ticking this job off means, as tick ids for `checkedPrepIds`.
   *
   * The INGREDIENT ids when it prepares any: the cook dices the carrots, then the
   * onion, then the celery, and each of those is its own tick — the job is done
   * when its last ingredient is. Falls back to the ENTRY's own id when it prepares
   * nothing the recipe still has, which is the pre-#767 behaviour kept exactly
   * where it still fits: "warm the plates" has nothing to tick but itself, and
   * neither has a job whose every id names an ingredient edited out of the recipe
   * — a job with no tick at all would be one the cook could never clear.
   */
  readonly tickIds: readonly string[];
}

/** One card: a container, and every job that fills it. */
export interface GuidedPrepGroup {
  /** The normalised container name, and the group's identity. `''` = no container. */
  readonly key: string;
  /**
   * The name AS AUTHORED, from the first job that named it — never the normalised
   * form. The cook writes this on a bowl and reads it back off a step note, so it
   * has to be the words the plan says. Null for the no-container group.
   */
  readonly name: string | null;
  readonly jobs: readonly GuidedPrepJob[];
  /** Every tick id in the card, flattened — what "is this bowl done?" is asked of. */
  readonly tickIds: readonly string[];
}

export function guidedPrepBoard(
  recipe: Recipe,
  prep: readonly GuidedPrepEntryDoc[],
): readonly GuidedPrepGroup[] {
  const byContainer = new Map<
    string,
    { key: string; name: string | null; jobs: GuidedPrepJob[] }
  >();
  for (const entry of prep) {
    const ingredients = prepEntryIngredients(recipe, entry);
    const job: GuidedPrepJob = {
      entry,
      ingredients,
      tickIds: ingredients.length > 0 ? ingredients.map((i) => i.id) : [entry.id],
    };
    const key = entry.container === null ? '' : normaliseContainerName(entry.container);
    const group = byContainer.get(key);
    if (group) group.jobs.push(job);
    else
      byContainer.set(key, {
        key,
        name: key === '' ? null : entry.container!.trim(),
        jobs: [job],
      });
  }
  // Insertion order — for a Map, the order each container was FIRST named, which
  // is the order the plan works through the bench.
  return [...byContainer.values()].map((group) => ({
    ...group,
    tickIds: group.jobs.flatMap((job) => job.tickIds),
  }));
}
