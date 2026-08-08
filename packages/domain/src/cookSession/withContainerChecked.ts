import { normaliseContainerName } from './normaliseContainerName.js';
import type { CookSessionDoc } from '../schemas/index.js';

// TOGGLE one Get-out row (issue #761, Phase 3). The exact shape of
// `withPrepChecked` — ticked entries appended in tick order, unticking filters the
// entry out, always a new session — against `checkedContainerNames`, the third
// tick list on the document. A toggle rather than the target-state form, and no
// identity return, for the reasons given there: the caller is a single row being
// tapped, and a toggle always changes something.
//
// The stored entry is the NORMALISED name, and this is where that is decided
// rather than at each call site: the list's whole meaning is "which of the get-out
// rows are ticked", the rows are grouped by the normalised name, so the one write
// site is what keeps the field's contents and the group's identity from drifting
// apart. Pass a raw authored name or the group's key — both land on the same
// entry, which is also what stops a later case or whitespace edit to the plan
// stranding a tick nobody can clear.
//
// `updatedAt` is left to the persistence seam, as everywhere in this module.
export function withContainerChecked(session: CookSessionDoc, name: string): CookSessionDoc {
  const key = normaliseContainerName(name);
  const checkedContainerNames = session.checkedContainerNames.includes(key)
    ? session.checkedContainerNames.filter((x) => x !== key)
    : [...session.checkedContainerNames, key];
  return { ...session, checkedContainerNames };
}
