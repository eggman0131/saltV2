import { getFunctions, httpsCallable } from 'firebase/functions';
import { failure, type DomainError, type ReadResult } from '@salt/shared-types';

export interface IdentifyEquipmentCandidate {
  readonly name: string;
  readonly rationale: string;
}

export interface IdentifyEquipmentResult {
  readonly candidates: readonly IdentifyEquipmentCandidate[];
}

export interface PopulateAccessory {
  readonly name: string;
  readonly included: boolean;
}

export interface PopulateEquipmentEntryResult {
  readonly name: string;
  readonly accessories: readonly PopulateAccessory[];
}

// `traceparent` (issue #361) is an OPTIONAL, named transport field forwarded on
// the payload — the Firebase callable SDK cannot carry a custom `traceparent`
// HTTP header, so the browser-supplied W3C trace id rides here and the CF
// entrypoint strips it before running the flow. The add-equipment action mints
// ONE trace id and supplies the SAME `traceparent` to both this call and
// callPopulateEquipmentEntry, so the two flows share one trace. firebase-sync
// only forwards the string (Rule 4: no observability import). Optional →
// back-compat with old clients that omit it.
export async function callIdentifyEquipment(
  rawName: string,
  traceparent?: string,
): Promise<ReadResult<IdentifyEquipmentResult, DomainError>> {
  try {
    const fn = httpsCallable<{ rawName: string; traceparent?: string }, IdentifyEquipmentResult>(
      getFunctions(undefined, 'europe-west2'),
      'identifyEquipment',
    );
    const res = await fn(traceparent ? { rawName, traceparent } : { rawName });
    return { kind: 'ok', value: res.data };
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

// Second leg of the add-equipment action (issue #361) — receives the SAME
// browser-minted `traceparent` as callIdentifyEquipment so both flows nest under
// one trace. Same transport contract as above (forward-only, optional).
export async function callPopulateEquipmentEntry(
  confirmedName: string,
  traceparent?: string,
): Promise<ReadResult<PopulateEquipmentEntryResult, DomainError>> {
  try {
    const fn = httpsCallable<
      { confirmedName: string; traceparent?: string },
      PopulateEquipmentEntryResult
    >(getFunctions(undefined, 'europe-west2'), 'populateEquipmentEntry');
    const res = await fn(traceparent ? { confirmedName, traceparent } : { confirmedName });
    return { kind: 'ok', value: res.data };
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
