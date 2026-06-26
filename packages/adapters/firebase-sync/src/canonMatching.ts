import { getFunctions, httpsCallable } from 'firebase/functions';
import type { MatchOrCreateInput, MatchOrCreateResult } from '@salt/domain';
import type { CanonicaliseRecipeIngredientsInput } from '@salt/domain/schemas';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';

// The CF returns the Result envelope from matchOrCreate verbatim; the client
// just forwards it. Transport-level failures (auth, network) become a fresh
// Failure with the equivalent DomainError.
type WireResult =
  | { readonly kind: 'ok'; readonly value: MatchOrCreateResult }
  | { readonly kind: 'err'; readonly error: DomainError };

// The wire input is exactly the domain input. Trace context is no longer
// piggy-backed on the payload: server-side trace unification now happens at the
// callable entrypoint, which reads the inbound W3C trace headers off the
// underlying request (see apps/cloud-functions/src/index.ts).
export async function callMatchOrCreate(
  input: MatchOrCreateInput,
): Promise<ReadResult<MatchOrCreateResult, DomainError>> {
  try {
    const fn = httpsCallable<MatchOrCreateInput, WireResult>(
      getFunctions(undefined, 'europe-west2'),
      'matchOrCreateCanon',
    );
    const res = await fn(input);
    return res.data;
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

type WireBatchResult = ReadResult<MatchOrCreateResult, DomainError>[];

export async function callCanonicaliseRecipeIngredients(
  input: CanonicaliseRecipeIngredientsInput,
): Promise<ReadResult<WireBatchResult, DomainError>> {
  try {
    const fn = httpsCallable<CanonicaliseRecipeIngredientsInput, WireBatchResult>(
      getFunctions(undefined, 'europe-west2'),
      'canonicaliseRecipeIngredients',
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

// Clears a canon item's icon server-side (issue #148), re-firing the
// onCanonItemWritten trigger so the icon branch regenerates. Used for both the
// "regenerate" and "unhide" actions (both set thumbnail → null). An optional
// `hint` is a one-shot additive steer for the next generation.
export async function callRegenerateCanonIcon(
  canonId: string,
  hint?: string,
): Promise<ReadResult<void, DomainError>> {
  try {
    const fn = httpsCallable<{ canonId: string; hint?: string }, { ok: true }>(
      getFunctions(undefined, 'europe-west2'),
      'regenerateCanonIcon',
    );
    await fn(hint && hint.trim() ? { canonId, hint: hint.trim() } : { canonId });
    return success(undefined);
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
