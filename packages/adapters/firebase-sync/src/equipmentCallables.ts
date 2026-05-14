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

export async function callIdentifyEquipment(
  rawName: string,
): Promise<ReadResult<IdentifyEquipmentResult, DomainError>> {
  try {
    const fn = httpsCallable<{ rawName: string }, IdentifyEquipmentResult>(
      getFunctions(undefined, 'europe-west2'),
      'identifyEquipment',
    );
    const res = await fn({ rawName });
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

export async function callPopulateEquipmentEntry(
  confirmedName: string,
): Promise<ReadResult<PopulateEquipmentEntryResult, DomainError>> {
  try {
    const fn = httpsCallable<{ confirmedName: string }, PopulateEquipmentEntryResult>(
      getFunctions(undefined, 'europe-west2'),
      'populateEquipmentEntry',
    );
    const res = await fn({ confirmedName });
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
