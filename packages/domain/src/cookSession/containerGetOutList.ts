import { normaliseContainerName } from './normaliseContainerName.js';
import type { GuidedPrepEntryDoc } from '../schemas/index.js';

// THE VESSELS A PLAN NEEDS, before a single cut (issue #761, Phase 3).
//
// A guided plan's prep jobs each end with something set aside in a named
// container, so the plan already knows how many bowls the bench needs — it has
// simply never said so anywhere the cook could count them. This is that list:
// every container the plan names, once each, in plan order.
//
// Counting the ROWS is the answer to "how many bowls?", which is the whole reason
// the list exists, so the grouping has to be honest about a repeat. Names are
// grouped by `normaliseContainerName` — the one normaliser, the same answer
// `prepEntryForContainer` and `guidedContainerProblems` give — and a group carries
// its `count` so a repeated name renders "2 × small bowl" rather than one row
// standing for two bowls. In a well-formed plan every name is unique, every count
// is 1 and the grouping is invisible; uniqueness is asked for at authoring time
// and warned about in the editor, but STORED plans can still repeat a name (an
// older plan, a hand-edit), and this must keep reporting the right number then.
//
// Deliberately NOT canon's `normaliseName`: see normaliseContainerName.ts for why
// container names are folded exactly this far and no further.
//
// A `null` or blank container contributes nothing — that is a job which sets
// nothing aside ("open the tin"), and there is no vessel to fetch for it. A plan
// where every job is like that yields an empty list, which is what lets the caller
// skip the stage entirely rather than show an empty screen.

export interface ContainerGetOutRow {
  // The group's identity AND its tick key: the normalised name, which is what
  // `checkedContainerNames` stores. Stable against a later case or whitespace edit
  // to the plan, which an authored-form key would not be.
  readonly key: string;
  // The name AS AUTHORED, taken from the first job that used it — never the
  // normalised form. The cook is about to write this on a bowl and then read it
  // back off a step note, so it has to be the words the plan actually says.
  readonly name: string;
  // How many jobs name this container. 1 for every row of a well-formed plan; more
  // only when a plan repeats a name, and then the row says so.
  readonly count: number;
}

export function containerGetOutList(
  prep: readonly GuidedPrepEntryDoc[],
): readonly ContainerGetOutRow[] {
  const byName = new Map<string, { key: string; name: string; count: number }>();
  for (const entry of prep) {
    if (entry.container === null) continue;
    const key = normaliseContainerName(entry.container);
    if (key === '') continue;
    const group = byName.get(key);
    if (group) group.count += 1;
    else byName.set(key, { key, name: entry.container.trim(), count: 1 });
  }
  // Insertion order, which for a Map is the order the jobs first named each
  // container — the order the cook works through the prep list.
  return [...byName.values()];
}
