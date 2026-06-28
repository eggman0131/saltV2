import { getFunctions, httpsCallable } from 'firebase/functions';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import type { AuthorRecipeInput } from '@salt/domain/schemas';
import type { RecipeDoc } from '@salt/domain/schemas';

const REGION = 'europe-west2';

function classifyError(err: unknown): DomainError {
  const code = (err as { code?: string }).code ?? '';
  if (code === 'functions/unauthenticated') return { kind: 'AuthError', reason: 'unauthenticated' };
  if (code === 'functions/permission-denied') return { kind: 'AuthError', reason: 'forbidden' };
  return { kind: 'NetworkError', reason: 'transient' };
}

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
      getFunctions(undefined, REGION),
      'authorRecipe',
    );
    const res = await fn(traceparent ? { ...input, traceparent } : input);
    return success(res.data);
  } catch (err) {
    return failure(classifyError(err));
  }
}
