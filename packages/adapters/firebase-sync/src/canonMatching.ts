import { getFunctions, httpsCallable } from 'firebase/functions';
import type { MatchOrCreateInput, MatchOrCreateResult } from '@salt/domain';
import { failure, type DomainError, type ReadResult } from '@salt/shared-types';

// The CF returns the Result envelope from matchOrCreate verbatim; the client
// just forwards it. Transport-level failures (auth, network) become a fresh
// Failure with the equivalent DomainError.
type WireResult =
  | { readonly kind: 'ok'; readonly value: MatchOrCreateResult }
  | { readonly kind: 'err'; readonly error: DomainError };

// httpsCallable doesn't expose request headers, so W3C trace context is
// piggy-backed on the payload via _trace. The CF strips it before passing
// the input to the matchOrCreate domain function.
//
// DORMANT: trace propagation — the CF currently ignores _trace (see
// apps/cloud-functions/src/index.ts). This adapter still forwards the field
// when callers pass traceHeaders, so the wire shape and call surface stay
// ready for re-enabling propagation later.
type WireInput = MatchOrCreateInput & {
  readonly _trace?: Record<string, string>;
};

export interface CallMatchOrCreateOptions {
  readonly traceHeaders?: Record<string, string>;
}

export async function callMatchOrCreate(
  input: MatchOrCreateInput,
  opts?: CallMatchOrCreateOptions,
): Promise<ReadResult<MatchOrCreateResult, DomainError>> {
  try {
    const fn = httpsCallable<WireInput, WireResult>(
      getFunctions(undefined, 'europe-west2'),
      'matchOrCreateCanon',
    );
    const wireInput: WireInput =
      opts?.traceHeaders && Object.keys(opts.traceHeaders).length > 0
        ? { ...input, _trace: opts.traceHeaders }
        : input;
    const res = await fn(wireInput);
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
