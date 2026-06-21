import { getFunctions, httpsCallable } from 'firebase/functions';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import type { IngredientGroup } from '@salt/domain';
import type {
  ExtractRecipeFromUrlInput,
  RecipeDoc,
  UrlImportFailureCode,
} from '@salt/domain/schemas';

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

// Map the callable's HttpsError code → the URL-import failure vocabulary. The
// CF entrypoint deliberately maps each UrlImportError code to a distinct gRPC
// code (see apps/cloud-functions/src/index.ts:mapUrlImportFailure), so the
// reverse mapping here is exact. The error channel carries the failure code
// directly (not a DomainError) because the import failures are import-specific
// and the web copy map keys off them. Adapters never throw — every failure
// crosses as a Failure.
function classifyUrlImportError(err: unknown): UrlImportFailureCode {
  const code = (err as { code?: string }).code ?? '';
  switch (code) {
    case 'functions/invalid-argument':
      // Covers both invalid-url and blocked-url. The CF copy distinguishes
      // them via the message; the client treats both as "can't import this
      // address" — we surface blocked-url (the stricter, no-detail message)
      // only when the message indicates a blocked link, else invalid-url.
      return /can't be imported/i.test(String((err as { message?: string }).message ?? ''))
        ? 'blocked-url'
        : 'invalid-url';
    case 'functions/unavailable':
      return 'fetch-failed';
    case 'functions/failed-precondition':
      return 'not-a-recipe';
    case 'functions/deadline-exceeded':
    case 'functions/internal':
      return 'ai-failed';
    default:
      // Network/transport hiccup before the function ran — treat as unreachable.
      return 'fetch-failed';
  }
}

// SSRF-hardened URL import. Sends a URL, receives a fully-assembled, metric +
// British recipe draft (source.type='url'). On failure returns the specific
// UrlImportFailureCode so the caller can show the right copy.
export async function callExtractRecipeFromUrl(
  input: ExtractRecipeFromUrlInput,
): Promise<ReadResult<RecipeDoc, UrlImportFailureCode>> {
  try {
    const fn = httpsCallable<ExtractRecipeFromUrlInput, RecipeDoc>(
      getFunctions(undefined, 'europe-west2'),
      'extractRecipeFromUrl',
    );
    const res = await fn(input);
    return success(res.data);
  } catch (err) {
    return failure(classifyUrlImportError(err));
  }
}
