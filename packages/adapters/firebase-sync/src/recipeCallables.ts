import { getFunctions, httpsCallable } from 'firebase/functions';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import type { IngredientGroup } from '@salt/domain';

export async function callParseRecipeIngredients(
  rawText: string,
): Promise<ReadResult<IngredientGroup[], DomainError>> {
  try {
    const fn = httpsCallable<{ rawText: string }, IngredientGroup[]>(
      getFunctions(undefined, 'europe-west2'),
      'parseRecipeIngredients',
    );
    const res = await fn({ rawText });
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
