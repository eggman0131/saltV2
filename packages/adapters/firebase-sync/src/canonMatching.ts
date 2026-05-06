import { getFunctions, httpsCallable } from 'firebase/functions';
import type { MatchOrCreateInput, MatchOrCreateResult } from '@salt/domain';
import { failure, type DomainError, type ReadResult } from '@salt/shared-types';

// The CF returns the Result envelope from matchOrCreate verbatim; the client
// just forwards it. Transport-level failures (auth, network) become a fresh
// Failure with the equivalent DomainError.
type WireResult =
  | { readonly kind: 'ok'; readonly value: MatchOrCreateResult }
  | { readonly kind: 'err'; readonly error: DomainError };

export async function callMatchOrCreate(
  input: MatchOrCreateInput,
): Promise<ReadResult<MatchOrCreateResult, DomainError>> {
  try {
    const fn = httpsCallable<MatchOrCreateInput, WireResult>(getFunctions(), 'matchOrCreateCanon');
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
