import type { CookSessionDoc } from '../schemas/index.js';

// Set a step's completion. Immutable — returns a NEW session, or the SAME session
// reference when the step is already in the requested state (the repo's no-op
// producer idiom, cf. `appendCanonSynonym`). Callers persist only when the
// identity changed, so re-ticking a done step costs no Firestore write.
//
// `updatedAt` is deliberately NOT stamped here: the persistence seam owns that.
export function withStepDone(
  session: CookSessionDoc,
  stepId: string,
  done: boolean,
): CookSessionDoc {
  if (session.completedStepIds.includes(stepId) === done) return session;
  const completedStepIds = done
    ? [...session.completedStepIds, stepId]
    : session.completedStepIds.filter((x) => x !== stepId);
  return { ...session, completedStepIds };
}
