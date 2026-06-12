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
export async function callAuthorRecipe(
  input: AuthorRecipeInput,
): Promise<ReadResult<RecipeDoc, DomainError>> {
  try {
    const fn = httpsCallable<AuthorRecipeInput, RecipeDoc>(
      getFunctions(undefined, REGION),
      'authorRecipe',
    );
    const res = await fn(input);
    return success(res.data);
  } catch (err) {
    return failure(classifyError(err));
  }
}
