import { getFunctions, httpsCallable } from 'firebase/functions';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import type { ExtractProcessStagesInput, ExtractProcessStagesOutput } from '@salt/domain/schemas';

// extractProcessStages (issue #806, phase 2 of epic #778). Sends only the recipe
// id — the flow reads the recipe server-side via the Admin SDK — and receives the
// AUTHORED STAGES: label, kind, environment, duration, until, and the step each
// came from.
//
// It persists nothing and mints nothing. Stage ids are document-local identity and
// are minted by formulaService on the way back, exactly as guidedPlanService mints
// prep-entry ids; the user then reviews the stages and their Save is what writes
// them onto the formula.
//
// NEVER throws (Rule 10): a failure crosses as a Failure so the formula screen can
// leave the stages the user already has untouched and say so.
export async function callExtractProcessStages(
  input: ExtractProcessStagesInput,
): Promise<ReadResult<ExtractProcessStagesOutput, DomainError>> {
  try {
    const fn = httpsCallable<ExtractProcessStagesInput, ExtractProcessStagesOutput>(
      getFunctions(undefined, 'europe-west2'),
      'extractProcessStages',
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
