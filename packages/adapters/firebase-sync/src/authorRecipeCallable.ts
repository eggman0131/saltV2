import type { DomainError, ReadResult } from '@salt/shared-types';
import type { AuthorRecipeInput } from '@salt/domain/schemas';
import type { RecipeDoc } from '@salt/domain/schemas';
import { callFunction } from './callFunction.js';

// Calls the librarian flow: sends a conversation and receives a canon-matched
// RecipeDoc draft. The client should add/override id + timestamps before
// persisting with saveRecipe.
//
// `traceparent` (issue #362) is forwarded on the payload; how and why is written
// once, at `withTraceparent` in callFunction.ts.
export async function callAuthorRecipe(
  input: AuthorRecipeInput,
  traceparent?: string,
): Promise<ReadResult<RecipeDoc, DomainError>> {
  return callFunction<AuthorRecipeInput, RecipeDoc>({
    name: 'authorRecipe',
    input,
    traceparent,
  });
}
