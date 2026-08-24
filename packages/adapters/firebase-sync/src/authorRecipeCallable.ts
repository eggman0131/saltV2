import { getFunctions, httpsCallable } from 'firebase/functions';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import type { AuthorRecipeInput } from '@salt/domain/schemas';
import type { RecipeDoc } from '@salt/domain/schemas';
import { classifyCallableError } from './callableErrors.js';
import { FUNCTIONS_REGION } from './functionsRegion.js';

// Calls the librarian flow: sends a conversation and receives a canon-matched
// RecipeDoc draft. The client should add/override id + timestamps before
// persisting with saveRecipe.
//
// `traceparent` (issue #362) is an OPTIONAL, named transport field forwarded on
// the payload — the Firebase callable SDK cannot carry a custom `traceparent`
// HTTP header, so a browser-supplied W3C trace id rides here and the CF
// entrypoint strips it before running the flow. firebase-sync only forwards the
// string (Rule 4: no observability import). Optional → back-compat.
export async function callAuthorRecipe(
  input: AuthorRecipeInput,
  traceparent?: string,
): Promise<ReadResult<RecipeDoc, DomainError>> {
  try {
    const fn = httpsCallable<AuthorRecipeInput & { traceparent?: string }, RecipeDoc>(
      getFunctions(undefined, FUNCTIONS_REGION),
      'authorRecipe',
    );
    const res = await fn(traceparent ? { ...input, traceparent } : input);
    return success(res.data);
  } catch (err) {
    return failure(classifyCallableError(err));
  }
}
