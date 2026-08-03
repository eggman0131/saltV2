import { getFunctions, httpsCallable } from 'firebase/functions';
import { failure, type DomainError, type ReadResult } from '@salt/shared-types';

// Browser → the Pushover device readout (issue #680). CLAUDE.md rule #2: the
// Firebase SDK is only touched here. Mirrors aiModelCallables.ts — map the
// callable error codes to DomainError and return a ReadResult (Rule 10).

export interface PushoverDevices {
  // 'ok' with an EMPTY list is meaningful: the account answered and no device
  // matched the member's `<firstname>-` prefix, which is the misconfiguration
  // the settings card exists to surface. 'unavailable' means we could not say —
  // the card must not accuse anyone of a misconfiguration on a network wobble.
  readonly status: 'ok' | 'unavailable';
  readonly devices?: readonly string[];
}

function mapCallableError(err: unknown): DomainError {
  const code = (err as { code?: string }).code ?? '';
  if (code === 'functions/unauthenticated') {
    return { kind: 'AuthError', reason: 'unauthenticated' };
  }
  return { kind: 'NetworkError', reason: 'transient' };
}

/** Lists the Pushover devices that resolve for the signed-in member. */
export async function callListPushoverDevices(): Promise<ReadResult<PushoverDevices, DomainError>> {
  try {
    const fn = httpsCallable<Record<string, never>, PushoverDevices>(
      getFunctions(undefined, 'europe-west2'),
      'listPushoverDevices',
    );
    const res = await fn({});
    return { kind: 'ok', value: res.data };
  } catch (err) {
    return failure(mapCallableError(err));
  }
}
