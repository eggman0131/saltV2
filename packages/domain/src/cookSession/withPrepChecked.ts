import type { CookSessionDoc } from '../schemas/index.js';

// TOGGLE one guided-cook prep row (issue #751, Phase 2). The exact shape of
// `withIngredientChecked` — ticked ids appended in tick order, unticking filters
// the id out, always a new session — against `checkedPrepIds` instead.
//
// A toggle rather than the target-state form (`withGroupChecked`, `withStepDone`),
// because the caller is a single row being tapped and there is nothing for it to
// be out of step with. The no-op identity return is deliberately NOT here either:
// a toggle always changes something, so there would never be a write to skip.
//
// `prepId` is an INGREDIENT's id — inside a prep job (issue #767) or under "Also
// get out" — or a prep ENTRY's own id, for a job that prepares no ingredient and
// so has nothing to tick but itself. All three are rows on the same screen ticked
// by the same gesture; see CookSessionSchema.
//
// `updatedAt` is left to the persistence seam, as everywhere in this module.
export function withPrepChecked(session: CookSessionDoc, prepId: string): CookSessionDoc {
  const checkedPrepIds = session.checkedPrepIds.includes(prepId)
    ? session.checkedPrepIds.filter((x) => x !== prepId)
    : [...session.checkedPrepIds, prepId];
  return { ...session, checkedPrepIds };
}
