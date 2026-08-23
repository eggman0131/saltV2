import { getFunctions, httpsCallable } from 'firebase/functions';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import {
  PROPOSE_SCHEDULE_CLIENT_TIMEOUT_MS,
  type ProposeScheduleInput,
  type ProposeScheduleOutput,
} from '@salt/domain/schemas';
import { classifyCallableError } from './callableErrors.js';

// proposeSchedule (issue #812, phase 2 of epic #778). Sends the recipe id, the time
// the bake must be finished by, and the household's quiet hours — the flow reads
// the recipe AND its formula server-side via the Admin SDK — and receives a
// RESTRUCTURED PROCESS plus the words explaining it, and optionally an opinion
// about the leavening.
//
// IT RECEIVES NO TIMES AND NO WEIGHTS, deliberately. `resolveSchedule` puts the
// returned stages on the clock and `solveFormula` turns percentages into grams;
// this wrapper is a pipe and does neither.
//
// It persists nothing and mints nothing. Stage ids are document-local identity and
// are minted by the write path (`batchService`, when a run is frozen), exactly as
// formulaService mints them for extracted stages — the proposal is reviewed as a
// diff first, and the user's Start is what writes anything.
//
// THE EXPLICIT `timeout` IS LOAD-BEARING, not decoration. The Firebase callable
// client defaults to 70 s and the spike measured this flow at 65–108 s uncapped, so
// without it a perfectly healthy proposal would be abandoned on the browser side
// while the function was still writing its answer. PROPOSE_SCHEDULE_CLIENT_TIMEOUT_MS
// sits in @salt/domain/schemas beside the function's own `timeoutSeconds` and the
// flow's AI budget — one set of constants, so the three cannot drift apart. The
// nesting is AI budget < client < function; see the schema for why each.
//
// NEVER throws (Rule 10): a failure crosses as a Failure so the sheet can keep the
// schedule the user already has and say what went wrong.
export async function callProposeSchedule(
  input: ProposeScheduleInput,
): Promise<ReadResult<ProposeScheduleOutput, DomainError>> {
  try {
    const fn = httpsCallable<ProposeScheduleInput, ProposeScheduleOutput>(
      getFunctions(undefined, 'europe-west2'),
      'proposeSchedule',
      { timeout: PROPOSE_SCHEDULE_CLIENT_TIMEOUT_MS },
    );
    const res = await fn(input);
    return success(res.data);
  } catch (err) {
    // Everything else — a formula that will not read, a model that would not
    // answer, a dropped connection — offers the sheet the same thing: "try again".
    // The CATEGORY still has to tell them apart, though (issue #916): a dropped
    // connection is expected and suppressed, a model that would not answer is a
    // server fault and must be reported. `classifyCallableError` is what draws
    // that line.
    return failure(classifyCallableError(err));
  }
}
