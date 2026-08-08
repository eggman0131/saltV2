import { getFunctions, httpsCallable } from 'firebase/functions';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import type { GenerateGuidedPlanInput, GenerateGuidedPlanOutput } from '@salt/domain/schemas';

// generateGuidedPlan (issue #751, Phase 1). Sends only the recipe ID — the flow
// reads the recipe server-side via the Admin SDK — and receives the AUTHORED
// CONTENT of a plan: the prep jobs and the per-step notes.
//
// It persists nothing and stamps nothing. Assembling the document (minting prep
// ids, setting `needs_approval`, stamping `recipeUpdatedAtAtSave` and the
// timestamps) belongs to the ONE write path in guidedPlanService, so a generated
// plan and a hand-saved plan cannot end up with those control fields set two
// different ways.
//
// NEVER throws (Rule 10): a failure crosses as a Failure so the editor can leave
// the plan the user already has untouched and say so.
export async function callGenerateGuidedPlan(
  input: GenerateGuidedPlanInput,
): Promise<ReadResult<GenerateGuidedPlanOutput, DomainError>> {
  try {
    const fn = httpsCallable<GenerateGuidedPlanInput, GenerateGuidedPlanOutput>(
      getFunctions(undefined, 'europe-west2'),
      'generateGuidedPlan',
    );
    const res = await fn(input);
    return success(res.data);
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (code === 'functions/unauthenticated') {
      return failure({ kind: 'AuthError', reason: 'unauthenticated' });
    }
    if (code === 'functions/permission-denied') {
      return failure({ kind: 'AuthError', reason: 'forbidden' });
    }
    return failure({ kind: 'NetworkError', reason: 'transient' });
  }
}
