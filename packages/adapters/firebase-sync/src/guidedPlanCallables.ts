import type { DomainError, ReadResult } from '@salt/shared-types';
import type { GenerateGuidedPlanInput, GenerateGuidedPlanOutput } from '@salt/domain/schemas';
import { callFunction } from './callFunction.js';

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
  return callFunction<GenerateGuidedPlanInput, GenerateGuidedPlanOutput>({
    name: 'generateGuidedPlan',
    input,
    // The function declares 90 s (`cloud-functions/src/index.ts:384`), sized
    // around the flow's 55 s `withAiTimeout`, against the callable client's 70 s
    // default — so the browser used to give up 20 s early. This is the wrapper
    // finding B2-010 was originally filed against.
    timeoutMs: 90_000,
  });
}
