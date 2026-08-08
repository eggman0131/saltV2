import { normaliseContainerName } from './normaliseContainerName.js';
import type { GuidedPrepEntryDoc } from '../schemas/index.js';

// Which prep job FILLED the container a step is asking for (issue #761, Phase 1).
//
// The container name is the only join a guided plan has between its two halves:
// a step note says "the onion bowl", and the answer to "so what is in it?" is
// whichever prep job put something there. Nothing in the schema carries that link
// as an id — the plan is authored as prose by a model and then edited by a human,
// and asking either of them to keep a foreign key honest is asking for a plan
// that breaks in a way the cook cannot see. Matching on the name is what a cook
// does at the bench, so it is what this does.
//
// Takes THE ENTRIES, not the whole plan. The caller already has `plan.prep` in
// hand (the prep screen renders it), and narrowing the parameter is what lets
// this be asked about a list that is not a stored plan — a test fixture, a draft
// in the editor — without conjuring the eight control fields a `GuidedPlanDoc`
// would demand.
//
// FIRST match in plan order, via `Array.prototype.find`. A plan may name the same
// container in two jobs ("→ small bowl" twice), which is a plan worth warning
// about at authoring time and is NOT worth refusing to cook: the cook is standing
// at the hob. First-in-order is the reading a human gives it too — the bowl is the
// one the plan filled first.
//
// Returns `null` rather than an entry-shaped blank for all three "there is no
// answer" cases — no name asked for, a name that is only whitespace, and a name no
// job fills — so the caller's fallback is one branch instead of three.
export function prepEntryForContainer(
  prep: readonly GuidedPrepEntryDoc[],
  container: string | null,
): GuidedPrepEntryDoc | null {
  if (container === null) return null;
  const wanted = normaliseContainerName(container);
  if (wanted === '') return null;
  return (
    prep.find(
      (entry) => entry.container !== null && normaliseContainerName(entry.container) === wanted,
    ) ?? null
  );
}
