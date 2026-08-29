import type { DomainError, ReadResult } from '@salt/shared-types';
import { callFunction } from './callFunction.js';

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

// The add-equipment action mints ONE trace id and supplies the SAME
// `traceparent` to both this call and callPopulateEquipmentEntry, so the two
// flows share one trace. How a trace id rides the wire is written once, at
// `withTraceparent` in callFunction.ts.
export async function callIdentifyEquipment(
  rawName: string,
  traceparent?: string,
): Promise<ReadResult<IdentifyEquipmentResult, DomainError>> {
  return callFunction<{ rawName: string }, IdentifyEquipmentResult>({
    name: 'identifyEquipment',
    input: { rawName },
    traceparent,
  });
}

// Second leg of the add-equipment action (issue #361) — receives the SAME
// browser-minted `traceparent` as callIdentifyEquipment so both flows nest under
// one trace.
export async function callPopulateEquipmentEntry(
  confirmedName: string,
  traceparent?: string,
): Promise<ReadResult<PopulateEquipmentEntryResult, DomainError>> {
  return callFunction<{ confirmedName: string }, PopulateEquipmentEntryResult>({
    name: 'populateEquipmentEntry',
    input: { confirmedName },
    traceparent,
  });
}
