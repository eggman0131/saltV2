import { getFunctions, httpsCallable } from 'firebase/functions';
import { failure, type DomainError, type ReadResult } from '@salt/shared-types';
import { classifyCallableError } from './callableErrors.js';

// Browser → the Pushover device readout (issue #680). CLAUDE.md rule #2: the
// Firebase SDK is only touched here. Error mapping goes through the shared
// `classifyCallableError` and the result crosses as a ReadResult (Rule 10).
//
// This file's private copy of the mapper was the one that had drifted (issue
// #916): it handled `functions/unauthenticated` but never `permission-denied`, so
// a rules refusal here came back as "check your connection". Sharing the mapper
// is what makes that class of drift impossible rather than merely fixed.

export interface PushoverDevices {
  // 'ok' with an EMPTY list is meaningful: the account answered and no device
  // matched the member's `<firstname>-` prefix, which is the misconfiguration
  // the settings card exists to surface. 'unavailable' means we could not say —
  // the card must not accuse anyone of a misconfiguration on a network wobble.
  readonly status: 'ok' | 'unavailable';
  readonly devices?: readonly string[];
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
    return failure(classifyCallableError(err));
  }
}
